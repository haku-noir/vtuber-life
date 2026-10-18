import { SAVE_VERSIONS } from "./save.js";

// The 29-character layout in 33.5 is a proposal, too small to hold arbitrary
// locks/overrides offline. This version uses variable-length groups of four.
export const SEED_VERSIONS = Object.freeze({ ...SAVE_VERSIONS, seedFormatVersion: "seed-setup-0.1.0" });
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
  for (const key of Object.keys(SEED_VERSIONS)) if (record.versions[key] !== SEED_VERSIONS[key]) throw new RangeError("別の版のたね");
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
  const text = JSON.stringify(canonical({ ...record, ...maps, freeTextOmitted }));
  let body = "";
  for (const char of text) {
    const code = char.charCodeAt(0);
    if (code > 127) fail();
    body += alphabet[Math.floor(code / alphabet.length)] + alphabet[code % alphabet.length];
  }
  const result = `VTL5-${body.match(/.{1,4}/gu).join("-")}-${check(body)}`;
  if (result.length > 16384) fail();
  return result;
}

export function decodeSeedCode(code) {
  try {
    if (typeof code !== "string" || code.length > 16384 || code.length < 12 || !code.startsWith("VTL5-")) fail();
    const parts = code.slice(5).split("-");
    const checksum = parts.pop();
    if (checksum.length !== 1 || parts.some((part, i) => i === parts.length - 1 ? ![2, 4].includes(part.length) : part.length !== 4)) fail();
    const body = parts.join("");
    if (!body.length || [...body + checksum].some(char => !alphabet.includes(char)) || check(body) !== checksum) fail();
    let text = "";
    for (let i = 0; i < body.length; i += 2) {
      const value = alphabet.indexOf(body[i]) * alphabet.length + alphabet.indexOf(body[i + 1]);
      if (value > 127) fail();
      text += String.fromCharCode(value);
    }
    const record = canonical(JSON.parse(text));
    // Reject alternate field order/duplicate keys and alternate encodings.
    if (encodeSeedCode(record) !== code) fail();
    return { ok: true, record, notices: record.freeTextOmitted ? ["自由入力の項目は共有されません"] : [] };
  } catch (error) {
    return { ok: false, error: error instanceof RangeError ? "別の版のたね" : "読み込めないたねです" };
  }
}
