import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadParams, validateParams, ABILITY_AXES } from "../src/params.js";
import { createSetup } from "../src/setup.js";
import { dreamCatalog, checkDreams, migrateLegacyDreams } from "../src/dreams.js";
import { lifeRecord } from "../src/epilogue.js";
import { alternateEra, compareRuns } from "../src/compare.js";
import { createSimulation, validateSimulation, advanceToBoundary, runToEnd, changeDream, updateDream,
  recordAchievementEvent, acknowledgeDreamPresentation, endActivity, completeEpilogue, stopObservation,
  rebirth, serializeSimulation, loadSimulation, answerDecision, requestEvent } from "../src/sim.js";

const params = await loadParams(url => readFile(url, "utf8"));
function configured(months = 2) {
  const p = structuredClone(params);
  const row = p.collections.provisionalValues.find(row => row.columns.項目 === "観察期間");
  row.columns["暫定値・扱い"] = row.columns["暫定値・扱い"].replace(/から\d+暦月/u, `から${months}暦月`);
  return validateParams(p);
}
const p = configured();
function initial(dream = null) {
  return { seed: "dream-test", personTemplate: { age: 26,
    abilities: Object.fromEntries(ABILITY_AXES.map(axis => [axis, 40])),
    life: { monthlyIncomeYen: 150000, livingCostYen: 100000, openingBalanceYen: 100000,
      workHoursPerWeek: 40, careHoursPerWeek: 5 }, household: { maritalStatus: "single" },
  }, runSetupTemplate: { startDate: "2020-01-29", policy: { format: "video", liveMode: "off", voiceTraining: true }, dream } };
}
const fresh = dream => createSimulation(p, initial(dream));
const current = run => run.dreamState.instances.find(row => row.id === run.dreamState.currentId);
const finances = run => ({ abilities: run.abilities, ledger: run.ledger, channels: run.channels, policy: run.policy, rng: run.rng });
function audience(run, value) {
  const next = structuredClone(run), channel = next.channels[0], delta = value - channel.subscribers;
  if (delta >= 0) { next.weekProgress.G += delta; next.activity.streamNewSubscribers += delta; }
  else next.weekProgress.U -= delta;
  channel.subscribers = value; next.weekProgress.S = value;
  return validateSimulation(p, next);
}
const concert = (extra = {}) => ({ type: "concert", status: "held", localAudience: 20,
  role: "solo", venueAttributes: ["dome"], allOriginal: false, ...extra });
const op = (extra = {}) => ({ type: "op", status: "released", official: true, usage: "OP", singingCredit: true, cover: false, ...extra });
const game = (extra = {}) => ({ type: "game", status: "released", licensed: true, centralIP: true, complete: true, publiclyPlayable: true, ...extra });

test("AT41/AT16: an unset dream reaches RESULT and voluntary observation stop invents no graduation", () => {
  const start = fresh(), end = runToEnd(p, start), stopped = stopObservation(p, advanceToBoundary(p, start));
  for (const run of [end, stopped]) {
    assert.equal(run.state, "RESULT"); assert.equal(run.dreamState.currentId, null);
    assert.equal(run.epilogue, null); assert.equal(run.channels[0].status, "active");
    assert.equal(run.lifeSnapshot.activityStatus, "continuing");
    assert.equal(loadSimulation(p, serializeSimulation(p, run)).ok, true);
    assert.equal(run.runSummary.initialDream, null);
  }
  assert.equal(start.lifeSnapshot, null);
  assert.equal(stopped.lifeSnapshot.reason, "observation-stop");
});

test("AT42/AT43/AT46/AT53: all twelve dreams including dome are optional; selection, hold and clearing cost nothing", () => {
  assert.equal(dreamCatalog(params).length, 12);
  assert.ok(dreamCatalog(params).some(row => row.id === "D13"));
  assert.ok(!dreamCatalog(params).some(row => row.id === "D12"));
  assert.throws(() => fresh({ definitionId: "D12" }), /dream/);
  let run = fresh({ definitionId: "D04" });
  const before = structuredClone(finances(run));
  run = updateDream(p, run, "ON_HOLD"); assert.equal(current(run).state, "ON_HOLD");
  run = updateDream(p, run, "ACTIVE");
  run = changeDream(p, run, { definitionId: "D13" });
  run = changeDream(p, run, null);
  assert.equal(run.dreamState.currentId, null); assert.equal(run.pendingDecision, null);
  assert.ok(run.dreamState.instances.every(row => row.state === "RETIRED"));
  assert.deepEqual(finances(run), before);
  let choice = requestEvent(p, fresh(), "EV86");
  const pending = structuredClone(choice.pendingDecision);
  choice = changeDream(p, choice, { definitionId: "D01" });
  assert.deepEqual(choice.pendingDecision, pending); assert.equal(choice.state, "CHOICE");
});

test("AT44/AT45/AT47: only held concerts with the agreed venue, role and setlist qualify; no live metrics leak", () => {
  let run = fresh({ definitionId: "D04", allOriginal: true });
  for (const [i, e] of [concert({ status: "announced" }), concert({ status: "postponed" }),
    concert({ role: "guest" }), concert({ venueAttributes: ["arena"], allOriginal: true }), concert()].entries()) {
    run = recordAchievementEvent(p, run, `concert-${i}`, e);
    assert.equal(current(run).state, "ACTIVE");
  }
  const before = structuredClone(finances(run));
  run = recordAchievementEvent(p, run, "concert-final", concert({ allOriginal: true }));
  assert.equal(current(run).state, "ACHIEVED");
  assert.deepEqual(finances(run), before); assert.equal(run.weekProgress.C, null);
  assert.equal(run.policy.liveMode, "off");
  const repeat = recordAchievementEvent(p, run, "concert-final", concert({ allOriginal: true }));
  assert.deepEqual(repeat, run);
  assert.throws(() => recordAchievementEvent(p, run, "concert-final", concert()), /conflicting/);
  for (const [definitionId, attribute] of [["D02", "arena"], ["D03", "symbolic"]]) {
    const result = recordAchievementEvent(p, fresh({ definitionId }), "held", concert({ venueAttributes: [attribute] }));
    assert.equal(current(result).state, "ACHIEVED");
  }
  const appearance = recordAchievementEvent(p, fresh({ definitionId: "D01", role: "appearance" }), "guest", concert({ role: "guest" }));
  assert.equal(current(appearance).state, "ACHIEVED");
});

test("AT48: official released OP singing credit is required, unlike covers, ED, insert and announcements", () => {
  let run = fresh({ definitionId: "D05" });
  for (const [i, e] of [op({ status: "announced" }), op({ usage: "ED" }), op({ usage: "insert" }),
    op({ cover: true }), op({ official: false }), op({ singingCredit: false })].entries()) {
    run = recordAchievementEvent(p, run, `op-${i}`, e); assert.equal(current(run).state, "ACTIVE");
  }
  run = recordAchievementEvent(p, run, "op-final", op());
  assert.equal(current(run).state, "ACHIEVED");
});

test("AT49/AT50/AT51: exact single-channel counts, all crossed thresholds and one presentation batch survive replay", () => {
  let run = audience(fresh({ definitionId: "D06" }), 99999);
  run = updateDream(p, run, "ACTIVE"); assert.equal(current(run).state, "ACTIVE");
  run = audience(run, 1000000); run = updateDream(p, run, "ACTIVE");
  assert.deepEqual(run.dreamState.achievements.map(row => row.definitionId), ["D06", "D07", "D08"]);
  assert.equal(run.dreamState.presentations.length, 1); assert.equal(run.pendingDecision, null);
  run = acknowledgeDreamPresentation(p, run, run.dreamState.presentations[0].id);
  run = audience(run, 90000); run = audience(run, 1000000);
  run = loadSimulation(p, serializeSimulation(p, run)).run;
  const before = structuredClone(run.dreamState);
  checkDreams(p, run); checkDreams(p, run);
  assert.deepEqual(run.dreamState, before);
  assert.equal(current(run).state, "ACHIEVED");
  const reborn = audience(rebirth(p, run, { dreamAction: "retarget" }), 99999);
  checkDreams(p, reborn);
  assert.equal(current(reborn).state, "ACTIVE");
});

function musicFixture(overrides = {}) {
  const run = fresh({ definitionId: "D09" });
  // Authored publication facts; synthetic fixture does not claim generated music is original.
  for (let i = 1; i <= 2; i++) {
    run.works.push({ id: `work-${i}`, channelId: "channel-1", createdDate: run.calendar.startDate,
      releaseDate: run.calendar.startDate, format: "music", quality: 0.5, views: 600000, comments: 0, newSubscribers: 0,
      original: true, primarySinger: true, countingReleaseId: `release-${i}`, ...(overrides.work ?? {}) });
    run.releases.push({ id: `release-${i}`, workId: `work-${i}`, releaseDate: run.calendar.startDate,
      views: 600000, weekViews: 0, comments: 0, newSubscribers: 0, weekIndex: 0,
      official: true, fullLength: true, kind: "mv", service: "primary-video", ...(overrides.release ?? {}) });
  }
  return validateSimulation(p, run);
}

test("AT52: original music uses one fixed official full release, excluding covers, Shorts, sales and other services", () => {
  let run = musicFixture(); checkDreams(p, run);
  assert.equal(current(run).state, "ACTIVE"); // Two 600,000-view songs do not sum.
  run.works[0].views = run.releases[0].views = 10000000; checkDreams(p, run);
  assert.equal(current(run).state, "ACHIEVED");
  assert.deepEqual(run.dreamState.achievements.map(row => row.definitionId), ["D09", "D10", "D11"]);
  assert.equal(run.dreamState.achievements[0].targetId, "release-1");
  for (const override of [{ work: { original: false } }, { work: { primarySinger: false } },
    { work: { countingReleaseId: "other" } }, { release: { official: false } }, { release: { fullLength: false } },
    { release: { kind: "shorts" } }, { release: { kind: "sale" } }, { release: { service: "other-service" } }]) {
    run = musicFixture(override); run.works[0].views = run.releases[0].views = 10000000;
    checkDreams(p, run); assert.equal(current(run).state, "ACTIVE");
  }
});

test("AT54: licensed central-IP completed playable game release is required", () => {
  let run = fresh({ definitionId: "D13" });
  for (const [i, e] of [game({ status: "announced" }), game({ licensed: false }), game({ centralIP: false }),
    game({ complete: false }), game({ publiclyPlayable: false })].entries()) {
    run = recordAchievementEvent(p, run, `game-${i}`, e); assert.equal(current(run).state, "ACTIVE");
  }
  run = recordAchievementEvent(p, run, "game-final", game()); assert.equal(current(run).state, "ACHIEVED");
});

test("AT55/AT56/AT57/AT58: achievement continues life, replay uses real records and private wishes stay private", () => {
  let run = advanceToBoundary(p, fresh());
  run = changeDream(p, run, { definitionId: "D01" });
  const setDate = current(run).setDate;
  run = recordAchievementEvent(p, run, "local-concert", concert({ venueAttributes: [] }));
  assert.equal(run.state, "RUNNING"); assert.equal(run.pendingDecision, null);
  const presentation = run.dreamState.presentations.at(-1);
  assert.deepEqual(presentation.publicDreamIds, []);
  assert.ok(presentation.recalledEventIds.every(id => run.events.some(row => row.id === id)));
  assert.equal(current(run).setDate, setDate);
  const before = structuredClone(finances(run)), count = run.dreamState.presentations.length;
  run = changeDream(p, run, null); run = changeDream(p, run, { definitionId: "D01" });
  assert.equal(current(run).alreadyAchieved, true);
  assert.equal(run.dreamState.presentations.length, count); assert.deepEqual(finances(run), before);
  let publicRun = updateDream(p, fresh({ definitionId: "D01" }), "public");
  publicRun = recordAchievementEvent(p, publicRun, "public-concert", concert());
  assert.deepEqual(publicRun.dreamState.presentations.at(-1).publicDreamIds, [current(publicRun).id]);
  const held = updateDream(p, fresh({ definitionId: "D01" }), "ON_HOLD");
  const achievedWhileHeld = recordAchievementEvent(p, held, "held-concert", concert());
  assert.equal(current(achievedWhileHeld).state, "ON_HOLD");
  assert.ok(achievedWhileHeld.dreamState.achievements.length > 0);
});

test("AT12/AT60: rebirth preserves age, abilities, ledger, household and history without subscribers or interval reset", () => {
  let run = runToEnd(p, fresh({ definitionId: "D06" }), 4);
  run = audience(run, 2500);
  const before = structuredClone(run);
  const next = rebirth(p, run, { dreamAction: "retarget" });
  for (const field of ["personTemplate", "abilities", "ledger", "household", "calendar", "debutAbilities"])
    assert.deepEqual(next[field], before[field]);
  assert.equal(next.channels[0].subscribers, 0); assert.equal(next.channels[1].subscribers, 2500);
  assert.equal(next.channels[1].status, "retired"); assert.equal(next.epilogue, null);
  assert.equal(current(next).targetId, "channel-2");
  assert.equal(next.dreamState.instances[0].targetId, "channel-1");
  assert.equal(current(rebirth(p, run)).state, "ON_HOLD");
  const resumed = runToEnd(p, next);
  assert.equal(resumed.calendar.endDate, run.calendar.endDate);
  assert.equal(resumed.channels[1].subscribers, 2500);
  assert.ok(resumed.works.some(row => row.channelId === "channel-2"));
  assert.equal(loadSimulation(p, serializeSimulation(p, resumed)).ok, true);
  assert.deepEqual(run, before);
});

test("AT12/AT13/AT59: another era rebuilds the fixed person, household, initial dream and rules with explicit substitutions", () => {
  const input = structuredClone(createSetup(p, { seed: "comparison-person" }).snapshot());
  input.runSetupTemplate.startDate = "2024-02-29";
  input.runSetupTemplate.policy = { format: "shorts", liveMode: "off", voiceTraining: false };
  input.runSetupTemplate.dream = { definitionId: "D06", targetRule: "initial-channel" };
  let run = createSimulation(p, input);
  run = audience(run, 100000); run = updateDream(p, run, "ACTIVE");
  run = changeDream(p, run, { definitionId: "D13" });
  const alt = alternateEra(p, run, 2017);
  assert.deepEqual(alt.personTemplate, run.personTemplate);
  assert.deepEqual(alt.household, createSimulation(p, input).household);
  assert.deepEqual(alt.abilities, run.personTemplate.abilities);
  assert.equal(alt.calendar.startDate, "2017-02-28");
  assert.equal(alt.policy.format, "video"); assert.equal(alt.policy.liveMode, "off");
  assert.equal(alt.ledger.balanceYen, run.personTemplate.life.openingBalanceYen);
  assert.equal(current(alt).definitionId, "D06"); assert.equal(current(alt).targetId, "channel-1");
  assert.equal(current(alt).state, "ACTIVE"); assert.deepEqual(alt.dreamState.achievements, []);
  assert.deepEqual(alt.works, []); assert.deepEqual(alt.choiceHistory, []);
  assert.ok(alt.comparison.differences.some(row => row.field === "policy.format"));
  const comparison = compareRuns(run, alt);
  assert.equal(comparison.axis, "elapsed-week"); assert.equal(comparison.padAfterEnd, false);
  assert.equal(comparison.differences.dreams, true);
  assert.deepEqual(alternateEra(p, run, 2017), alt);
  assert.equal(current(alternateEra(p, fresh(), 2016)), undefined);
});

test("AT12/AT60: repeated rebirth inside the same calendar week retains each channel segment and its works", () => {
  let run = advanceToBoundary(p, fresh()); // Jan 29 to Feb 1 is a partial week.
  run = rebirth(p, run);
  run = advanceToBoundary(p, run, ["2020-02-02"]);
  run = rebirth(p, run);
  run = rebirth(p, run); // No elapsed time creates no duplicate segment.
  const archive = structuredClone(run.works);
  const end = runToEnd(p, run);
  assert.equal(end.channels.length, 4);
  assert.deepEqual(end.works.slice(0, archive.length), archive);
  assert.equal(loadSimulation(p, serializeSimulation(p, end)).ok, true);
  assert.equal(new Set(end.works.map(row => row.id)).size, end.works.length);
  assert.ok(end.channelWeekSegments.every(row => row.observedStartDate <= row.endDate));
});

test("AT61: legacy dream-field initialization infers neither wishes nor first-reached dates", () => {
  const run = audience(fresh(), 1000000);
  delete run.dreamState;
  migrateLegacyDreams(p, run);
  assert.equal(run.dreamState.currentId, null);
  assert.equal(run.dreamState.achievements.length, 3);
  assert.ok(run.dreamState.achievements.every(row => row.firstReachedDate === null));
  assert.deepEqual(run.dreamState.presentations, []);
  checkDreams(p, run);
  assert.ok(run.dreamState.achievements.every(row => row.firstReachedDate === null));
  assert.deepEqual(run.dreamState.presentations, []);
  const invalid = structuredClone(run); invalid.versions.simulationVersion = "v0.2";
  assert.equal(loadSimulation(p, JSON.stringify(invalid)).ok, false); // No unimplemented full-schema migration claim.
});

test("AT67/AT16: final achievements precede epilogue, then RESULT saves the life record without future achievements", () => {
  let run = audience(fresh({ definitionId: "D06" }), 100000);
  const events = structuredClone(run.events), weeks = structuredClone(run.weeklySnapshots), ledger = structuredClone(run.ledger);
  run = endActivity(p, run);
  assert.equal(run.state, "EPILOGUE"); assert.equal(current(run).state, "ACHIEVED");
  assert.equal(run.epilogue.addedNarrative.length, 2);
  const end = advanceToBoundary(p, run);
  assert.equal(end.state, "RESULT"); assert.deepEqual(end.events, events);
  assert.deepEqual(end.weeklySnapshots, weeks); assert.deepEqual(end.ledger, ledger);
  assert.deepEqual(end.dreamState, run.dreamState);
  assert.equal(end.runSummary.epilogueId, end.epilogue.id);
  assert.equal(lifeRecord(end).timeline.length, events.length);
  assert.deepEqual(completeEpilogue(p, end), end);
  assert.equal(loadSimulation(p, serializeSimulation(p, end)).ok, true);
  const unfulfilled = endActivity(p, fresh({ definitionId: "D04" }));
  assert.equal(current(unfulfilled).state, "ENDED_UNFULFILLED");
  assert.deepEqual(unfulfilled.dreamState.achievements, []);
  assert.equal(current(stopObservation(p, fresh({ definitionId: "D04" }))).state, "ACTIVE");
});

test("AT67: EV27 uses the same ending path; malformed dream evidence and summaries are rejected", () => {
  let run = fresh({ definitionId: "D13" }); run.eventState.graduationRequested = true;
  run = requestEvent(p, run, "EV27");
  run = answerDecision(p, run, run.pendingDecision.id, "option-2");
  assert.equal(run.state, "EPILOGUE"); assert.ok(run.epilogue);
  assert.equal(runToEnd(p, run).state, "RESULT");
  const broken = structuredClone(run); broken.dreamState.currentId = "missing";
  assert.equal(loadSimulation(p, JSON.stringify(broken)).ok, false);
  const result = runToEnd(p, run); result.runSummary.reason = "invented";
  assert.equal(loadSimulation(p, JSON.stringify(result)).ok, false);
  assert.throws(() => recordAchievementEvent(p, fresh(), "bad", concert({ role: "invented" })), /evidence/);
});

test("AT50: boundary batching and save/resume give identical dreams, evidence and final records", () => {
  const start = fresh({ definitionId: "D01" });
  const scripted = recordAchievementEvent(p, start, "held", concert());
  const batch = runToEnd(p, scripted);
  let weekly = loadSimulation(p, serializeSimulation(p, scripted)).run;
  while (weekly.state === "RUNNING") weekly = advanceToBoundary(p, weekly);
  assert.deepEqual(weekly, batch);
});

test("AT43: optional dream changes leave the entire seeded activity and household trajectory unchanged", () => {
  const baseline = runToEnd(p, fresh());
  let chosen = fresh({ definitionId: "D04" });
  chosen = advanceToBoundary(p, chosen);
  chosen = changeDream(p, chosen, { definitionId: "D13" });
  chosen = updateDream(p, chosen, "ON_HOLD");
  chosen = runToEnd(p, chosen);
  for (const field of ["channels", "abilities", "ledger", "household", "works", "releases", "weeklySnapshots", "events", "rng"])
    assert.deepEqual(chosen[field], baseline[field]);
});
