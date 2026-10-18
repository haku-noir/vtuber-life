export const PARAMS_SCHEMA_VERSION = "params-0.5.0";
export const CONTENT_VERSION = "0.5.0";
export const BALANCE_VERSION = "balance-0.2.0";
export const ABILITY_AXES = Object.freeze(["singing", "drawing", "dance", "gaming", "talk", "collaboration", "planning", "editing"]);
export const PARAMS_URL = new URL("../docs/spec/params.json", import.meta.url);

const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
const fail = message => { throw new TypeError(`Invalid params: ${message}`); };
export const isRetired = row => /^(削除|廃止)/.test(row?.status ?? "");

// These are spellings in the supplied document, not new evidence categories.
const evidenceAliases = new Map([
  ["ゲーム設定（v0.4以前から継続、または調査は根拠列のみ）", "ゲーム設定（v0.4）"],
  ["ゲーム独自（調査で少数確認）", "ゲーム独自"], ["調査由来（CH50）", "調査由来"],
  ["統計（上位のみ）", "統計"],
]);

function deepFreeze(value) {
  if (value && typeof value === "object") { Object.values(value).forEach(deepFreeze); Object.freeze(value); }
  return value;
}

export function validateParams(data) {
  if (!isObject(data) || data.schemaVersion !== PARAMS_SCHEMA_VERSION || data.contentVersion !== CONTENT_VERSION)
    fail("unsupported version");
  if (!isObject(data.collections) || !isObject(data.evidenceClasses)) fail("missing collections or evidence classes");
  const evidenceNames = ["統計", "推定", "仮置き", "調査由来", "ゲーム独自", "ゲーム設定（v0.4）"];
  if (Object.keys(data.evidenceClasses).length !== evidenceNames.length ||
      evidenceNames.some(name => typeof data.evidenceClasses[name] !== "string" || !data.evidenceClasses[name].length))
    fail("evidence class definitions");
  const required = ["personaStyles", "backgrounds", "backgroundCategories", "dreams", "dreamCandidateSeries",
    "events", "characterSettings", "species", "provisionalValues", "lifePositionIndicators", "vOccupations",
    "vStatuses", "compatibility", "initialWeights", "backgroundLifeEffects", "householdInitial", "familyEventParams"];
  const objectCollections = ["compatibility", "initialWeights", "householdInitial", "familyEventParams"];
  const catalogs = ["personaStyles", "backgrounds", "dreams", "events", "characterSettings", "species",
    "lifePositionIndicators", "vOccupations", "vStatuses"];
  for (const key of required) {
    const collection = data.collections[key];
    if (objectCollections.includes(key) ? !isObject(collection) : !Array.isArray(collection) || !collection.length)
      fail(`missing or malformed collection ${key}`);
  }
  const ids = new Set();
  for (const [name, collection] of Object.entries(data.collections)) {
    if (!Array.isArray(collection) && !isObject(collection)) fail(`collection ${name}`);
    if (!Array.isArray(collection)) continue;
    for (const row of collection) {
      if (!isObject(row)) fail(`row in ${name}`);
      if (catalogs.includes(name) && (typeof row.id !== "string" || !isObject(row.columns))) fail(`catalog row in ${name}`);
      if (["events", "vOccupations", "vStatuses"].includes(name) && !Object.hasOwn(row, "weight")) fail(`missing weight in ${name}`);
      if (Object.hasOwn(row, "id") && row.id !== null) {
        if (!/^[A-Z]+\d{2,}$/.test(row.id) || ids.has(row.id)) fail(`duplicate or invalid ID ${row.id}`);
        ids.add(row.id);
        if (row.columns?.ID !== undefined && row.columns.ID !== row.id) fail(`column ID ${row.id}`);
      }
      if (!isRetired(row) && !Object.hasOwn(row, "evidenceClass")) fail(`missing evidence in ${name}`);
    }
  }
  function evidence(value, row, path) {
    if (value == null && isRetired(row)) return;
    if (value === "—" && path.startsWith("collections.lifePositionIndicators")) return;
    if (typeof value !== "string" || !Object.hasOwn(data.evidenceClasses, evidenceAliases.get(value) ?? value))
      fail(`unknown evidence at ${path}`);
  }
  function walk(value, path, depth = 0) {
    if (depth > 40) fail("nesting limit");
    if (typeof value === "number" && !Number.isFinite(value)) fail(`nonfinite number at ${path}`);
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) { value.forEach((v, i) => walk(v, `${path}[${i}]`, depth + 1)); return; }
    if (Object.hasOwn(value, "evidenceClass")) evidence(value.evidenceClass, value, path);
    if (Object.hasOwn(value, "weight")) {
      const w = value.weight;
      if (!isObject(w) || !Object.hasOwn(w, "value") || !Object.hasOwn(w, "evidenceClass")) fail(`weight at ${path}`);
      if (w.value !== null && (typeof w.value !== "number" || !Number.isFinite(w.value) || w.value < 0)) fail(`weight at ${path}`);
      if (w.value === null && w.evidenceClass !== "仮置き") fail(`unresolved weight at ${path}`);
    }
    for (const [key, child] of Object.entries(value)) {
      if (["__proto__", "constructor", "prototype"].includes(key)) fail("unsafe key");
      if (key === "sourceIds") {
        // Bibliography IDs live in the research document, not the candidate namespace.
        if (!Array.isArray(child) || child.some(id => typeof id !== "string" || !/^[A-Z]\d{2}(（[^）]+）)?$/.test(id)))
          fail(`source IDs at ${path}`);
      } else if (/Ids?$/.test(key) && child !== null) {
        const references = key.endsWith("Ids") ? child : [child];
        if (!Array.isArray(references) || references.some(id => !ids.has(id))) fail(`reference at ${path}.${key}`);
      }
      walk(child, `${path}.${key}`, depth + 1);
    }
  }
  walk(data.collections, "collections");
  function checkTextReferences(value) {
    if (typeof value === "string") {
      // Expand ranges as well as checking their endpoints.
      for (const match of value.matchAll(/\b(PT|BG|D|EV|CS|SP|JB|ST|LP)(\d{2})(?:[～〜-](?:\1)?(\d{2}))?/g)) {
        const end = Number(match[3] ?? match[2]), start = Number(match[2]);
        if (end < start) fail(`reversed ID range ${match[0]}`);
        for (let n = start; n <= end; n++) if (!ids.has(`${match[1]}${String(n).padStart(2, "0")}`)) fail(`reference ${match[0]}`);
      }
    } else if (value && typeof value === "object") Object.values(value).forEach(checkTextReferences);
  }
  checkTextReferences(data.collections.compatibility);
  for (const row of data.collections.backgroundLifeEffects) if (!ids.has(row.ID)) fail(`background reference ${row.ID}`);
  const levels = data.collections.compatibility.levels;
  if (!isObject(levels) || ["自然", "ギャップとして許容", "おまかせでは選ばない"].some(key => !Object.hasOwn(levels, key)))
    fail("missing compatibility weights");
  for (const level of Object.values(levels))
    if (typeof level !== "number" || !Number.isFinite(level) || level < 0) fail("compatibility weight");
  getObservationMonths(data);
  getSimBalance(data);
  getFamilyEventRules(data);
  return data;
}

const familyCache = new WeakMap();
// P-21 currently stores its numbers in prose. Parse only the documented grammar;
// never evaluate text or substitute guessed values for unresolved tuning.
export function getFamilyEventRules(params) {
  if (Object.isFrozen(params) && familyCache.has(params)) return familyCache.get(params);
  const source = params.collections.familyEventParams;
  const event = id => params.collections.events.find(row => row.id === id);
  const capture = (text, pattern) => {
    const match = typeof text === "string" && pattern.exec(text);
    if (!match) fail("P-21 grammar");
    return match.slice(1).map(value => Number(value.replaceAll("−", "-")));
  };
  const range = text => capture(text, /([−+]?\d+)～([−+]?\d+)/u);
  const c93 = capture(event("EV93")?.conditionsAndBehavior,
    /^既婚またはパートナー同居、良好度≥(\d+)、本人の実年齢(\d+)～(\d+)歳、子の人数≤(\d+)。一周に最大(\d+)回。\(ii\)\(iv\)の後は(\d+)か月以上あける$/u);
  const w93 = capture(event("EV93")?.weight.text, /^月([\d.]+)（子が(\d+)人以上なら×([\d.]+)）$/u);
  const c94 = capture(event("EV94")?.conditionsAndBehavior, /^関係ごとの緊張度≥(\d+)$/u);
  const c95 = capture(event("EV95")?.conditionsAndBehavior, /^EV94が同じ相手で(\d+)回以上、かつ緊張度≥(\d+)$/u);
  const coefficients = source.strainCoefficients;
  if (!Array.isArray(coefficients) || coefficients.length !== 8 || source.noCorrectAnswer !== true || source.directPenalty !== false)
    fail("P-21 strain/choice policy");
  const activity = capture(coefficients[0].要因, /^週の活動時間が(\d+)時間超$/u)[0];
  const consecutive = capture(coefficients[1].要因, /^(\d+)時間超が(\d+)週以上連続$/u);
  if (activity !== consecutive[0]) fail("P-21 overwork thresholds");
  const strain = {
    activity, consecutive: consecutive[1],
    privateHours: capture(coefficients[2].要因, /^私生活の時間が週(\d+)時間未満$/u)[0],
    neglect: capture(coefficients[3].要因, /^相手と十分な時間を過ごしていない週が(\d+)週以上$/u)[0],
    changes: coefficients.map(row => capture(row.変化, /([+−]\d+)/u)[0]),
  };
  if (source.ev93Choices?.length !== 4 || source.ev95Choices?.length !== 4 || source.ev96Choices?.length !== 4)
    fail("P-21 choices");
  const a = source.ev93Choices;
  const leave = capture(a[0]["休止・復帰"], /^birthRole本人：休止(\d+)～(\d+)か月／パートナー：育児休業(\d+)～(\d+)か月。授かるまで(\d+)～(\d+)か月（一様）$/u);
  const probabilities = source.ev95Choices.map((row, i) => i === 2 ? null :
    ["話し合いで続く", "疎遠（友人）／距離を置く", "別れる"].map(key => capture(row[key], /^([\d.]+)→([\d.]+)$/u)));
  for (const row of probabilities.filter(Boolean)) for (let end = 0; end < 2; end++)
    if (row.some(pair => pair[end] < 0 || pair[end] > 1) || Math.abs(row.reduce((n, pair) => n + pair[end], 0) - 1) > 1e-9)
      fail("P-21 outcome probabilities");
  // The third outcome is categorical, not an inferred probability.
  const accept = source.ev95Choices[2];
  if (accept["話し合いで続く"] !== "0.00" || accept["疎遠（友人）／距離を置く"] !== "友人は1.00（疎遠）／パートナーは0.00" ||
      accept["別れる"] !== "パートナーは1.00") fail("P-21 accepted ending");
  const child = key => params.collections.householdInitial.children.find(row => row.項目 === key)?.値;
  const care = capture(child("育児負荷（週の時間、子1人あたり）"), /^(\d+)～(\d+)歳(\d+)時間、(\d+)～(\d+)歳(\d+)時間、(\d+)～(\d+)歳(\d+)時間、(\d+)～(\d+)歳(\d+)時間。2人目以降は×([\d.]+)$/u);
  const rules = {
    strain,
    ev93: { quality: c93[0], minAge: c93[1], maxAge: c93[2], maxChildren: c93[3], maxCount: c93[4], cooldown: c93[5],
      chance: event("EV93").weight.value ?? w93[0], childThreshold: w93[1], childMultiplier: w93[2],
      qualityChanges: a.map(row => range(row["パートナー関係（良好度）"])),
      selfLeave: leave.slice(0, 2), partnerLeave: leave.slice(2, 4), birthDelay: leave.slice(4, 6),
      shortLeave: range(a[2]["休止・復帰"]), reductions: [range(a[0].活動時間).map(Math.abs).sort((x,y) => x-y),
        range(a[2].活動時間).map(Math.abs).sort((x,y) => x-y)], defer: range(a[3]["休止・復帰"]) },
    ev94: { threshold: c94[0], chance: event("EV94").weight.value ?? capture(event("EV94")?.weight.text, /^条件を満たした週に([\d.]+)$/u)[0] },
    ev95: { warnings: c95[0], threshold: c95[1], chance: event("EV95").weight.value ?? capture(event("EV95")?.weight.text, /^条件を満たした月に([\d.]+)$/u)[0], probabilities },
    ev96: { reduction: range(source.ev96Choices[1]).map(Math.abs).sort((x,y) => x-y), extension: range(source.ev96Choices[2]) },
    birthRoleWeights: capture(child("birthRole"), /^子の計画がある場合、本人([\d.]+)／パートナー([\d.]+)（性別を推定しない）$/u),
    careBands: Array.from({ length: 4 }, (_, i) => care.slice(i * 3, i * 3 + 3)), siblingFactor: care[12],
    choices: { EV93: a.map(row => row.選択肢), EV95: source.ev95Choices.map(row => row.選択肢), EV96: [...source.ev96Choices] },
  };
  if (event("EV96")?.weight.text !== "条件で確定") fail("P-21 return condition");
  for (const value of [rules.ev93.chance, rules.ev93.childMultiplier, rules.ev94.chance, rules.ev95.chance, ...rules.birthRoleWeights])
    if (!Number.isFinite(value) || value < 0 || value > 1) fail("P-21 probability");
  for (const bounds of [...rules.ev93.qualityChanges, rules.ev93.selfLeave, rules.ev93.partnerLeave, rules.ev93.birthDelay,
    rules.ev93.shortLeave, ...rules.ev93.reductions, rules.ev93.defer, rules.ev96.reduction, rules.ev96.extension])
    if (bounds.some(value => !Number.isSafeInteger(value)) || bounds[0] > bounds[1]) fail("P-21 range");
  if (rules.ev93.minAge > rules.ev93.maxAge || rules.ev93.quality > 100 || rules.ev94.threshold > 100 ||
      rules.ev95.threshold >= 100 || rules.ev95.warnings < 1 || rules.ev93.maxCount < 1 ||
      rules.ev96.reduction[1] > 100 || rules.ev93.reductions.some(pair => pair[1] > 100) ||
      rules.birthRoleWeights.reduce((a, b) => a + b, 0) <= 0) fail("P-21 bounds");
  if (Object.isFrozen(params)) familyCache.set(params, deepFreeze(rules));
  return rules;
}

// All tuning values, including format allocation and growth, come from P-22.
export function getSimBalance(params) {
  const b = params?.collections?.simBalance;
  if (params?.balanceVersion !== BALANCE_VERSION || !isObject(b) || b.evidenceClass !== "仮置き" ||
      typeof b.basis !== "string" || !b.basis.length) fail("simulation balance version/evidence");
  function numbers(object, keys, max = 1e9) {
    if (!isObject(object) || Object.keys(object).length !== keys.length) fail("balance fields");
    for (const key of keys) if (typeof object[key] !== "number" || !Number.isFinite(object[key]) ||
        object[key] < 0 || object[key] > max) fail(`balance ${key}`);
  }
  numbers(b.ability, ["min", "max", "practiceGainPerHour", "lessonGainPerHour"]);
  if (b.ability.min !== 0 || b.ability.max !== 100) fail("radar scale");
  numbers(b.time, ["restHoursPerDay", "lifeHoursPerDay", "fatiguePerHour", "recoveryPerDay", "fatigueLimit", "maxFatigueReduction"]);
  if (b.time.restHoursPerDay + b.time.lifeHoursPerDay > 24 || b.time.fatigueLimit <= 0 || b.time.maxFatigueReduction > 1)
    fail("time budget");
  numbers(b.lesson, ["monthlyCostYen", "monthlyHours"]);
  if (!Number.isSafeInteger(b.lesson.monthlyCostYen) || b.lesson.monthlyHours > 24 * 28) fail("lesson budget");
  numbers(b.audience, ["uniqueReachRatio", "overlapRatio", "subscribeRate", "dailyChurnRate", "regularRetention",
    "regularConversion", "attendanceMin", "attendanceMax", "walkInMax", "commentRate"]);
  for (const [key, value] of Object.entries(b.audience)) if (key !== "walkInMax" && value > 1) fail(`audience ratio ${key}`);
  if (!Number.isSafeInteger(b.audience.walkInMax) || b.audience.attendanceMin > b.audience.attendanceMax) fail("attendance range");
  numbers(b.discovery, ["dailyReach", "qualityFloor", "decayDays", "tailRatio", "rediscoveryAfterDays", "rediscoveryDailyChance",
    "rediscoveryMultiplier", "variationMin", "variationMax"]);
  if (b.discovery.decayDays <= 0 || b.discovery.qualityFloor > 1 || b.discovery.tailRatio > 1 ||
      b.discovery.rediscoveryDailyChance > 1 || b.discovery.variationMin > b.discovery.variationMax) fail("discovery range");
  numbers(b.money, ["adYenPerView", "supportYenPerViewerHour", "receiptShare"]);
  if (b.money.receiptShare > 1) fail("receipt share");
  const formats = ["video", "shorts", "music", "stream"];
  if (!isObject(b.formats) || Object.keys(b.formats).length !== formats.length) fail("activity formats");
  for (const key of formats) {
    const f = b.formats[key];
    if (!isObject(f)) fail(`format ${key}`);
    const { abilityWeights, ...values } = f;
    numbers(values, ["productionHours", "productionCostYen", "productionShare", "streamShare", "practiceShare",
      "streamSessionHours", "streamPreparationHours", "reachMultiplier"]);
    numbers(abilityWeights, ABILITY_AXES, 1);
    if (f.productionHours < 1 || f.streamSessionHours < 1 || !Number.isSafeInteger(f.productionCostYen) ||
        Math.abs(f.productionShare + f.streamShare + f.practiceShare - 1) > 1e-9 ||
        Math.abs(Object.values(abilityWeights).reduce((a, v) => a + v, 0) - 1) > 1e-9) fail(`format budget ${key}`);
  }
  return b;
}

export function parseParams(text) {
  if (typeof text !== "string" || text.length > 2_000_000) fail("text size");
  return deepFreeze(validateParams(JSON.parse(text)));
}

// Inject readText in Node/tests. The default only reads the bundled, same-origin URL.
export async function loadParams(readText = async url => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Params load failed (${response.status})`);
  return response.text();
}) {
  return parseParams(await readText(new URL(PARAMS_URL.href)));
}

export function getObservationMonths(params) {
  const rows = params?.collections?.provisionalValues;
  const matches = Array.isArray(rows) ? rows.filter(row => row.columns?.項目 === "観察期間") : [];
  const match = matches.length === 1 && /から(\d+)暦月/.exec(matches[0].columns["暫定値・扱い"]);
  if (!match || Number(match[1]) <= 0 || Number(match[1]) > 1200) fail("observation period");
  return Number(match[1]);
}

export function getCandidates(params, collectionName) {
  const rows = params.collections[collectionName];
  if (!Array.isArray(rows)) throw new TypeError("Not a candidate collection");
  return rows.filter(row => row.id != null && !isRetired(row));
}
