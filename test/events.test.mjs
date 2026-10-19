import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadParams, validateParams, getFamilyEventRules, getHeavyEventRules, RECURRENT_HEAVY_EVENT_IDS, ABILITY_AXES } from "../src/params.js";
import { addDays, addMonths } from "../src/calendar.js";
import { HEAVY_EVENT_IDS, SUPPORT_CARD, eventWeight, offerEvent, advanceEvents, resolveEventChoice } from "../src/events.js";
import { advanceRelationshipWeek, applyFamilyChoice, familyEligible } from "../src/household.js";
import { createSimulation, runToEnd, advanceToBoundary, requestEvent, answerDecision, setPaused,
  serializeSimulation, loadSimulation, respondToRelationshipWarning } from "../src/sim.js";

const params = await loadParams(url => readFile(url, "utf8"));
function initial(seed = "family", role = "self") {
  return { seed, personTemplate: { age: 30,
    abilities: Object.fromEntries(ABILITY_AXES.map(axis => [axis, 40])),
    life: { monthlyIncomeYen: 150000, livingCostYen: 100000, openingBalanceYen: 100000,
      workHoursPerWeek: 40, careHoursPerWeek: 0 },
    household: { maritalStatus: "married", partner: { id: "partner-1", relationship: 75 },
      partnerShare: 0.5, children: [], childcareHoursPerWeek: 0, birthRole: role, disclosure: "private" } },
    runSetupTemplate: { startDate: "2020-01-29", policy: { format: "video", liveMode: "off", voiceTraining: false } } };
}
function tune(mutator = () => {}) {
  const p = structuredClone(params);
  // Isolate family/scheduling fixtures; shipped-weight integration is separate.
  for (const row of p.collections.events) if (RECURRENT_HEAVY_EVENT_IDS.includes(row.id)) row.weight.value = 0;
  const period = p.collections.provisionalValues.find(row => row.columns.項目 === "観察期間");
  period.columns["暫定値・扱い"] = period.columns["暫定値・扱い"].replace(/から\d+暦月/u, "から36暦月");
  mutator(p);
  return validateParams(p);
}
function choose(p, run, index) {
  return answerDecision(p, run, run.pendingDecision.id, run.pendingDecision.options[index].id);
}

test("AT04/AT06: pending choice at a partial week/month boundary is atomic and survives pause/save", () => {
  let run = createSimulation(params, initial());
  run = advanceToBoundary(params, run, ["2020-01-30"]);
  for (const date of ["2020-01-30", "2020-02-01"]) {
    if (date !== run.calendar.currentDate) run = advanceToBoundary(params, run);
    const pending = requestEvent(params, run, "EV93");
    const before = serializeSimulation(params, pending);
    assert.strictEqual(runToEnd(params, pending), pending);
    assert.strictEqual(advanceToBoundary(params, pending), pending);
    assert.equal(serializeSimulation(params, pending), before);
    const restored = loadSimulation(params, before);
    assert.equal(restored.ok, true);
    const result = choose(params, restored.run, 1);
    assert.deepEqual(result, choose(params, pending, 1));
    assert.deepEqual(result.ledger, pending.ledger);
    assert.deepEqual(result.weeklySnapshots, pending.weeklySnapshots);
    assert.equal(result.calendar.currentDate, date);
    assert.strictEqual(answerDecision(params, result, pending.pendingDecision.id, "option-2"), result);
    assert.throws(() => answerDecision(params, result, pending.pendingDecision.id, "option-1"));
    const paused = setPaused(params, pending, true);
    assert.equal(choose(params, paused, 1).state, "PAUSED");
    assert.equal(setPaused(params, paused, false).state, "CHOICE");
  }
});

test("AT06/AT14: simultaneous monthly candidates resume in saved order without rerolls or repeat charges", () => {
  const p = tune(p => {
    p.collections.events.find(e => e.id === "EV93").weight.text = "月1（子が1人以上なら×0.6）";
    p.collections.events.find(e => e.id === "EV86").weight.value = 1;
  });
  const start = createSimulation(p, initial());
  const pending = runToEnd(p, start);
  assert.equal(pending.state, "CHOICE");
  assert.equal(pending.calendar.currentDate, "2020-02-01");
  assert.equal(pending.eventState.queue.length, 1);
  function finishTwo(run) {
    for (let i = 0; i < 2; i++) run = choose(p, run, run.pendingDecision.eventId === "EV93" ? 1 : 0);
    return run;
  }
  const expected = finishTwo(pending);
  assert.deepEqual(finishTwo(loadSimulation(p, serializeSimulation(p, pending)).run), expected);
  assert.equal(expected.choiceHistory.length, 2);
  assert.equal(expected.state, "RUNNING");
  assert.equal(expected.ledger.settledMonths.length, 1);
  const split = advanceToBoundary(p, start, ["2020-01-30"]);
  assert.deepEqual(runToEnd(p, split), pending);
});

test("AT116/AT135: all heavy definitions have configured chances and always carry a fixed support card", () => {
  const base = createSimulation(params, initial());
  for (const id of HEAVY_EVENT_IDS) {
    const run = structuredClone(base);
    if (id === "EV95") Object.assign(run.household.relationships[0], { strain: 90, warnings: 2 });
    else {
      assert.equal(eventWeight(params, id, run), getHeavyEventRules(params)[id].chance);
      assert.ok(eventWeight(params, id, run) > 0);
      assert.ok(!run.eventState.unresolvedWeights.includes(id));
    }
    const pending = requestEvent(params, run, id, id === "EV95" ? "partner-1" : null);
    assert.deepEqual(pending.pendingDecision.supportCard, SUPPORT_CARD);
    assert.deepEqual(pending.events.at(-1).supportCard, SUPPORT_CARD);
    assert.equal(pending.state, "CHOICE");
    assert.equal(loadSimulation(params, serializeSimulation(params, pending)).ok, true);
  }
});

test("AT135 component: numeric heavy weights use identical seeded selection regardless of display settings", () => {
  const p = tune(p => { for (const e of p.collections.events) if (HEAVY_EVENT_IDS.includes(e.id) && e.id !== "EV95") e.weight.value = 1; });
  const a = createSimulation(p, initial()), b = structuredClone(a);
  b.displaySettings = { heavyEvents: "none", speed: 4 };
  const left = runToEnd(p, a), right = runToEnd(p, b);
  assert.deepEqual(left.pendingDecision, right.pendingDecision);
  assert.deepEqual(left.eventState, right.eventState);
  assert.equal(left.eventState.queue.length, 4);
  assert.equal(left.pendingDecision.supportCard.text, SUPPORT_CARD.text);
});

test("AT15/AT135: heavy rules read numeric chances and strict recurrence grammar from params", () => {
  const expected = { EV14: [0.01, 12], EV25: [0.01, 12], EV86: [0.015, 12], EV87: [0.005, 24], EV88: [0.015, 6] };
  const rules = getHeavyEventRules(params);
  for (const [id, [chance, intervalMonths]] of Object.entries(expected)) {
    assert.deepEqual(rules[id], { chance, intervalMonths });
    const row = params.collections.events.find(row => row.id === id);
    assert.equal(row.weight.evidenceClass, "仮置き");
    assert.match(row.weight.basis, /統計値ではない/u);
    for (const invalid of [null, -0.1, 1.1, "0.01", NaN]) {
      assert.throws(() => tune(p => { p.collections.events.find(e => e.id === id).weight.value = invalid; }));
    }
    for (const invalid of [null, "未設定", "再発間隔0か月", "再発間隔1.5か月", "再発間隔-1か月", "再発間隔12か月 extra"]) {
      assert.throws(() => tune(p => { p.collections.events.find(e => e.id === id).weight.text = invalid; }));
    }
  }
  const p = tune(p => {
    const row = p.collections.events.find(e => e.id === "EV86");
    row.weight.value = 0.2; row.weight.text = "再発間隔7か月";
  });
  assert.deepEqual(getHeavyEventRules(p).EV86, { chance: 0.2, intervalMonths: 7 });
  assert.equal(eventWeight(p, "EV86", createSimulation(p, initial())), 0.2);
  assert.deepEqual(getFamilyEventRules(p).ev95, getFamilyEventRules(params).ev95);
});

test("AT15/AT135: heavy recurrence grammar rejects trailing line terminators", () => {
  for (const id of RECURRENT_HEAVY_EVENT_IDS) {
    const original = params.collections.events.find(row => row.id === id).weight.text;
    for (const ending of ["\n", "\r", "\r\n", "\u2028", "\u2029"]) {
      const p = structuredClone(params);
      p.collections.events.find(row => row.id === id).weight.text = original + ending;
      assert.throws(() => getHeavyEventRules(p), /heavy event rule/);
      assert.throws(() => validateParams(p), /heavy event rule/);
    }
  }
});

test("AT135: heavy monthly chances do not trigger on weekly boundaries after cooldown expires", () => {
  for (const id of RECURRENT_HEAVY_EVENT_IDS) {
    const p = tune(p => {
      p.collections.events.find(row => row.id === id).weight.value = 1;
      p.collections.events.find(row => row.id === "EV93").weight.value = 0;
    });
    const run = createSimulation(p, initial());
    const interval = getHeavyEventRules(p)[id].intervalMonths;
    offerEvent(p, run, id);
    resolveEventChoice(p, run, run.pendingDecision.id, "option-2");
    const readyDate = addMonths(run.calendar.currentDate, interval);
    run.calendar.currentDate = readyDate;
    run.calendar.weekIndex++;
    advanceEvents(p, run, { week: true });
    assert.equal(run.pendingDecision, null, `${id} must wait for a monthly draw`);
    assert.equal(run.events.filter(row => row.kind === "catalog" && row.eventId === id).length, 1);

    run.calendar.currentDate = addMonths(`${readyDate.slice(0, 7)}-01`, 1);
    advanceEvents(p, run, { month: true });
    assert.equal(run.pendingDecision.eventId, id);
    assert.equal(run.pendingDecision.date, run.calendar.currentDate);
    assert.deepEqual(run.pendingDecision.supportCard, SUPPORT_CARD);
    assert.equal(run.events.filter(row => row.kind === "catalog" && row.eventId === id).length, 2);
  }
});

test("AT135: every heavy ID respects its recurrence boundary, month-end clipping and unrelated history", () => {
  for (const id of RECURRENT_HEAVY_EVENT_IDS) {
    const p = tune(p => {
      const row = p.collections.events.find(e => e.id === id);
      row.weight.value = 1; row.weight.text = "再発間隔1か月";
      p.collections.events.find(e => e.id === "EV93").weight.value = 0;
    });
    const input = initial(); input.runSetupTemplate.startDate = "2020-01-31";
    const pending = requestEvent(p, createSimulation(p, input), id);
    const answered = choose(p, pending, 0);
    assert.throws(() => requestEvent(p, answered, id), /ineligible/);
    const other = RECURRENT_HEAVY_EVENT_IDS.find(other => other !== id);
    assert.equal(requestEvent(p, answered, other).pendingDecision.eventId, other);
    // Isolate event eligibility from weekly scheduling; duplicate non-catalog
    // records and another ID must not postpone this ID's recurrence.
    answered.events.push({ kind: "rediscovery", eventId: id, date: "2020-02-28" });
    for (const date of ["2020-02-28", "2020-02-29"]) {
      const run = structuredClone(answered);
      run.calendar.currentDate = date;
      advanceEvents(p, run, { month: true });
      assert.equal(run.pendingDecision?.eventId ?? null, date === "2020-02-29" ? id : null);
    }
  }
});

test("AT06/AT135: shipped recurrence intervals restart after each occurrence and survive restored history", () => {
  const rules = getHeavyEventRules(params);
  for (const id of RECURRENT_HEAVY_EVENT_IDS) {
    const first = choose(params, requestEvent(params, createSimulation(params, initial()), id), 1);
    const loaded = loadSimulation(params, serializeSimulation(params, first));
    assert.equal(loaded.ok, true, loaded.error);
    const run = loaded.run;
    let previousDate = run.calendar.currentDate;
    // Exercise event eligibility directly at exact dates, without a monthly
    // random draw obscuring whether the shipped cooldown has expired.
    for (let occurrence = 2; occurrence <= 3; occurrence++) {
      const readyDate = addMonths(previousDate, rules[id].intervalMonths);
      run.calendar.currentDate = addDays(readyDate, -1);
      const before = structuredClone(run);
      assert.throws(() => offerEvent(params, run, id), /ineligible/);
      assert.deepEqual(run, before, "rejected recurrence must not mutate history or choices");
      run.calendar.currentDate = readyDate;
      offerEvent(params, run, id);
      assert.equal(run.pendingDecision.eventRecordId, `event-${id}-${occurrence}`);
      assert.deepEqual(run.pendingDecision.supportCard, SUPPORT_CARD);
      resolveEventChoice(params, run, run.pendingDecision.id, run.pendingDecision.options[1].id);
      assert.equal(run.events.filter(record => record.kind === "catalog" && record.eventId === id).length, occurrence);
      previousDate = readyDate;
    }
  }
});

test("AT135: shipped cooldowns clip leap-day and month-end anniversaries", () => {
  const cases = [
    ["2020-02-29", { 6: "2020-08-29", 12: "2021-02-28", 24: "2022-02-28" }],
    ["2020-08-31", { 6: "2021-02-28", 12: "2021-08-31", 24: "2022-08-31" }],
  ];
  const rules = getHeavyEventRules(params);
  for (const [startDate, anniversaries] of cases) {
    for (const id of RECURRENT_HEAVY_EVENT_IDS) {
      const input = initial();
      input.runSetupTemplate.startDate = startDate;
      const first = choose(params, requestEvent(params, createSimulation(params, input), id), 1);
      const loaded = loadSimulation(params, serializeSimulation(params, first));
      assert.equal(loaded.ok, true, loaded.error);
      const run = loaded.run;
      const readyDate = anniversaries[rules[id].intervalMonths];
      assert.ok(readyDate, `missing anniversary fixture for ${id}`);
      run.calendar.currentDate = addDays(readyDate, -1);
      assert.throws(() => offerEvent(params, run, id), /ineligible/);
      run.calendar.currentDate = readyDate;
      offerEvent(params, run, id);
      assert.equal(run.pendingDecision.eventId, id);
      assert.equal(run.pendingDecision.date, readyDate);
      assert.deepEqual(run.pendingDecision.supportCard, SUPPORT_CARD);
    }
  }
});

test("AT06/AT14/AT135: legacy unresolved lists and heavy pending choices load without bypassing recurrence", () => {
  for (const id of RECURRENT_HEAVY_EVENT_IDS) {
    const pending = requestEvent(params, createSimulation(params, initial()), id);
    pending.eventState.unresolvedWeights = params.collections.events
      .filter(row => !["EV93", "EV94", "EV95", "EV96"].includes(row.id) &&
        (row.weight.value === null || RECURRENT_HEAVY_EVENT_IDS.includes(row.id))).map(row => row.id);
    const loaded = loadSimulation(params, JSON.stringify(pending));
    assert.equal(loaded.ok, true, loaded.error);
    const answered = choose(params, loaded.run, 0);
    assert.deepEqual(answered, choose(params, pending, 0));
    const resumed = loadSimulation(params, serializeSimulation(params, answered));
    assert.equal(resumed.ok, true, resumed.error);
    assert.throws(() => requestEvent(params, resumed.run, id), /ineligible/);
    assert.ok(!createSimulation(params, initial()).eventState.unresolvedWeights.includes(id));
  }
});

test("AT06/AT135: restored queues skip duplicate heavy candidates without dropping another ID", () => {
  for (const id of RECURRENT_HEAVY_EVENT_IDS) {
    const other = RECURRENT_HEAVY_EVENT_IDS.find(candidate => candidate !== id);
    const pending = requestEvent(params, createSimulation(params, initial()), id);
    pending.eventState.queue.push(
      { eventId: id, relationshipId: null },
      { eventId: other, relationshipId: null },
      { eventId: id, relationshipId: null }
    );
    const loaded = loadSimulation(params, serializeSimulation(params, pending));
    assert.equal(loaded.ok, true, loaded.error);
    const next = choose(params, loaded.run, 1);
    assert.deepEqual(next, choose(params, pending, 1));
    assert.equal(next.pendingDecision.eventId, other);
    assert.deepEqual(next.pendingDecision.supportCard, SUPPORT_CARD);
    const finished = choose(params, next, 1);
    assert.equal(finished.pendingDecision, null);
    assert.equal(finished.state, "RUNNING");
    assert.deepEqual(finished.eventState.queue, []);
    assert.deepEqual(finished.events.filter(record => record.kind === "catalog").map(record => record.eventId), [id, other]);
    assert.equal(finished.choiceHistory.length, 2);
    assert.equal(loadSimulation(params, serializeSimulation(params, finished)).ok, true);
  }
});

test("AT116/AT135: shipped monthly chances naturally produce every heavy event with deterministic support and spacing", () => {
  const seen = new Set(), rules = getHeavyEventRules(params);
  function play(seed, displaySettings) {
    const input = initial(seed);
    input.personTemplate.household = { maritalStatus: "single", children: [], birthRole: "not_applicable" };
    const run = createSimulation(params, input);
    run.displaySettings = displaySettings;
    for (let month = 1; month <= 180; month++) {
      run.calendar.currentDate = addMonths("2020-01-01", month);
      advanceEvents(params, run, { month: true });
      while (run.pendingDecision) {
        assert.deepEqual(run.pendingDecision.supportCard, SUPPORT_CARD);
        resolveEventChoice(params, run, run.pendingDecision.id, run.pendingDecision.options[0].id);
      }
    }
    return run.events.filter(row => row.kind === "catalog");
  }
  for (let seed = 0; seed < 12; seed++) {
    const records = play(seed, {});
    assert.deepEqual(records, play(seed, { heavyEvents: "none", speed: 4 }));
    const last = {};
    for (const record of records) {
      seen.add(record.eventId);
      assert.deepEqual(record.supportCard, SUPPORT_CARD);
      if (last[record.eventId]) assert.ok(record.date >= addMonths(last[record.eventId], rules[record.eventId].intervalMonths));
      last[record.eventId] = record.date;
    }
  }
  assert.deepEqual([...seen].sort(), [...RECURRENT_HEAVY_EVENT_IDS].sort());
});

test("AT140: all EV93 choices are available and 1000 declines include non-worsening outcomes", () => {
  const base = requestEvent(params, createSimulation(params, initial()), "EV93");
  assert.equal(base.pendingDecision.options.length, 4);
  for (let i = 0; i < 4; i++) {
    const result = choose(params, base, i);
    assert.equal(result.channels[0].subscribers, base.channels[0].subscribers);
    assert.deepEqual(result.abilities, base.abilities);
    assert.deepEqual(result.personTemplate, base.personTemplate);
    assert.equal(result.household.records[0].disclosure, "private");
  }
  let nonWorsening = 0, worsening = 0;
  for (let seed = 0; seed < 1000; seed++) {
    const run = structuredClone(base); run.seed = seed;
    applyFamilyChoice(params, run, run.pendingDecision, 1);
    if (run.household.relationships[0].quality >= 75) nonWorsening++; else worsening++;
  }
  assert.ok(nonWorsening > 0 && worsening > 0);
});

test("AT140: EV93 age, partner, quality, child count, recurrence limit and cooldown are enforced", () => {
  const run = createSimulation(params, initial());
  assert.equal(familyEligible(params, run, "EV93"), true);
  const rules = getFamilyEventRules(params).ev93;
  for (const mutate of [
    r => { r.personTemplate.age = rules.minAge - 1; }, r => { r.personTemplate.age = rules.maxAge + 1; },
    r => { r.household.maritalStatus = "dating"; }, r => { r.household.relationships[0].quality = rules.quality - 1; },
    r => { r.household.children = Array(rules.maxChildren + 1).fill({}); },
    r => { r.household.ev93Count = rules.maxCount; }, r => { r.household.nextFamilyDate = addMonths(r.calendar.currentDate, 1); },
  ]) { const copy = structuredClone(run); mutate(copy); assert.equal(familyEligible(params, copy, "EV93"), false); }
  const declined = choose(params, requestEvent(params, run, "EV93"), 1);
  assert.equal(declined.household.nextFamilyDate, addMonths(run.calendar.currentDate, rules.cooldown));
  assert.equal(familyEligible(params, declined, "EV93"), false);
});

test("AT141/AT145: birthRole wording and private family records do not infer gender or create audience reactions", () => {
  for (const [role, text] of [["self", "妊娠・出産のための休止と育児休業"], ["partner", "パートナーの出産に合わせた育児休業"]]) {
    const pending = requestEvent(params, createSimulation(params, initial("role", role)), "EV93");
    assert.ok(pending.pendingDecision.options[0].label.includes(text));
    const result = choose(params, pending, 0);
    assert.equal(result.household.birthRole, role);
    assert.equal(result.channels[0].subscribers, pending.channels[0].subscribers);
    assert.ok(result.household.records.every(row => !Object.hasOwn(row, "viewerReaction")));
    const returning = structuredClone(result);
    returning.household.leave = { reason: "childcare", returnDate: addMonths(returning.calendar.currentDate, 1) };
    const choice = requestEvent(params, returning, "EV96");
    assert.ok(choice.pendingDecision.options.every(option => option.label.includes(text)));
  }
});

test("AT142: P-21 strain coefficients, consecutive overload and neglect thresholds govern EV95 eligibility", () => {
  const run = createSimulation(params, initial()), relation = run.household.relationships[0];
  const r = getFamilyEventRules(params), c = r.strain.changes;
  const load = { activityHours: r.strain.activity + 1, privateHours: r.strain.privateHours - 1 };
  advanceRelationshipWeek(params, relation, load);
  assert.equal(relation.strain, c[0] + c[2]);
  relation.overworkWeeks = r.strain.consecutive - 1; relation.neglectedWeeks = r.strain.neglect - 1;
  relation.strain = 0;
  advanceRelationshipWeek(params, relation, { ...load, cancelled: true });
  assert.equal(relation.strain, c[0] + c[1] + c[2] + c[3] + c[4]);
  relation.strain = 80;
  advanceRelationshipWeek(params, relation, { activityHours: 0, privateHours: r.strain.privateHours, together: true, discussion: true, rest: true });
  assert.equal(relation.strain, 80 + c[5] + c[6] + c[7]);
  assert.equal(relation.overworkWeeks, 0); assert.equal(relation.neglectedWeeks, 0);
  relation.strain = 100;
  for (let n = 0; n < r.ev95.warnings; n++) { relation.warnings = n; assert.equal(familyEligible(params, run, "EV95", relation.id), false); }
  relation.warnings = r.ev95.warnings;
  assert.equal(familyEligible(params, run, "EV95", relation.id), true);
  relation.strain = r.ev95.threshold - 1;
  assert.equal(familyEligible(params, run, "EV95", relation.id), false);
});

test("AT142: EV94 is automatic, offers an optional response, and cannot be rerolled by save/reload", () => {
  const p = tune(p => { p.collections.events.find(e => e.id === "EV94").weight.text = "条件を満たした週に1"; });
  const run = createSimulation(p, initial()); run.household.relationships[0].strain = 60;
  const warned = runToEnd(p, run, 2);
  assert.equal(warned.state, "RUNNING");
  assert.equal(warned.household.relationships[0].warnings, 1);
  assert.ok(warned.events.some(row => row.eventId === "EV94"));
  const response = respondToRelationshipWarning(p, warned, "discussion");
  assert.equal(response.household.weeklyResponse, "discussion");
  assert.deepEqual(runToEnd(p, response, 1), runToEnd(p, loadSimulation(p, serializeSimulation(p, response)).run, 1));
});

test("AT143/AT145: EV95 outcomes include continuing, distance and separation; children and private records survive", () => {
  const input = initial(); input.personTemplate.household.children = [{ id: "child-1", relativeAge: 1 }];
  input.personTemplate.household.childcareHoursPerWeek = 10; input.personTemplate.life.careHoursPerWeek = 10;
  const run = createSimulation(params, input);
  Object.assign(run.household.relationships[0], { strain: 90, warnings: 2 });
  const pending = requestEvent(params, run, "EV95", "partner-1"), outcomes = new Set();
  for (let seed = 0; seed < 1000; seed++) {
    const copy = structuredClone(pending); copy.seed = seed;
    applyFamilyChoice(params, copy, copy.pendingDecision, 0);
    outcomes.add(copy.household.records.at(-1).outcome);
  }
  assert.deepEqual([...outcomes].sort(), ["continued", "distant", "separated"]);
  const ended = choose(params, pending, 2);
  assert.equal(ended.household.maritalStatus, "single");
  assert.equal(ended.household.children.length, 1);
  assert.equal(ended.household.childcareHoursPerWeek, 20);
  assert.deepEqual(ended.personTemplate, input.personTemplate);
  assert.equal(ended.household.records.at(-1).disclosure, "private");
  assert.deepEqual(pending.pendingDecision.supportCard, SUPPORT_CARD);
  const friend = structuredClone(run);
  friend.household.relationships.push({ ...friend.household.relationships[0], id: "friend-1", kind: "friend" });
  const distant = choose(params, requestEvent(params, friend, "EV95", "friend-1"), 2);
  assert.equal(distant.household.relationships[1].status, "distant");
  assert.equal(distant.household.maritalStatus, "married");
});

test("AT06/AT141: birth date and leave end split calendar progress; EV96 supports return, extension and EV27", () => {
  const p = tune();
  let run = choose(p, requestEvent(p, createSimulation(p, initial()), "EV93"), 0);
  // A scripted near-term date isolates scheduling from the sampled 0–24 months.
  run.household.pendingBirth = { date: addDays(run.calendar.currentDate, 1), optionId: "option-1", leaveMonths: 1, reduction: 20 };
  const saved = serializeSimulation(p, run);
  const born = advanceToBoundary(p, run);
  assert.deepEqual(born, advanceToBoundary(p, loadSimulation(p, saved).run));
  assert.equal(born.calendar.currentDate, "2020-01-30");
  assert.equal(born.household.children.length, 1);
  assert.equal(born.household.leave.reason, "childcare");
  const returning = runToEnd(p, born);
  assert.equal(returning.pendingDecision.eventId, "EV96");
  assert.equal(returning.calendar.currentDate, "2020-02-29");
  assert.equal(returning.works.length, born.works.length);
  assert.deepEqual(returning.abilities, born.abilities);
  for (const index of [0, 1]) assert.equal(choose(p, returning, index).household.leave, null);
  const extended = choose(p, returning, 2);
  assert.ok(extended.household.leave.returnDate >= addMonths(returning.calendar.currentDate, 3));
  assert.ok(extended.household.leave.returnDate <= addMonths(returning.calendar.currentDate, 6));
  const graduating = choose(p, returning, 3);
  assert.equal(graduating.pendingDecision.eventId, "EV27");
  assert.equal(choose(p, graduating, 1).state, "EPILOGUE");
});

test("AT15: corrupted choices, effect IDs, household values and malformed P-21 data are rejected", () => {
  const pending = requestEvent(params, createSimulation(params, initial()), "EV93");
  for (const mutate of [
    r => { r.pendingDecision.options[0].label = "changed"; }, r => { r.pendingDecision.eventRecordId = "missing"; },
    r => { r.household.relationships[0].strain = 101; }, r => { r.household.partnerId = "missing"; },
    r => { r.household.activityScale = -1; }, r => { r.appliedEffectIds.push("unapplied"); },
    r => { r.eventState.lastWeek = 1000; }, r => { r.eventState.unresolvedWeights = []; },
  ]) { const copy = structuredClone(pending); mutate(copy); assert.equal(loadSimulation(params, JSON.stringify(copy)).ok, false); }
  assert.throws(() => tune(p => { p.collections.familyEventParams.strainCoefficients[0].変化 = "unresolved"; }));
  assert.throws(() => tune(p => { p.collections.events.find(e => e.id === "EV95").weight.text = "条件を満たした月に2"; }));
});

test("AT03/AT04/AT06: a seeded run reaches RESULT with only major answers and preserves the initial family", () => {
  const p = tune(p => { p.collections.events.find(e => e.id === "EV93").weight.value = 1; });
  const start = createSimulation(p, initial());
  function play(restoring) {
    let run = start;
    while (run.state !== "RESULT") {
      run = runToEnd(p, run);
      if (run.pendingDecision) {
        assert.equal(run.pendingDecision.eventId, "EV93");
        if (restoring) run = loadSimulation(p, serializeSimulation(p, run)).run;
        run = choose(p, run, 1);
      }
    }
    return run;
  }
  const end = play(false);
  assert.equal(end.choiceHistory.length, getFamilyEventRules(p).ev93.maxCount);
  assert.deepEqual(end.personTemplate, start.personTemplate);
  assert.deepEqual(play(true), end);
});

test("AT24: decisions owned by the existing UI/base-save contract stay paused and are not answered by the event engine", () => {
  const run = createSimulation(params, initial());
  run.state = "CHOICE"; run.stage = "choice";
  run.pendingDecision = { id: "ui-choice", date: run.calendar.currentDate, resumeStage: "effects",
    options: [{ id: "continue", label: "続ける" }, { id: "rest", label: "休む" }] };
  assert.equal(loadSimulation(params, serializeSimulation(params, run)).ok, true);
  assert.strictEqual(runToEnd(params, run), run);
  assert.equal(setPaused(params, run, false).state, "CHOICE");
  assert.throws(() => answerDecision(params, run, "ui-choice", "continue"));
});
