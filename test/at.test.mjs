import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { loadParams } from "../src/params.js";
import { createSetup } from "../src/setup.js";
import { createSimulation, runToEnd, advanceToBoundary, answerDecision,
  serializeSimulation, loadSimulation, endActivity, rebirth } from "../src/sim.js";
import { createObservationController } from "../web/app.js";

const params = await loadParams(url => readFile(url, "utf8"));
const root = new URL("../", import.meta.url);
const idsIn = text => text.match(/\bAT\d{2,3}\b/g) ?? [];

// Index the repository's literal top-level test(name, callback) convention.
// Comments, template examples, skipped/todo tests and options objects do not
// count. This is traceability, not proof that every clause of an AT is satisfied.
function namedTests(source) {
  const code = source.replace(
    /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|`(?:\\.|[^`\\])*`|\/\/[^\r\n]*|\/\*[\s\S]*?\*\//g,
    (text, quoted) => quoted ?? text.replace(/[^\r\n]/g, " "));
  return [...code.matchAll(/^test\(\s*(["'])([^\r\n]*?)\1\s*,\s*(?:async\s*)?(?:\([^)]*\)|[\w$]+)\s*=>\s*\{/gm)]
    .map(match => match[2]);
}

function coverageIndex(spec, sources, decisions) {
  const rows = [...spec.matchAll(/^\|\s*(AT\d{2,3})\s*\|\s*([^|\r\n]+)\|/gm)];
  const required = new Map(rows.map(row => [row[1], row[2].trim()]));
  assert.equal(required.size, rows.length, "duplicate AT in specification");
  assert.deepEqual([...required.keys()].sort(), Array.from({ length: 147 },
    (_, i) => "AT" + String(i + 1).padStart(2, "0")).sort(), "specification AT table changed");
  const named = new Map();
  for (const [file, source] of sources) {
    for (const name of namedTests(source)) for (const id of idsIn(name)) {
      assert.ok(required.has(id), "unknown test AT: " + id);
      if (!named.has(id)) named.set(id, []);
      named.get(id).push({ file, name });
    }
  }
  const section = /<!-- AT-COVERAGE-BEGIN -->([\s\S]*?)<!-- AT-COVERAGE-END -->/.exec(decisions);
  assert.ok(section, "DECISIONS coverage exception table is required");
  const exceptions = new Map();
  for (const line of section[1].split(/\r?\n/)) {
    if (!/^\|\s*AT\d/.test(line)) continue;
    const cells = line.split("|").slice(1, -1).map(cell => cell.trim());
    assert.equal(cells.length, 3, "coverage row must contain IDs, status and reason");
    const [ids, status, reason] = cells;
    assert.match(ids, /^AT\d{2,3}(?:,\s*AT\d{2,3})*$/, "enumerate each AT explicitly");
    assert.ok(["partial", "not_applicable"].includes(status), "unknown coverage status");
    assert.ok(reason.length > 10, "record a concrete scope/reason");
    for (const id of idsIn(ids)) {
      assert.ok(required.has(id), "unknown exception AT: " + id);
      assert.ok(!exceptions.has(id), "duplicate exception AT: " + id);
      exceptions.set(id, { status, reason });
    }
  }
  return [...required].map(([id, requirement]) => ({
    id, requirement, tests: named.get(id) ?? [], exception: exceptions.get(id) ?? null,
  }));
}

test("Acceptance coverage index: every specification row has a named test or an explicit scope record", async t => {
  const files = (await readdir(new URL("test/", root))).filter(file => file.endsWith(".test.mjs")).sort();
  const sources = await Promise.all(files.map(async file =>
    ["test/" + file, await readFile(new URL("test/" + file, root), "utf8")]));
  const [spec, decisions] = await Promise.all([
    readFile(new URL("docs/spec/spec-main.md", root), "utf8"),
    readFile(new URL("docs/DECISIONS.md", root), "utf8"),
  ]);
  const index = coverageIndex(spec, sources, decisions);
  const missing = index.filter(row => !row.tests.length && !row.exception);
  assert.deepEqual(missing.map(row => row.id), [], "missing AT coverage; add a real test or document the remaining work");
  for (const row of index) {
    t.diagnostic(row.id + ": " + (row.exception?.status ?? "named") + " — " +
      (row.tests.length ? [...new Set(row.tests.map(test => test.file))].join(", ") : "docs/DECISIONS.md"));
  }
});

test("Coverage index ignores prose, disabled tests and template examples", () => {
  const source = [
    '// test("AT01 commented", () => {});',
    '/*\ntest("AT02 commented", () => {});\n*/',
    'const example = `\ntest("AT03 example", () => {});\n`;',
    'test.skip("AT04 disabled", () => {});',
    'test("AT05 disabled", { skip: true }, () => {});',
    'test("AT06/AT07 active", async () => {});',
  ].join("\n");
  assert.deepEqual(namedTests(source), ["AT06/AT07 active"]);
});

function fresh(seed) {
  const setup = createSetup(params, { seed, entry: "QS1" }).snapshot();
  assert.equal(setup.ready, true);
  assert.deepEqual(setup.issues, []);
  assert.equal(setup.runSetupTemplate.dream, null);
  assert.equal(setup.runSetupTemplate.autoMajorChoices, false);
  const run = createSimulation(params, setup);
  assert.equal(run.state, "RUNNING");
  return run;
}

function restore(run) {
  const result = loadSimulation(params, serializeSimulation(params, run));
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(result.run, run);
  return result.run;
}

// Test driver only: selects the first offered major option, never changes the
// product's default autoMajorChoices=false or invents weekly inputs/events.
function finish(initial, restoring = false) {
  let run = initial;
  const decisions = [];
  let iterations = 0;
  while (run.state !== "RESULT") {
    assert.ok(++iterations <= 200, "run must terminate without a weekly input loop");
    assert.ok(["RUNNING", "CHOICE", "EPILOGUE"].includes(run.state), run.state);
    if (run.state === "CHOICE") {
      const pending = run.pendingDecision;
      assert.ok(pending && /^EV\d+$/.test(pending.eventId), "only catalog major choices may wait");
      assert.equal(runToEnd(params, run), run, "unanswered choice must stop time");
      if (restoring) run = restore(run);
      decisions.push({ id: pending.id, eventId: pending.eventId, option: pending.options[0].id });
      run = answerDecision(params, run, pending.id, pending.options[0].id);
    } else {
      const before = run.calendar.currentDate, state = run.state;
      run = runToEnd(params, run, restoring ? 96 : Number.MAX_SAFE_INTEGER);
      assert.ok(run.calendar.currentDate > before || run.state !== state,
        "automatic progress cannot wait for a routine input");
      if (restoring) run = restore(run);
    }
  }
  return { run, decisions };
}

test("AT03/AT06/AT14/AT17/AT91 partial: fixed QS1 family life finishes offline; repeat and save/resume are identical", t => {
  t.mock.method(globalThis, "fetch", () => { throw new Error("No network is needed to finish a life"); });
  // Shipped weights, dates and 180-month duration; seed 8 naturally offers
  // family/return choices. No forced event or shortened duration in this run.
  const initial = fresh(8), before = serializeSimulation(params, initial);
  const baseline = finish(initial);
  assert.ok(baseline.decisions.some(row => row.eventId === "EV93"), "exercise an actual family choice");
  assert.ok(baseline.decisions.some(row => row.eventId === "EV96"), "exercise return from leave");
  assert.equal(baseline.run.calendar.currentDate, baseline.run.calendar.endDate);
  assert.equal(baseline.run.lifeSnapshot.reason, "observation-limit");
  assert.equal(baseline.run.epilogue, null);
  assert.ok(baseline.run.weeklySnapshots.length > 750);
  assert.ok(baseline.run.works.length > 0);
  assert.equal(baseline.run.pendingDecision, null);
  assert.equal(baseline.run.dreamState.currentId, null);
  assert.deepEqual(baseline.run.personTemplate, initial.personTemplate);
  for (const candidate of [finish(fresh(8)), finish(fresh(8), true)]) {
    assert.deepEqual(candidate.decisions, baseline.decisions);
    assert.deepEqual(candidate.run, baseline.run);
    assert.equal(serializeSimulation(params, candidate.run), serializeSimulation(params, baseline.run));
  }
  assert.equal(serializeSimulation(params, initial), before, "driver must not mutate the initial life");
});

test("AT03/AT17/AT91 partial: one QS1 controller start reaches RESULT without any further input", () => {
  let sequence = 0, ticks = 0;
  const jobs = new Map();
  const controller = createObservationController(params, {
    seed: "m11-observation",
    schedule(callback, delay) {
      assert.ok(Number.isFinite(delay) && delay > 0);
      jobs.set(++sequence, callback);
      return sequence;
    },
    cancel(id) { jobs.delete(id); },
    onError(error) { throw error; },
  });
  try {
    assert.equal(controller.snapshot().run.state, "RUNNING");
    controller.start(); // The production QS1 start action; fake time only.
    while (controller.snapshot().run.state !== "RESULT") {
      assert.equal(jobs.size, 1, "automatic clock must stay armed");
      assert.ok(++ticks <= 1200, "bounded 180-month observation");
      const [id, callback] = jobs.entries().next().value;
      jobs.delete(id);
      callback();
    }
    const { run } = controller.snapshot();
    assert.equal(run.calendar.currentDate, run.calendar.endDate);
    assert.equal(run.lifeSnapshot.reason, "observation-limit");
    assert.equal(run.pendingDecision, null);
    assert.equal(run.choiceHistory.length, 0);
    assert.equal(jobs.size, 0);
  } finally {
    controller.dispose();
  }
});

test("AT14/AT35/AT36 partial: fixed QS1 retirement replays through EPILOGUE to RESULT without rewriting history", () => {
  const initial = runToEnd(params, fresh("m11-observation"), 8);
  assert.equal(initial.state, "RUNNING");
  const frozen = serializeSimulation(params, initial);
  const ending = endActivity(params, initial);
  assert.equal(ending.state, "EPILOGUE");
  assert.deepEqual(endActivity(params, restore(initial)), ending);
  const result = advanceToBoundary(params, restore(ending));
  assert.equal(result.state, "RESULT");
  assert.equal(result.runSummary.epilogueId, ending.epilogue.id);
  for (const field of ["personTemplate", "household", "events", "works", "weeklySnapshots", "ledger", "rng"])
    assert.deepEqual(result[field], initial[field], field);
  assert.deepEqual(result.epilogue.facts.childIds, initial.household.children.map(child => child.id));
  assert.deepEqual(result.epilogue.facts.relationshipIds,
    initial.household.relationships.filter(row => row.status === "active").map(row => row.id));
  assert.deepEqual(advanceToBoundary(params, endActivity(params, initial)), result);
  const reborn = rebirth(params, initial);
  assert.equal(reborn.state, "RUNNING");
  assert.equal(reborn.epilogue, null);
  assert.equal(reborn.channels[0].subscribers, 0);
  assert.equal(reborn.channels[1].status, "retired");
  assert.equal(reborn.calendar.endDate, initial.calendar.endDate);
  assert.equal(serializeSimulation(params, initial), frozen);
});
