import { SAVE_VERSIONS } from "./save.js";

export const SEED_VERSIONS = Object.freeze({ ...SAVE_VERSIONS, seedFormatVersion: "seed-setup-0.2.0" });
// Wire ID 1 permanently identifies this exact bundle, never the current runtime
// versions. A version change must allocate a new ID and retain or reject ID 1.
const versionBundle = Object.freeze({ schemaVersion: "save-0.1.0", simulationVersion: "sim-0.1.0",
  contentVersion: "0.5.0", balanceVersion: "balance-0.1.0", namingVersion: "naming-0.1.0",
  statsVersion: "not-loaded", seedFormatVersion: "seed-setup-0.2.0" });
const MAX_CODE_LENGTH = 2048;
export const SEED_FIELDS = Object.freeze(["appearance", "motif", "name", "personaStyle", "species", "occupationV", "statusV",
  "firstPerson", "address", "catchphrase", "greeting", "fanName", "profile", "tags", "mark", "speech", "world", "family",
  "mainActivity", "continuationPolicy"]);
const groups = ["v_appearance", "v_settings", "activity_policy"];
const alphabet = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const fail = () => { throw new TypeError("読み込めないたねです"); };
const object = value => value !== null && typeof value === "object" && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const uint = value => Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
const counter = value => Number.isSafeInteger(value) && value >= 0;
function keys(value, allowed, required = allowed) {
  if (!object(value) || Object.keys(value).some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(value, key))) fail();
}
function candidate(field, value) {
  if (field === "personaStyle") {
    keys(value, ["primary", "secondary"]);
    if ([value.primary, value.secondary].some(v => v !== null && (typeof v !== "string" || !/^PT\d{2}$/u.test(v))) ||
      (value.secondary !== null && (value.primary === null || value.primary === value.secondary))) fail();
    return { primary: value.primary, secondary: value.secondary };
  }
  keys(value, ["preset", "custom", "formerTitle"], ["preset", "custom"]);
  if (value.custom !== null || typeof value.preset !== "string" || !/^(?:SP|JB|ST)\d{2}$|^CS\d{2}_\d{2}$/u.test(value.preset)) fail();
  if (Object.hasOwn(value, "formerTitle")) {
    if (field !== "statusV" || (value.formerTitle !== null && (value.preset !== "ST09" ||
      typeof value.formerTitle !== "string" || !/^(JB|ST)\d{2}$/u.test(value.formerTitle) || value.formerTitle === "ST09"))) fail();
    return { preset: value.preset, custom: null, formerTitle: value.formerTitle };
  }
  return { preset: value.preset, custom: null };
}
function canonical(record) {
  keys(record, ["versions", "worldSeed", "personSeed", "vSeed", "startYearWeightMode", "rerollCount",
    "fieldGenerations", "lockedGroups", "overrides", "selections", "freeTextOmitted"]);
  keys(record.versions, Object.keys(SEED_VERSIONS));
  for (const key of Object.keys(SEED_VERSIONS))
    if (record.versions[key] !== SEED_VERSIONS[key] || record.versions[key] !== versionBundle[key])
      throw new RangeError("別の版のたね");
  if (![record.worldSeed, record.personSeed, record.vSeed].every(uint) || record.startYearWeightMode !== "uniform" || !counter(record.rerollCount)) fail();
  keys(record.fieldGenerations, SEED_FIELDS);
  if (Object.values(record.fieldGenerations).some(value => !counter(value) || value > record.rerollCount)) fail();
  if (!Array.isArray(record.lockedGroups) || record.lockedGroups.some(value => !groups.includes(value)) ||
    new Set(record.lockedGroups).size !== record.lockedGroups.length || typeof record.freeTextOmitted !== "boolean") fail();
  const maps = {};
  for (const name of ["overrides", "selections"]) {
    keys(record[name], SEED_FIELDS, []);
    maps[name] = Object.fromEntries(SEED_FIELDS.filter(field => Object.hasOwn(record[name], field))
      .map(field => [field, candidate(field, record[name][field])]));
  }
  return { versions: { ...SEED_VERSIONS }, worldSeed: record.worldSeed, personSeed: record.personSeed, vSeed: record.vSeed,
    startYearWeightMode: "uniform", rerollCount: record.rerollCount,
    fieldGenerations: Object.fromEntries(SEED_FIELDS.map(field => [field, record.fieldGenerations[field]])),
    lockedGroups: groups.filter(group => record.lockedGroups.includes(group)), ...maps, freeTextOmitted: record.freeTextOmitted };
}
function check(text) {
  let value = 0;
  for (const char of text) value = (value * 17 + alphabet.indexOf(char)) % alphabet.length;
  return alphabet[value];
}

// Fixed-width uint32 seeds, bit flags, sparse maps and unsigned base-128
// integers. Only ID namespaces/numbers cross the wire, never JSON or labels.
function pack(record) {
  const bytes = [1];
  const variable = number => {
    let value = BigInt(number);
    do { const digit = Number(value & 127n); value >>= 7n; bytes.push(digit | (value ? 128 : 0)); } while (value);
  };
  const id = value => {
    const match = /^(SP|JB|ST|CS)(\d{2})(?:_(\d{2}))?$/u.exec(value);
    if (!match) fail();
    return match[1] === "CS" ? 300 + Number(match[2]) * 100 + Number(match[3])
      : ["SP", "JB", "ST"].indexOf(match[1]) * 100 + Number(match[2]);
  };
  const writeCandidate = (field, value) => {
    if (field === "personaStyle") {
      for (const part of [value.primary, value.secondary]) bytes.push(part === null ? 0 : Number(part.slice(2)) + 1);
    } else if (field === "statusV") {
      const title = Object.hasOwn(value, "formerTitle") ? value.formerTitle === null ? 1 : 2 : 0;
      variable(id(value.preset) * 3 + title);
      if (title === 2) variable(id(value.formerTitle));
    } else variable(id(value.preset));
  };
  const mask = values => SEED_FIELDS.reduce((bits, field, i) => bits | (Object.hasOwn(values, field) ? 1 << i : 0), 0);
  const overrideMask = mask(record.overrides), selectionMask = mask(record.selections);
  const locks = groups.reduce((bits, group, i) => bits | (record.lockedGroups.includes(group) ? 1 << i : 0), 0);
  bytes.push(locks | (record.freeTextOmitted ? 8 : 0) | (record.rerollCount ? 16 : 0) |
    (overrideMask ? 32 : 0) | (selectionMask ? 64 : 0));
  for (const seed of [record.worldSeed, record.personSeed, record.vSeed])
    for (let shift = 24; shift >= 0; shift -= 8) bytes.push((seed >>> shift) & 255);
  if (record.rerollCount) {
    variable(record.rerollCount);
    const changed = SEED_FIELDS.filter(field => record.fieldGenerations[field] !== record.rerollCount);
    variable(mask(Object.fromEntries(changed.map(field => [field, true]))));
    for (const field of changed) variable(record.fieldGenerations[field]);
  }
  for (const [values, bits] of [[record.overrides, overrideMask], [record.selections, selectionMask]]) if (bits) {
    variable(bits);
    for (const field of SEED_FIELDS) if (Object.hasOwn(values, field)) writeCandidate(field, values[field]);
  }
  return bytes;
}

function unpack(bytes) {
  let offset = 0;
  const byte = () => { if (offset >= bytes.length) fail(); return bytes[offset++]; };
  const variable = () => {
    let value = 0n;
    for (let shift = 0n; shift < 56n; shift += 7n) {
      const digit = byte(); value |= BigInt(digit & 127) << shift;
      if (value > BigInt(Number.MAX_SAFE_INTEGER)) fail();
      if (!(digit & 128)) return Number(value);
    }
    fail();
  };
  const id = value => {
    if (value > 10299) fail();
    const digits = number => String(number).padStart(2, "0");
    if (value >= 300) return `CS${digits(Math.floor((value - 300) / 100))}_${digits((value - 300) % 100)}`;
    return ["SP", "JB", "ST"][Math.floor(value / 100)] + digits(value % 100);
  };
  const readCandidate = field => {
    if (field === "personaStyle") {
      const part = () => { const value = byte(); if (value > 100) fail(); return value ? `PT${String(value - 1).padStart(2, "0")}` : null; };
      return { primary: part(), secondary: part() };
    }
    const value = variable();
    if (field !== "statusV") return { preset: id(value), custom: null };
    const title = value % 3, result = { preset: id(Math.floor(value / 3)), custom: null };
    if (title) result.formerTitle = title === 1 ? null : id(variable());
    return result;
  };
  const mask = () => { const bits = variable(); if (bits >= 2 ** SEED_FIELDS.length) fail(); return bits; };
  if (byte() !== 1) throw new RangeError("別の版のたね");
  const flags = byte();
  if (flags & 128) fail();
  const seed = () => byte() * 2 ** 24 + byte() * 2 ** 16 + byte() * 256 + byte();
  const record = { versions: { ...versionBundle }, worldSeed: seed(), personSeed: seed(), vSeed: seed(),
    startYearWeightMode: "uniform", rerollCount: flags & 16 ? variable() : 0,
    fieldGenerations: {}, lockedGroups: groups.filter((group, i) => flags & (1 << i)),
    overrides: {}, selections: {}, freeTextOmitted: Boolean(flags & 8) };
  const generations = flags & 16 ? mask() : 0;
  for (const [i, field] of SEED_FIELDS.entries())
    record.fieldGenerations[field] = generations & (1 << i) ? variable() : record.rerollCount;
  for (const [name, flag] of [["overrides", 32], ["selections", 64]]) if (flags & flag) {
    const bits = mask();
    for (const [i, field] of SEED_FIELDS.entries()) if (bits & (1 << i)) record[name][field] = readCandidate(field);
  }
  if (offset !== bytes.length) fail();
  return canonical(record);
}

export function encodeSeedCode(record) {
  // Only whitelisted seed metadata and candidate IDs enter the wire record.
  keys(record, ["versions", "worldSeed", "personSeed", "vSeed", "startYearWeightMode", "rerollCount",
    "fieldGenerations", "lockedGroups", "overrides", "selections", "freeTextOmitted"],
  ["versions", "worldSeed", "personSeed", "vSeed", "startYearWeightMode", "rerollCount", "fieldGenerations", "lockedGroups", "overrides"]);
  let freeTextOmitted = record.freeTextOmitted ?? false;
  const maps = {};
  for (const name of ["overrides", "selections"]) {
    keys(record[name] ?? {}, SEED_FIELDS, []);
    maps[name] = {};
    for (const [field, value] of Object.entries(record[name] ?? {})) {
      if (value === null) continue;
      if (object(value) && typeof value.custom === "string") { freeTextOmitted = true; continue; }
      maps[name][field] = candidate(field, value);
    }
  }
  // A custom field must also lose any remembered preset in the other map.
  for (const field of SEED_FIELDS) if ([record.overrides?.[field], record.selections?.[field]].some(value => typeof value?.custom === "string")) {
    delete maps.overrides[field]; delete maps.selections[field];
  }
  const bytes = pack(canonical({ ...record, ...maps, freeTextOmitted }));
  // A leading sentinel bit preserves zero bytes without a length field.
  let value = 1n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  let body = "";
  while (value) { body = alphabet[Number(value % 31n)] + body; value /= 31n; }
  const result = `VTL5-${body.match(/.{1,4}/gu).join("-")}-${check(body)}`;
  if (result.length > MAX_CODE_LENGTH) fail();
  return result;
}

export function decodeSeedCode(code) {
  try {
    if (typeof code !== "string" || code.length > MAX_CODE_LENGTH || code.length < 12 || !code.startsWith("VTL5-")) fail();
    const parts = code.slice(5).split("-");
    const checksum = parts.pop();
    if (checksum.length !== 1 || parts.some((part, i) => i === parts.length - 1 ? part.length < 1 || part.length > 4 : part.length !== 4)) fail();
    const body = parts.join("");
    if (!body.length || [...body + checksum].some(char => !alphabet.includes(char)) || check(body) !== checksum) fail();
    let value = 0n;
    for (const char of body) value = value * 31n + BigInt(alphabet.indexOf(char));
    const bytes = [];
    while (value > 1n) { bytes.push(Number(value & 255n)); value >>= 8n; }
    if (value !== 1n) fail();
    const record = unpack(bytes.reverse());
    // Reject redundant masks, overlong integers and noncanonical base-31 forms.
    if (encodeSeedCode(record) !== code) fail();
    return { ok: true, record, notices: record.freeTextOmitted ? ["自由入力の項目は共有されません"] : [] };
  } catch (error) {
    return { ok: false, error: error instanceof RangeError ? "別の版のたね" : "読み込めないたねです" };
  }
}
