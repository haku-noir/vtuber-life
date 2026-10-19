import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadParams, validateParams, RECURRENT_HEAVY_EVENT_IDS, ABILITY_AXES } from "../src/params.js";
import { addDays, addMonths, daysBetween } from "../src/calendar.js";
import { validateLedger } from "../src/save.js";
import { createSimulation, advanceToBoundary, runToEnd, answerDecision, setPaused, serializeSimulation, loadSimulation } from "../src/sim.js";

const params = await loadParams(url => readFile(url, "utf8"));
function configured(months = 3, mutate = () => {}) {
  const p = structuredClone(params);
  // These fixtures isolate activity/economy; full-length lives use shipped odds.
  for (const row of p.collections.events) if (RECURRENT_HEAVY_EVENT_IDS.includes(row.id)) row.weight.value = 0;
  const row = p.collections.provisionalValues.find(row => row.columns.項目 === "観察期間");
  row.columns["暫定値・扱い"] = row.columns["暫定値・扱い"].replace(/から\d+暦月/, `から${months}暦月`);
  mutate(p.collections.simBalance);
  return validateParams(p);
}
function initial(format = "video", startDate = "2020-01-29") {
  return { seed: "weekly-test", personTemplate: {
    abilities: Object.fromEntries(ABILITY_AXES.map(axis => [axis, 40])),
    life: { monthlyIncomeYen: 150000, livingCostYen: 100000, openingBalanceYen: 20000,
      workHoursPerWeek: 40, careHoursPerWeek: 5 },
    coreDisposition: { fixed: true }, household: { maritalStatus: "single" },
  }, runSetupTemplate: { startDate, policy: { format, liveMode: format === "stream" ? "regular" : "off", voiceTraining: true } } };
}

test("AT03/AT07/AT23: video and streaming lives reach RESULT at 180 calendar months with only major answers", () => {
  for (const format of ["video", "stream"]) {
    const input = initial(format), original = structuredClone(input);
    const start = createSimulation(params, input);
    let end = start;
    for (let n = 0; n < 200 && end.state !== "RESULT"; n++) {
      end = runToEnd(params, end);
      if (end.pendingDecision) end = answerDecision(params, end, end.pendingDecision.id, end.pendingDecision.options[0].id);
    }
    assert.deepEqual(input, original);
    assert.equal(start.calendar.currentDate, input.runSetupTemplate.startDate);
    assert.equal(end.state, "RESULT");
    assert.equal(end.calendar.currentDate, addMonths(start.calendar.startDate, 180));
    assert.equal(end.weeklySnapshots.length, Math.ceil(daysBetween(start.calendar.startDate, end.calendar.endDate) / 7));
    assert.equal(end.weeklySnapshots.at(-1).partial, true);
    assert.equal(end.weekProgress, null);
    assert.equal(end.lifeSnapshot.activityStatus, "continuing");
    assert.equal(end.channels[0].status, "active");
    assert.ok(end.works.length > 0);
    assert.ok(end.weeklySnapshots.some(w => w.G > 0));
    if (format === "video") assert.ok(end.weeklySnapshots.every(w => w.C === null && w.streamMinutes === 0));
    else assert.ok(end.weeklySnapshots.some(w => w.C > 0));
    assert.deepEqual(end.personTemplate, original.personTemplate);
    assert.deepEqual(end.debutAbilities, original.personTemplate.abilities);
    validateLedger(end.ledger);
    assert.equal(loadSimulation(params, serializeSimulation(params, end)).ok, true);
    assert.strictEqual(advanceToBoundary(params, end), end);
  }
});

test("AT06/AT14: partial-week save, month boundary and extra dated boundaries preserve the exact run", () => {
  const p = configured(), input = initial("stream"), start = createSimulation(p, input);
  const expected = runToEnd(p, start);
  let run = advanceToBoundary(p, start, [addDays(start.calendar.startDate, 1)]);
  assert.equal(run.weeklySnapshots.length, 0);
  assert.equal(run.weekProgress.endDate, "2020-01-30");
  run = loadSimulation(p, serializeSimulation(p, run)).run;
  run = advanceToBoundary(p, run);
  assert.equal(run.calendar.currentDate, "2020-02-01");
  assert.equal(run.ledger.settledMonths.length, 1);
  assert.ok(run.weekProgress);
  run = loadSimulation(p, serializeSimulation(p, run)).run;
  assert.deepEqual(runToEnd(p, run), expected);
  assert.deepEqual(runToEnd(p, createSimulation(p, input)), expected);
  let stepped = start;
  while (stepped.state === "RUNNING") stepped = advanceToBoundary(p, stepped);
  assert.deepEqual(stepped, expected);
});

test("AT05: pause, serialization and batch size do not consume simulation time or randomness", () => {
  const p = configured(1), start = createSimulation(p, initial("stream"));
  const paused = setPaused(p, runToEnd(p, start, 3), true);
  assert.strictEqual(advanceToBoundary(p, paused), paused);
  assert.strictEqual(runToEnd(p, paused), paused);
  const restored = loadSimulation(p, serializeSimulation(p, paused));
  assert.ok(restored.ok);
  assert.deepEqual(runToEnd(p, setPaused(p, restored.run, false)), runToEnd(p, start));
});

test("AT07: an actual zero-viewer stream has C=0, while no stream has C=null", () => {
  const p = configured(1, b => { b.discovery.dailyReach = 0; b.audience.walkInMax = 0; });
  const on = runToEnd(p, createSimulation(p, initial("stream")));
  const offInput = initial("stream"); offInput.runSetupTemplate.policy.liveMode = "off";
  const off = runToEnd(p, createSimulation(p, offInput));
  assert.ok(on.weeklySnapshots.some(w => w.streamMinutes > 0));
  for (const week of on.weeklySnapshots) assert.equal(week.C, week.streamMinutes ? 0 : null);
  assert.ok(off.weeklySnapshots.every(w => w.C === null));
});

test("AT09: recurring voice lessons improve singing; shortages skip optional spending without debt or retirement", () => {
  const p = configured(3), input = initial();
  const trained = runToEnd(p, createSimulation(p, input));
  input.runSetupTemplate.policy.voiceTraining = false;
  const untrained = runToEnd(p, createSimulation(p, input));
  assert.ok(trained.abilities.singing > untrained.abilities.singing);
  assert.ok(trained.economy.summaries.every(m => m.lessonCostYen > 0));
  const poor = initial(); Object.assign(poor.personTemplate.life, { monthlyIncomeYen: 0, openingBalanceYen: 0 });
  const end = runToEnd(p, createSimulation(p, poor));
  assert.equal(end.ledger.balanceYen, 0);
  assert.ok(end.economy.unmetLivingYen > 0);
  assert.ok(end.economy.summaries.every(m => m.lessonCostYen === 0 && m.productionCostYen === 0));
  assert.equal(end.policy.voiceTraining, true);
  assert.deepEqual(end.personTemplate.life, poor.personTemplate.life);
  assert.equal(end.channels[0].status, "active");
});

test("AT06/AT23: leap month and partial edge months are charged once with integer-yen reconciliation", () => {
  const p = configured(2), end = runToEnd(p, createSimulation(p, initial()));
  const months = end.economy.summaries;
  assert.deepEqual(months.map(m => [m.yearMonth, m.days]), [["2020-01", 3], ["2020-02", 29], ["2020-03", 28]]);
  assert.equal(months[0].livingDueYen, Math.floor(100000 * 3 / 31));
  assert.equal(months[1].livingDueYen, 100000);
  const keys = end.ledger.entries.map(e => `${e.yearMonth}/${e.transactionId}`);
  assert.equal(new Set(keys).size, keys.length);
  for (const m of months) {
    const entries = end.ledger.entries.filter(e => e.yearMonth === m.yearMonth);
    assert.equal(entries.filter(e => e.transactionId === "living").length, 1);
    assert.equal(entries.filter(e => e.kind === "income").reduce((n, e) => n + e.amountYen, 0), m.jobIncomeYen + m.receiptYen);
    assert.equal(m.grossRevenueYen, Object.values(m.gross).reduce((a, v) => a + v, 0));
    assert.equal(m.activityProfitYen, m.receiptYen - m.productionCostYen - m.lessonCostYen);
  }
});

test("AT07/AT14: weekly audience conservation, gross acquisition attribution and weighted concurrency", () => {
  const p = configured(4), end = runToEnd(p, createSimulation(p, initial("stream")));
  let S = 0, G = 0;
  for (const week of end.weeklySnapshots) {
    assert.equal(week.S, S + week.G - week.U); S = week.S; G += week.G;
    assert.equal(week.C, week.streamMinutes ? week.viewerMinutes / week.streamMinutes : null);
  }
  assert.equal(G, end.releases.reduce((n, r) => n + r.newSubscribers, 0) + end.activity.streamNewSubscribers);
  assert.equal(end.works.reduce((n, w) => n + w.views, 0), end.weeklySnapshots.reduce((n, w) => n + w.videoViewsThisWeek, 0));
  for (const r of end.releases) assert.equal(r.views, end.works.find(w => w.id === r.workId).views);
});

test("AT03 component: music production spans months and old releases can be rediscovered without new posts", () => {
  const p = configured(6, b => { b.discovery.rediscoveryDailyChance = 1; });
  const input = initial("music"); input.personTemplate.life.careHoursPerWeek = 20;
  const end = runToEnd(p, createSimulation(p, input));
  assert.ok(end.works.length > 0);
  assert.ok(daysBetween(end.calendar.startDate, end.works[0].releaseDate) > 30);
  assert.ok(end.events.some(e => e.kind === "rediscovery"));
  assert.ok(end.weeklySnapshots.some(w => w.videoViewsThisWeek > 0 &&
    !end.events.some(e => e.kind === "publication" && e.date >= w.startDate && e.date < w.endDate)));
  assert.ok(end.weeklySnapshots.every(w => w.C === null));
});

test("AT09: work and care consume time before optional activity, without changing initial abilities", () => {
  const p = configured(1), input = initial("stream");
  Object.assign(input.personTemplate.life, { workHoursPerWeek: 70, careHoursPerWeek: 30 });
  const end = runToEnd(p, createSimulation(p, input));
  assert.equal(end.works.length, 0);
  assert.deepEqual(end.abilities, input.personTemplate.abilities);
  assert.ok(end.weeklySnapshots.every(w => w.C === null));
  assert.ok(end.economy.summaries.every(m => m.lessonCostYen === 0));
});

test("AT15: unresolved initial data, invalid tuning, corrupt saves and mismatched versions are rejected", () => {
  for (const mutate of [
    b => { b.formats.video.productionHours = 0; }, b => { b.discovery.decayDays = 0; },
    b => { b.audience.subscribeRate = 2; }, b => { b.money.receiptShare = NaN; },
    b => { b.formats.video.abilityWeights.singing = 1; }, b => { b.lesson.monthlyCostYen = -1; },
  ]) assert.throws(() => configured(1, mutate));
  const input = initial(); input.personTemplate.life = null;
  assert.throws(() => createSimulation(params, input));
  assert.throws(() => createSimulation(params, { ...initial(), ready: false }));
  const p = configured(1), end = runToEnd(p, createSimulation(p, initial()));
  for (const mutate of [
    r => { r.versions.balanceVersion = "old"; }, r => { r.abilities.singing = 101; },
    r => { r.weeklySnapshots[0].G++; }, r => { r.releases[0].views++; },
    r => { r.economy.reservedProductionYen = r.ledger.balanceYen + 1; },
    r => { r.economy.month.lessonHoursPerDay = -1; }, r => { r.economy.unmetLivingYen++; },
  ]) {
    const bad = structuredClone(end); mutate(bad);
    assert.equal(loadSimulation(p, JSON.stringify(bad)).ok, false);
  }
  assert.equal(loadSimulation(p, "{").ok, false);
});
