import { createCalendar, validateCalendar, dayNumber, daysBetween, addDays } from "./calendar.js";
import { CONTENT_VERSION, getObservationMonths, validateParams } from "./params.js";
import { createRng, restoreRng, RNG_STREAMS } from "./rng.js";

export const SAVE_VERSIONS = Object.freeze({
  schemaVersion: "save-0.1.0", simulationVersion: "sim-0.1.0", contentVersion: CONTENT_VERSION,
  balanceVersion: "balance-0.1.0", namingVersion: "naming-0.1.0",
  statsVersion: "not-loaded", seedFormatVersion: "seed-0.1.0",
});
export const MAX_SAVE_LENGTH = 4_000_000;
const fail = message => { throw new TypeError(`Invalid save: ${message}`); };
const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const id = value => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value);
const amount = value => Number.isSafeInteger(value) && value >= 0;
const month = value => typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) && value >= "0001-01";

// Check before JSON.stringify: otherwise NaN becomes null and undefined silently disappears.
function checkJson(value) {
  let count = 0;
  const ancestors = new Set();
  function visit(v, depth) {
    if (++count > 300000 || depth > 40) fail("structure limit");
    if (v === null || typeof v === "boolean") return;
    if (typeof v === "string") { if (v.length > 16384) fail("string limit"); return; }
    if (typeof v === "number") { if (!Number.isFinite(v)) fail("nonfinite number"); return; }
    if (typeof v !== "object" || ancestors.has(v)) fail("not JSON data");
    if (!Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null)
      fail("not a plain object");
    if (Array.isArray(v) && v.length > 100000) fail("array limit");
    ancestors.add(v);
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) visit(v[i], depth + 1);
    } else {
      for (const key of Object.keys(v)) {
        if (key.length > 128 || ["__proto__", "constructor", "prototype"].includes(key)) fail("unsafe key");
        const descriptor = Object.getOwnPropertyDescriptor(v, key);
        if (!Object.hasOwn(descriptor, "value")) fail("accessor");
        visit(descriptor.value, depth + 1);
      }
    }
    ancestors.delete(v);
  }
  visit(value, 0);
}

export function createLedger(openingBalanceYen = 0) {
  if (!amount(openingBalanceYen)) fail("opening money must be nonnegative integer yen");
  return { openingBalanceYen, balanceYen: openingBalanceYen, entries: [], settledMonths: [] };
}

function validateTransaction(entry) {
  if (!record(entry) || !id(entry.transactionId) || !month(entry.yearMonth) || !amount(entry.amountYen) ||
      !["income", "expense"].includes(entry.kind)) fail("transaction");
  const fields = ["transactionId", "yearMonth", "date", "kind", "amountYen", "personId", "workId"];
  if (Object.keys(entry).some(key => !fields.includes(key))) fail("unknown transaction field");
  for (const key of ["personId", "workId"]) if (Object.hasOwn(entry, key) && !id(entry[key])) fail("transaction reference");
  dayNumber(entry.date);
  if (entry.date.slice(0, 7) !== entry.yearMonth) fail("transaction month");
}

export function validateLedger(ledger) {
  if (!record(ledger) || !amount(ledger.openingBalanceYen) || !amount(ledger.balanceYen) ||
      !Array.isArray(ledger.entries) || !Array.isArray(ledger.settledMonths)) fail("ledger");
  const keys = new Set();
  let balance = ledger.openingBalanceYen;
  for (const entry of ledger.entries) {
    validateTransaction(entry);
    const key = `${entry.yearMonth}/${entry.transactionId}`;
    if (keys.has(key)) fail("duplicate transaction");
    keys.add(key);
    balance += entry.kind === "income" ? entry.amountYen : -entry.amountYen;
    if (!amount(balance)) fail("money overflow or unapproved debt");
  }
  if (balance !== ledger.balanceYen) fail("ledger total");
  if (ledger.settledMonths.some(value => !month(value)) || new Set(ledger.settledMonths).size !== ledger.settledMonths.length)
    fail("settled months");
  return ledger;
}

export function applyTransaction(ledger, entry) {
  checkJson(ledger); checkJson(entry); validateLedger(ledger); validateTransaction(entry);
  const old = ledger.entries.find(row => row.yearMonth === entry.yearMonth && row.transactionId === entry.transactionId);
  if (old) {
    if (Object.keys(old).length !== Object.keys(entry).length || Object.keys(old).some(key => old[key] !== entry[key]))
      fail("conflicting transaction replay");
    return ledger;
  }
  if (ledger.settledMonths.includes(entry.yearMonth)) fail("month already settled");
  const result = { ...ledger, entries: [...ledger.entries, { ...entry }],
    balanceYen: ledger.balanceYen + (entry.kind === "income" ? entry.amountYen : -entry.amountYen) };
  return validateLedger(result);
}

export function settleMonth(ledger, yearMonth, entries) {
  validateLedger(ledger);
  if (!month(yearMonth) || !Array.isArray(entries) || entries.some(entry => entry.yearMonth !== yearMonth))
    fail("settlement month");
  let result = ledger;
  const keys = new Set();
  for (const entry of entries) {
    if (keys.has(entry.transactionId)) fail("duplicate settlement transaction");
    keys.add(entry.transactionId);
    result = applyTransaction(result, entry);
  }
  if (ledger.settledMonths.includes(yearMonth)) return result;
  return { ...result, settledMonths: [...result.settledMonths, yearMonth] };
}

export function createSave(params, { seed, startDate, runId = "run-1", openingBalanceYen = 0 }) {
  validateParams(params);
  const save = {
    versions: { ...SAVE_VERSIONS }, runId, seed,
    calendar: createCalendar(startDate, getObservationMonths(params)), state: "RUNNING", stage: "boundary",
    personTemplate: null, runSetupTemplate: null,
    rng: Object.fromEntries(RNG_STREAMS.map(stream => [stream, createRng(seed, stream).snapshot()])),
    persons: [], works: [], channels: [], events: [], weeklySnapshots: [], weekProgress: null,
    ledger: createLedger(openingBalanceYen), pendingDecision: null, appliedEffectIds: [], choiceHistory: [],
  };
  return validateSave(save);
}

export function validateSave(save, expectedVersions = SAVE_VERSIONS) {
  checkJson(save);
  if (!record(save) || !record(save.versions)) fail("missing versions");
  for (const key of Object.keys(SAVE_VERSIONS))
    if (typeof expectedVersions[key] !== "string" || save.versions[key] !== expectedVersions[key]) fail(`unsupported ${key}`);
  if (Object.keys(save.versions).length !== Object.keys(SAVE_VERSIONS).length) fail("unknown version field");
  if (!id(save.runId) || !id(save.stage) || !["RUNNING", "PAUSED", "CHOICE", "EPILOGUE", "RESULT"].includes(save.state)) fail("run state");
  validateCalendar(save.calendar);
  const { currentDate, startDate } = save.calendar;
  if (!record(save.rng) || RNG_STREAMS.some(stream => !Object.hasOwn(save.rng, stream))) fail("missing random streams");
  for (const [stream, snapshot] of Object.entries(save.rng)) {
    restoreRng(snapshot);
    if (!RNG_STREAMS.includes(stream) || snapshot.seed !== save.seed || snapshot.stream !== stream) fail("random stream identity");
  }
  for (const field of ["personTemplate", "runSetupTemplate"])
    if (save[field] !== null && !record(save[field])) fail(`missing ${field}`);
  const tables = {};
  for (const field of ["persons", "works", "channels", "events"]) {
    if (!Array.isArray(save[field])) fail(`missing ${field}`);
    tables[field] = new Set();
    for (const row of save[field]) {
      if (!record(row) || !id(row.id) || tables[field].has(row.id)) fail(`duplicate or invalid ${field} ID`);
      tables[field].add(row.id);
    }
  }
  function references(value) {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      const target = { personId: "persons", personIds: "persons", workId: "works", workIds: "works",
        channelId: "channels", channelIds: "channels", eventRecordId: "events", eventRecordIds: "events" }[key];
      if (target && child !== null) {
        const values = key.endsWith("Ids") ? child : [child];
        if (!Array.isArray(values) || values.some(ref => !tables[target].has(ref))) fail(`dangling ${key}`);
      }
      if (["subscribers", "newSubscribers", "unsubscribers", "views", "comments", "S", "G", "U"].includes(key) && !amount(child))
        fail(`invalid nonnegative count ${key}`);
      if (["C", "concurrentViewers"].includes(key) && child !== null && (typeof child !== "number" || !Number.isFinite(child) || child < 0))
        fail(`invalid concurrency ${key}`);
      references(child);
    }
  }
  references(save);
  for (const work of save.works) {
    dayNumber(work.createdDate);
    if (work.createdDate > currentDate) fail("future work");
    if (work.releaseDate !== null) {
      dayNumber(work.releaseDate);
      if (work.releaseDate < work.createdDate || work.releaseDate > currentDate) fail("work release date");
    }
  }
  for (const event of save.events) {
    dayNumber(event.date);
    if (event.date < startDate || event.date > currentDate) fail("event date");
  }
  validateLedger(save.ledger);
  for (const entry of save.ledger.entries) if (entry.date > currentDate) fail("future transaction");
  if (save.ledger.settledMonths.some(value => value > currentDate.slice(0, 7))) fail("future settlement");
  if (!Array.isArray(save.weeklySnapshots)) fail("weekly records");
  const weeks = new Set();
  function checkWeek(week, completed) {
    if (!record(week)) fail("week");
    dayNumber(week.startDate); dayNumber(week.endDate);
    const days = daysBetween(week.startDate, week.endDate);
    if (week.startDate < startDate || week.endDate > currentDate || days < (completed ? 1 : 0) || days > 7) fail("week dates");
    if (!amount(week.weekIndex) || !["S", "G", "U"].every(key => amount(week[key]))) fail("weekly counts");
    if (week.startDate !== addDays(startDate, week.weekIndex * 7) ||
        (completed && (week.weekIndex >= save.calendar.weekIndex || week.endDate > save.calendar.weekStart))) fail("weekly position");
    if (![week.viewerMinutes, week.streamMinutes].every(value => typeof value === "number" && Number.isFinite(value) && value >= 0)) fail("weekly minutes");
    const average = week.streamMinutes === 0 ? null : week.viewerMinutes / week.streamMinutes;
    if (!Object.hasOwn(week, "C") || week.C !== average || (week.streamMinutes === 0 && week.viewerMinutes !== 0)) fail("weekly concurrency");
    if (completed && week.partial !== (days < 7)) fail("partial week flag");
  }
  for (const week of save.weeklySnapshots) {
    checkWeek(week, true);
    const key = `${week.weekIndex}/${week.channelId ?? ""}`;
    if (weeks.has(key)) fail("duplicate week");
    weeks.add(key);
  }
  if (save.weekProgress !== null) {
    checkWeek(save.weekProgress, false);
    if (save.weekProgress.startDate !== save.calendar.weekStart || save.weekProgress.endDate !== currentDate ||
        save.weekProgress.weekIndex !== save.calendar.weekIndex) fail("partial week cursor");
  }
  if (!Array.isArray(save.appliedEffectIds) || save.appliedEffectIds.some(value => !id(value)) ||
      new Set(save.appliedEffectIds).size !== save.appliedEffectIds.length) fail("effect IDs");
  if (!Array.isArray(save.choiceHistory)) fail("choice history");
  const choices = new Set();
  for (const choice of save.choiceHistory) {
    if (!record(choice) || !id(choice.decisionId) || !id(choice.optionId) || choices.has(choice.decisionId)) fail("choice history entry");
    dayNumber(choice.date);
    if (choice.date < startDate || choice.date > currentDate) fail("choice date");
    choices.add(choice.decisionId);
  }
  if (save.pendingDecision !== null) {
    const pending = save.pendingDecision;
    if (!record(pending) || !id(pending.id) || choices.has(pending.id) || pending.date !== currentDate ||
        !id(pending.resumeStage) || !Array.isArray(pending.options) || pending.options.length < 2 || pending.options.length > 20)
      fail("pending decision");
    const options = new Set();
    for (const option of pending.options) {
      if (!record(option) || !id(option.id) || options.has(option.id) || typeof option.label !== "string" || !option.label.length)
        fail("decision option");
      options.add(option.id);
    }
    if (!["CHOICE", "PAUSED"].includes(save.state)) fail("pending decision must stop run");
  } else if (save.state === "CHOICE") fail("choice state without decision");
  return save;
}

export function serializeSave(save, expectedVersions = SAVE_VERSIONS) {
  validateSave(save, expectedVersions);
  const text = JSON.stringify(save);
  if (text.length > MAX_SAVE_LENGTH) fail("size limit");
  return text;
}

// Pure loader: neither storage nor an existing run is modified on success or failure.
export function loadSave(text, expectedVersions = SAVE_VERSIONS) {
  try {
    if (typeof text !== "string" || text.length > MAX_SAVE_LENGTH) fail("size limit");
    return { ok: true, save: validateSave(JSON.parse(text), expectedVersions) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Invalid save" };
  }
}

// Storage is injected by the UI. A single setItem is atomic in Web Storage.
export function saveToStorage(storage, key, save) {
  try {
    const text = serializeSave(save);
    storage.setItem(key, text);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Save failed" };
  }
}
