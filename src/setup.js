import { createRng, hashKey } from "./rng.js";
import { getCandidates } from "./params.js";
import { freeze, generatePerson, initialRule, provenance } from "./person.js";
import { encodeSeedCode, decodeSeedCode, SEED_VERSIONS } from "./seedcode.js";

export const LOCK_GROUPS = freeze({
  v_appearance: ["appearance", "motif"],
  v_settings: ["name", "personaStyle", "species", "occupationV", "statusV", "firstPerson",
    "address", "catchphrase", "greeting", "fanName", "profile", "tags", "mark", "speech", "world", "family"],
  activity_policy: ["mainActivity", "continuationPolicy"],
});
const fields = Object.values(LOCK_GROUPS).flat();
const csFields = { firstPerson: "CS01", address: "CS02", fanName: "CS03", species: "CS04",
  catchphrase: "CS05", greeting: "CS06", profile: "CS07", motif: "CS08", tags: "CS09",
  mark: "CS10", speech: "CS11", world: "CS12", family: "CS13", occupationV: "CS14", statusV: "CS15" };
const collectionFields = { species: "species", occupationV: "vOccupations", statusV: "vStatuses" };
const targets = { name: "Vの名前", appearance: "見た目", personaStyle: "見せたいキャラ（PT）",
  species: "種族（SP）", occupationV: "Vの職業（JB）", statusV: "Vの地位（ST）", firstPerson: "一人称（CS01）" };
const clone = value => JSON.parse(JSON.stringify(value));
const fieldCheck = field => { if (!fields.includes(field)) throw new TypeError(`Not a V field: ${field}`); };
const preset = (id, extra = {}) => ({ preset: id, custom: null, ...extra });

function ids(text) {
  const result = [];
  for (const m of text.matchAll(/\b(SP|JB|ST)(\d{2})(?:～(?:\1)?(\d{2}))?/gu))
    for (let i = Number(m[2]); i <= Number(m[3] ?? m[2]); i++) result.push(`${m[1]}${String(i).padStart(2, "0")}`);
  return result;
}

export function compatibilityWeight(params, field, candidate, current) {
  const c = params.collections.compatibility;
  let weight = c.levels["ギャップとして許容"];
  const species = field === "species" ? candidate : current.species?.custom ? null : current.species?.preset;
  const row = c.speciesXStatusOccupation.find(row => ids(row["種族（SP）"]).includes(species));
  if (row) {
    if (field === "species") {
      const titles = [current.occupationV, current.statusV].filter(value => value?.preset && !value.custom);
      if (titles.some(value => ids(row["おまかせでは選ばない"]).includes(value.preset)))
        return c.levels["おまかせでは選ばない"];
      // Initial species sampling has no titles. A reroll uses each retained
      // species/title relationship, just as downstream title sampling does.
      return titles.reduce((product, value) => product *
        (ids(row.自然).includes(value.preset) ? c.levels.自然 : c.levels["ギャップとして許容"]), 1);
    }
    if (ids(row["おまかせでは選ばない"]).includes(candidate)) return c.levels["おまかせでは選ばない"];
    if (ids(row.自然).includes(candidate)) weight = c.levels.自然;
  }
  if (["statusV", "occupationV"].includes(field)) for (const pair of c.statusXOccupation) {
    const refs = ids(pair.組合せ);
    const other = current[field === "statusV" ? "occupationV" : "statusV"];
    if (refs.includes(candidate) && !other?.custom && refs.includes(other?.preset)) {
      const multiplier = c.levels[pair.判定];
      if (multiplier === 0) return 0;
      weight *= multiplier;
    }
  }
  return weight;
}

function csRow(params, field) { return params.collections.characterSettings.find(row => row.id === csFields[field]); }
function textCandidates(params, field) {
  const row = csRow(params, field);
  if (!["firstPerson", "address", "catchphrase"].includes(field)) return [];
  return row.columns.プリセット.split("／").map((label, i) => ({ id: `${row.id}_${String(i).padStart(2, "0")}`, label }))
    .filter(row => !/その他|名前呼び|役割名|ファンネームで呼ぶ|独自の語尾/u.test(row.label));
}

function dataCandidates(params, field, person) {
  const data = params.collections.initialWeights.vDefaults;
  let rows = field === "name" ? data.nameLedger.candidates.filter(row =>
    row.status === "APPROVED_FOR_RELEASE" || (!data.nameLedger.releaseReady && row.status === "DRAFT"))
    : data.candidates[field] ?? [];
  if (field === "mainActivity" && person) rows = rows.filter(row =>
    person.startYear >= row.minYear && person.startYear <= row.maxYear);
  return rows;
}

function resolvedValue(params, field, value) {
  if (value?.custom != null) return value.custom;
  const data = dataCandidates(params, field).find(row => row.id === value?.preset);
  if (data) return clone(data.value);
  const text = textCandidates(params, field).find(row => row.id === value?.preset);
  return text ? text.label : clone(value);
}

// Presets remain compact IDs in the editor/seed code. Renderable content is
// resolved separately, without copying research columns or public examples.
function resolvedV(params, values) {
  return Object.fromEntries(fields.map(field => [field, resolvedValue(params, field, values[field])]));
}

function automatic(params, field, seed, current, rerolled = false, person) {
  const rng = createRng(seed, "setupV", field);
  if (field === "personaStyle") return { primary: null, secondary: null };
  if (Object.hasOwn(collectionFields, field)) {
    const rows = getCandidates(params, collectionFields[field]).filter(row => row.id !== "SP17");
    const rule = initialRule(params, targets[field]);
    const base = /^各([\d.]+)/u.exec(rule["重み・値"]);
    if (!base) throw new TypeError(`Unresolved base weight: ${field}`);
    const weights = rows.map(row => Number(base[1]) * compatibilityWeight(params, field, row.id, current));
    const selected = rng.weighted(rows, weights);
    if (field === "statusV" && selected.id === "ST09") {
      const titles = [...getCandidates(params, "vOccupations"), ...getCandidates(params, "vStatuses")].filter(row => row.id !== "ST09");
      return preset(selected.id, { formerTitle: rng.fork("formerTitle").weighted(titles, titles.map(() => Number(base[1]))).id });
    }
    return preset(selected.id, field === "statusV" ? { formerTitle: null } : {});
  }
  const candidates = textCandidates(params, field);
  if (candidates.length) {
    const rule = initialRule(params, field === "firstPerson" ? targets.firstPerson : "呼びかけ・口癖・挨拶");
    const base = /^各([\d.]+)/u.exec(rule["重み・値"]);
    if (!base) throw new TypeError(`Unresolved text weight: ${field}`);
    if (field === "catchphrase" && !rerolled) return preset(candidates.find(row => row.label === "なし").id);
    const weights = candidates.map(row => {
      if (field !== "firstPerson") return Number(base[1]);
      const natural = params.collections.compatibility.titleXFirstPerson.some(pair =>
        ids(pair["職業・地位"]).some(id => [current.species, current.occupationV, current.statusV].some(v => !v?.custom && v?.preset === id)) &&
        pair["自然な一人称（CS01）"].split("・").some(word => row.label === word || row.label.includes(`（${word}）`) || row.label.split("（")[0] === word));
      return Number(base[1]) * params.collections.compatibility.levels[natural ? "自然" : "ギャップとして許容"];
    });
    return preset(rng.weighted(candidates, weights).id);
  }
  const rows = dataCandidates(params, field, person);
  if (!rows.length) throw new TypeError(`Missing automatic candidates: ${field}`);
  const weights = rows.map(row => row.weight.value * (field === "mainActivity" &&
    row.backgroundIds.includes(person.background) ? row.affinityMultiplier : 1));
  return preset(rng.weighted(rows, weights).id);
}

function cleanCustom(params, field, text) {
  const row = csRow(params, field);
  const limit = field === "name" ? [null, params.collections.initialWeights.vDefaults.customLimits.name] :
    row && /(?:最大|～)(\d+)文字/u.exec(row.columns.自由入力);
  if (!limit || typeof text !== "string") throw new TypeError(`No free-text definition: ${field}`);
  const cleaned = text.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, "").replace(/(?:https?:\/\/|www\.)\S+/giu, "").trim();
  if (!cleaned.length || [...cleaned].length > Number(limit[1])) throw new TypeError(`Invalid free-text length: ${field}`);
  return cleaned;
}

function checkedOverride(params, field, value, person) {
  fieldCheck(field);
  if (field === "personaStyle") {
    if (!value || Object.keys(value).some(key => !["primary", "secondary"].includes(key))) throw new TypeError("Invalid persona style");
    const candidates = getCandidates(params, "personaStyles").map(row => row.id);
    for (const id of [value.primary, value.secondary]) if (id !== null && !candidates.includes(id)) throw new TypeError("Invalid persona style");
    if (value.secondary !== null && (value.primary === null || value.primary === value.secondary)) throw new TypeError("Invalid secondary style");
    return { primary: value.primary, secondary: value.secondary };
  }
  if (!value || typeof value !== "object" || Object.keys(value).some(key => !["preset", "custom", "formerTitle"].includes(key)))
    throw new TypeError(`Invalid override: ${field}`);
  if (value.custom != null) {
    if (value.preset != null || value.formerTitle != null) throw new TypeError("Free text cannot carry a hidden preset");
    return { preset: null, custom: cleanCustom(params, field, value.custom) };
  }
  const candidates = Object.hasOwn(collectionFields, field) ? getCandidates(params, collectionFields[field]) :
    [...textCandidates(params, field), ...dataCandidates(params, field, person)];
  if (!candidates.some(row => row.id === value.preset) || value.preset === "SP17") throw new TypeError(`Unknown candidate: ${field}`);
  if (field === "statusV") {
    const formerTitle = value.formerTitle ?? null;
    const titles = [...getCandidates(params, "vOccupations"), ...getCandidates(params, "vStatuses")];
    if (formerTitle !== null && (value.preset !== "ST09" || formerTitle === "ST09" || !titles.some(row => row.id === formerTitle)))
      throw new TypeError("Invalid former title");
    return preset(value.preset, { formerTitle });
  }
  if (value.formerTitle != null) throw new TypeError("Unexpected former title");
  return preset(value.preset);
}

function vProvenance(params, values, overrides) {
  return Object.fromEntries(fields.map(field => {
    const row = csRow(params, field);
    const rule = targets[field] ? initialRule(params, targets[field]) : row ?
      { 区分: "仮置き", "重み・値": row.columns.プリセット } : { 区分: "仮置き", "重み・値": "P-18 vDefaults" };
    return [field, provenance(values[field], rule, Object.hasOwn(overrides, field) ? "player" : values[field] === null ? "unresolved" :
      ["species", "occupationV", "statusV", "firstPerson"].includes(field) ? "random_consistent" : ["personaStyle", "catchphrase"].includes(field) ? "default" : field === "mainActivity" ? "background_era_weighted" : "weighted", Object.hasOwn(overrides, field))];
  }));
}

// History belongs to this editor closure, never to a run/save/seed record.
export function createSetup(params, { seed, entry = "QS1", overrides = {} } = {}) {
  return editor(params, { worldSeed: hashKey(seed, "world"), personSeed: hashKey(seed, "person"), vSeed: hashKey(seed, "setupV"),
    versions: { ...SEED_VERSIONS }, startYearWeightMode: "uniform", rerollCount: 0,
    fieldGenerations: Object.fromEntries(fields.map(field => [field, 0])), lockedGroups: [], overrides }, entry);
}

function editor(params, record, initialEntry) {
  let entry = initialEntry;
  const checkEntry = value => { if (!["QS1", "QS2", "QS3"].includes(value)) throw new TypeError("Unknown quick-start entry"); };
  checkEntry(entry);
  if (params.contentVersion !== record.versions.contentVersion) throw new TypeError("Setup content version mismatch");
  const fixedPerson = generatePerson(params, record.personSeed);
  let state = clone(record), values = {}, history = [];
  for (const key of Object.keys(state.overrides)) state.overrides[key] = checkedOverride(params, key, state.overrides[key], fixedPerson.personTemplate);
  for (const key of Object.keys(state.selections ?? {})) state.selections[key] = checkedOverride(params, key, state.selections[key], fixedPerson.personTemplate);
  const fieldSeed = (s, field) => hashKey(s.vSeed, "setupV", s.fieldGenerations[field], field);
  for (const field of fields) values[field] = null;
  // Resolve all upstream fields before dependent character fields, independent of UI layout.
  const order = ["name", "appearance", "personaStyle", "mainActivity", "species", "occupationV", "statusV", "firstPerson",
    ...fields.filter(field => !["name", "appearance", "personaStyle", "mainActivity", "species", "occupationV", "statusV", "firstPerson"].includes(field))];
  for (const field of order) values[field] = state.overrides[field] ?? state.selections?.[field] ??
    automatic(params, field, fieldSeed(state, field), values, state.fieldGenerations[field] > 0, fixedPerson.personTemplate);
  function push(next, nextValues) {
    history = [...history.slice(-9), { state, values }]; state = next; values = nextValues;
  }
  function editable(field) {
    if (entry === "QS1") throw new TypeError("Open QS2 or QS3 before editing V settings");
    if (field !== undefined) fieldCheck(field);
  }
  function locked(field) { return state.lockedGroups.some(group => LOCK_GROUPS[group].includes(field)); }
  function snapshot() {
    const characterProfile = resolvedV(params, values);
    const { format, liveMode } = characterProfile.mainActivity;
    const { voiceTraining, distance } = characterProfile.continuationPolicy;
    const issues = [...fixedPerson.issues, ...fields.filter(field => values[field] === null)
      .map(field => ({ field, reason: "自動候補・生成データが未定義" }))];
    if (values.statusV?.preset === "ST09" && !values.statusV.formerTitle)
      issues.push({ field: "statusV", reason: "元の肩書きを設定してください" });
    return freeze({ seed: state.worldSeed, personTemplate: fixedPerson.personTemplate,
      runSetupTemplate: { startDate: fixedPerson.personTemplate.startDate, v: clone(values), characterProfile,
        generationVersion: params.collections.initialWeights.generation.version,
        policy: { format, liveMode, voiceTraining, distance }, dream: null, autoMajorChoices: false,
        naming: { version: params.collections.initialWeights.vDefaults.nameLedger.version,
          releaseReady: params.collections.initialWeights.vDefaults.nameLedger.releaseReady && values.name.custom === null,
          status: values.name.custom !== null ? "PLAYER_UNCHECKED" :
            dataCandidates(params, "name").find(row => row.id === values.name.preset).status } },
      setupProvenance: { entry, personFixedAtStart: true, person: fixedPerson.provenance,
        v: vProvenance(params, clone(values), state.overrides),
        dream: { value: null, method: "unset", evidenceClass: "—", playerOverride: false },
        autoMajorChoices: { value: false, method: "default", evidenceClass: "—", playerOverride: false } },
      fieldSeeds: Object.fromEntries(fields.map(field => [field, fieldSeed(state, field)])),
      lockedGroups: [...state.lockedGroups], ready: issues.length === 0, issues });
  }
  return Object.freeze({
    snapshot,
    setEntry(value) { checkEntry(value); entry = value; return snapshot(); },
    setLock(group, enabled) {
      editable();
      if (!Object.hasOwn(LOCK_GROUPS, group) || typeof enabled !== "boolean") throw new TypeError("Invalid V lock");
      const groups = new Set(state.lockedGroups); enabled ? groups.add(group) : groups.delete(group);
      push({ ...state, lockedGroups: Object.keys(LOCK_GROUPS).filter(group => groups.has(group)) }, values);
      return snapshot();
    },
    override(field, value) {
      editable(field);
      const checked = checkedOverride(params, field, value, fixedPerson.personTemplate);
      push({ ...state, overrides: { ...state.overrides, [field]: checked } }, { ...values, [field]: checked });
      return snapshot();
    },
    reroll(field = "all") {
      editable(field === "all" ? undefined : field);
      const selected = order.filter(key => (field === "all" || field === key) && !locked(key));
      if (!selected.length) return snapshot();
      const next = clone(state), nextValues = clone(values);
      if (!Number.isSafeInteger(++next.rerollCount)) throw new RangeError("Reroll counter overflow");
      for (const key of selected) nextValues[key] = null;
      for (const key of selected) {
        next.fieldGenerations[key] = next.rerollCount;
        delete next.overrides[key];
        nextValues[key] = automatic(params, key, fieldSeed(next, key), nextValues, true, fixedPerson.personTemplate);
      }
      push(next, nextValues); return snapshot();
    },
    undo() {
      editable();
      if (history.length) { const previous = history[history.length - 1]; history = history.slice(0, -1); state = previous.state; values = previous.values; }
      return snapshot();
    },
    get undoCount() { return history.length; },
    exportSeedCode() {
      // Drafts are not shareable lives; in particular do not synthesize missing
      // NaturalSpeech for legacy or unfinished persons (AT126).
      if (!snapshot().ready) throw new TypeError("Cannot share an unfinished setup");
      return encodeSeedCode({ ...state, selections: values });
    },
  });
}

export function importSeedCode(params, code, entry = "QS3") {
  const result = decodeSeedCode(code);
  if (!result.ok) return result;
  try {
    const session = editor(params, result.record, entry);
    // Candidate validity is checked before publishing a session; no partial import.
    const snapshot = session.snapshot();
    if (!snapshot.ready) return { ok: false, error: "初期値データが未確定です", issues: snapshot.issues };
    return { ok: true, session, notices: result.notices };
  } catch {
    return { ok: false, error: "読み込めないたねです" };
  }
}
