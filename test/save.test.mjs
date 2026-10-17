import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadParams } from "../src/params.js";
import { advanceCalendar } from "../src/calendar.js";
import { restoreRng } from "../src/rng.js";
import { createSave, serializeSave, loadSave, validateSave, createLedger, applyTransaction, settleMonth, saveToStorage, SAVE_VERSIONS, MAX_SAVE_LENGTH } from "../src/save.js";

const params = await loadParams(url => readFile(url, "utf8"));
const fresh = () => createSave(params, { seed: "life-1", startDate: "2020-01-29", openingBalanceYen: 1000 });
const entry = (transactionId, kind, amountYen) => ({ transactionId, yearMonth: "2020-01", date: "2020-01-31", kind, amountYen });
const restored = save => {
  const result = loadSave(serializeSave(save));
  assert.equal(result.ok, true, result.error);
  return result.save;
};

test("AT06/AT14 foundation: pending choice preserves midweek state and the next random draw", () => {
  const save = fresh();
  save.calendar = advanceCalendar(save.calendar, ["2020-01-31"]).calendar;
  const rng = restoreRng(save.rng.activity);
  rng.next(); rng.next(); save.rng.activity = rng.snapshot();
  save.weekProgress = { weekIndex: 0, startDate: "2020-01-29", endDate: "2020-01-31",
    S: 10, G: 12, U: 2, C: null, viewerMinutes: 0, streamMinutes: 0 };
  save.ledger = applyTransaction(save.ledger, entry("salary", "income", 500));
  save.state = "CHOICE"; save.stage = "choice";
  save.pendingDecision = { id: "decision-1", date: "2020-01-31", resumeStage: "effects",
    options: [{ id: "continue", label: "続ける" }, { id: "rest", label: "休む" }], rngKeys: ["EV01", 0] };
  save.appliedEffectIds = ["effect-1"];
  const copy = restored(save);
  assert.deepEqual(copy, save);
  assert.equal(restoreRng(copy.rng.activity).next(), rng.next());
  assert.equal(applyTransaction(copy.ledger, entry("salary", "income", 500)).balanceYen, 1500);
  assert.equal(copy.calendar.currentDate, "2020-01-31");
  assert.equal(copy.pendingDecision.id, "decision-1");
});

test("AT06 foundation: resume at a month boundary never pays a completed month twice", () => {
  const save = fresh();
  save.calendar = advanceCalendar(save.calendar).calendar;
  assert.equal(save.calendar.currentDate, "2020-02-01");
  const entries = [entry("salary", "income", 3000), entry("rent", "expense", 900)];
  save.ledger = settleMonth(save.ledger, "2020-01", entries);
  const copy = restored(save);
  copy.ledger = settleMonth(copy.ledger, "2020-01", entries);
  assert.deepEqual(copy.ledger, save.ledger);
  assert.equal(copy.ledger.balanceYen, 3100);
  assert.equal(copy.ledger.entries.length, 2);
  assert.throws(() => applyTransaction(copy.ledger, entry("rent", "expense", 901)));
  assert.throws(() => applyTransaction(copy.ledger, entry("late", "expense", 1)));
  const before = serializeSave(copy);
  assert.throws(() => settleMonth(copy.ledger, "2020-02", [entry("wrong-month", "income", 1)]));
  assert.equal(serializeSave(copy), before);
});

test("AT15 foundation: integer yen transactions refuse overflow, debt, duplicates and fractions atomically", () => {
  const ledger = createLedger(100);
  for (const value of [-1, NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(() => applyTransaction(ledger, entry("bad", "income", value)));
  assert.throws(() => applyTransaction(ledger, entry("debt", "expense", 101)));
  assert.throws(() => applyTransaction(createLedger(Number.MAX_SAFE_INTEGER), entry("overflow", "income", 1)));
  assert.throws(() => settleMonth(ledger, "2020-01", [entry("same", "income", 1), entry("same", "income", 1)]));
  assert.deepEqual(ledger, createLedger(100));
});

test("AT15/AT19 foundation: malformed saves and dangling references are rejected", () => {
  const mutations = [
    s => { s.calendar.currentDate = "2020-02-30"; },
    s => { s.calendar.weekIndex = 99; },
    s => { s.calendar.endDate = "2040-01-01"; },
    s => { s.ledger.balanceYen = -1; },
    s => { s.ledger.entries = [entry("same", "income", 1), entry("same", "income", 1)]; },
    s => { s.events = [{ id: "event-1", date: "2020-01-29", workId: "absent" }]; },
    s => { s.events = [{ id: "event-1", date: "2020-01-29", personId: "absent" }]; },
    s => { s.works = [{ id: "work-1", createdDate: "2020-01-29", releaseDate: "2020-01-30" }]; },
    s => { s.persons = [{ id: "person-1" }, { id: "person-1" }]; },
    s => { s.persons = [{ id: "person-1", subscribers: -1 }]; },
    s => { s.state = "CHOICE"; },
    s => { delete s.rng.person; },
    s => { s.rng.activity.state = 2 ** 32; },
    s => { s.appliedEffectIds = ["duplicate", "duplicate"]; },
    s => { s.personTemplate = { text: "a".repeat(16385) }; },
  ];
  for (const mutate of mutations) {
    const save = fresh(); mutate(save);
    assert.equal(loadSave(JSON.stringify(save)).ok, false);
    assert.throws(() => serializeSave(save));
  }
  for (const key of Object.keys(SAVE_VERSIONS)) {
    const save = fresh(); save.versions[key] = "unknown";
    assert.equal(loadSave(JSON.stringify(save)).ok, false);
  }
  const nonfinite = fresh(); nonfinite.personTemplate = { value: NaN };
  assert.throws(() => serializeSave(nonfinite));
  const cyclic = fresh(); cyclic.personTemplate = cyclic;
  assert.throws(() => serializeSave(cyclic));
  const unsafe = JSON.stringify(fresh()).replace('"runId":', '"__proto__":{"polluted":true},"runId":');
  assert.equal(loadSave(unsafe).ok, false);
  assert.equal({}.polluted, undefined);
  for (const text of ["{", "null", "[]", "x".repeat(MAX_SAVE_LENGTH + 1)]) assert.equal(loadSave(text).ok, false);
});

test("AT07/AT15 foundation: no stream is null concurrency and a zero-audience stream is zero", () => {
  const save = fresh();
  save.calendar = advanceCalendar(save.calendar, ["2020-01-30"]).calendar;
  save.weekProgress = { weekIndex: 0, startDate: "2020-01-29", endDate: "2020-01-30",
    S: 0, G: 0, U: 0, C: null, viewerMinutes: 0, streamMinutes: 0 };
  validateSave(save);
  save.weekProgress.C = 0;
  assert.throws(() => validateSave(save));
  save.weekProgress.streamMinutes = 60;
  assert.equal(restored(save).weekProgress.C, 0);
  save.weekProgress.viewerMinutes = 90; save.weekProgress.C = 1.5;
  validateSave(save);
  save.weekProgress.C = 2;
  assert.throws(() => validateSave(save));
});

test("AT19 foundation: validation/storage failures leave the original stored save intact", () => {
  let stored = serializeSave(fresh());
  const original = stored;
  const storage = { setItem(key, value) { assert.equal(key, "run"); stored = value; } };
  const invalid = fresh(); invalid.versions.schemaVersion = "future";
  assert.equal(saveToStorage(storage, "run", invalid).ok, false);
  assert.equal(stored, original);
  assert.equal(loadSave("broken").ok, false);
  assert.equal(stored, original);
  assert.equal(saveToStorage({ setItem() { throw new Error("quota"); } }, "run", fresh()).ok, false);
  assert.equal(stored, original);
  assert.equal(saveToStorage(storage, "run", fresh()).ok, true);
  const loaded = loadSave(stored); loaded.save.runId = "changed";
  assert.equal(stored, original);
});

test("AT15/AT23 foundation: completed weekly records retain valid entity references and calendar positions", () => {
  const save = fresh();
  save.calendar = advanceCalendar(advanceCalendar(save.calendar).calendar).calendar;
  save.persons = [{ id: "person-1" }];
  save.channels = [{ id: "channel-1", personId: "person-1" }];
  save.works = [{ id: "work-1", personId: "person-1", createdDate: "2020-01-29", releaseDate: "2020-01-30" }];
  save.events = [{ id: "event-1", workId: "work-1", personId: "person-1", date: "2020-01-30" }];
  save.weeklySnapshots = [{ weekIndex: 0, startDate: "2020-01-29", endDate: "2020-02-05",
    partial: false, channelId: "channel-1", S: 5, G: 7, U: 2, C: null, viewerMinutes: 0, streamMinutes: 0 }];
  assert.deepEqual(restored(save), save);
  const week = save.weeklySnapshots[0];
  for (const patch of [{ weekIndex: 2 }, { startDate: "2020-01-30" }, { partial: true }, { channelId: "missing" }, { G: -1 }]) {
    save.weeklySnapshots = [{ ...week, ...patch }];
    assert.throws(() => validateSave(save));
  }
  save.weeklySnapshots = [week, { ...week }];
  assert.throws(() => validateSave(save));
});
