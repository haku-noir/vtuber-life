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
  return data;
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
