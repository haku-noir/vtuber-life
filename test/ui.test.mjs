import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { once } from "node:events";
import { loadParams, validateParams, ABILITY_AXES } from "../src/params.js";
import { createSetup } from "../src/setup.js";
import { createSimulation, advanceToBoundary, runToEnd, answerDecision, requestEvent, serializeSimulation, validateSimulation } from "../src/sim.js";
import { createStaticServer } from "../scripts/serve.mjs";
import { observationSettings, observedWeeks, weeklyGraph, renderWeeklyGraph, radarModel, renderRadar, weekDescription } from "../web/graph.js";
import { createObservationController } from "../web/app.js";

const params = await loadParams(url => readFile(url, "utf8"));
const fresh = (p = params) => createSimulation(p, createSetup(p, { seed: "m11-observation" }).snapshot());
// Timer assertions must not depend on the event lottery, including family events.
const clockParams = structuredClone(params);
for (const event of clockParams.collections.events) event.weight.value = 0;
validateParams(clockParams);
const answerFirst = run => answerDecision(params, run, run.pendingDecision.id, run.pendingDecision.options[0].id);
function fakeClock() {
  let id = 0;
  const jobs = new Map(), delays = [];
  return {
    schedule(callback, delay) { delays.push(delay); jobs.set(++id, callback); return id; },
    cancel(key) { jobs.delete(key); },
    get size() { return jobs.size; },
    get lastDelay() { return delays.at(-1); },
    get callback() { return jobs.values().next().value; },
    tick() { const [key, callback] = jobs.entries().next().value ?? []; assert.ok(callback, "clock must be armed"); jobs.delete(key); callback(); },
  };
}
function observed(initialRun = fresh(), p = params) {
  const clock = fakeClock();
  const controller = createObservationController(p, { initialRun, schedule: clock.schedule, cancel: clock.cancel,
    onError: error => { throw error; } });
  controller.start();
  return { clock, controller };
}

test("P-17 observation settings are read from data and reject unrecognized prose", () => {
  assert.deepEqual(observationSettings(params), { monthMs: 20000, speeds: [0.5, 1, 2, 4], defaultWeeks: 52, windows: [13, 26, 52, 104, "all"] });
  const altered = structuredClone(params);
  altered.collections.provisionalValues.find(row => row.columns.項目 === "自動送り").columns["暫定値・扱い"] = "平均約3秒／月相当、0.5・1・2・4倍";
  assert.equal(observationSettings(altered).monthMs, 3000);
  altered.collections.provisionalValues.find(row => row.columns.項目 === "グラフ表示幅").columns["暫定値・扱い"] = "未設定";
  assert.throws(() => observationSettings(altered), /P-17/);
});

test("AT02/AT05: one-tap QS1 clock reaches the same RESULT despite speed, pause, graph and radar operations", () => {
  const params = clockParams;
  const initial = fresh(params), expected = runToEnd(params, initial);
  const clock = fakeClock();
  const controller = createObservationController(params, { seed: "m11-observation", schedule: clock.schedule, cancel: clock.cancel,
    onError: error => { throw error; } });
  controller.start();
  let steps = 0, elapsedAt1x = 0;
  while (controller.snapshot().run.state !== "RESULT") {
    const { run } = controller.snapshot();
    if (steps % 37 === 0) {
      const before = serializeSimulation(params, run);
      controller.setSpeed(controller.settings.speeds[steps % 4]);
      controller.setWindow(controller.settings.windows[steps % 5]);
      controller.toggleSeries("C"); controller.toggleSeries("G");
      controller.setDetail("abilities", true);
      assert.equal(clock.size, 0);
      const paused = controller.snapshot();
      renderWeeklyGraph(weeklyGraph(paused.run, paused.view), paused.view.visible);
      renderRadar(radarModel(paused.run));
      const weeks = observedWeeks(paused.run);
      if (weeks.length) controller.inspectWeek(weeks[0].weekIndex);
      controller.resume();
      assert.equal(serializeSimulation(params, controller.snapshot().run), before);
    }
    assert.equal(clock.size, 1, "only one boundary is scheduled");
    elapsedAt1x += clock.lastDelay * controller.snapshot().view.speed;
    clock.tick();
    assert.ok(++steps < 1200);
  }
  assert.equal(clock.size, 0);
  assert.deepEqual(controller.snapshot().run, expected);
  assert.equal(initial.calendar.observationMonths, 180);
  assert.equal(initial.calendar.observationMonths * controller.settings.monthMs, 60 * 60 * 1000);
  // Partial first/last months can have different day counts; allow less than one month.
  assert.ok(Math.abs(elapsedAt1x - 60 * 60 * 1000) < controller.settings.monthMs);
  assert.equal(serializeSimulation(params, initial), serializeSimulation(params, fresh(params)));
  controller.dispose();
});

test("AT02/AT05/AT24: observation reaches the batch RESULT after answering major choices", () => {
  // Guarantee the answer path is exercised even before natural heavy-event rates are set.
  const initial = requestEvent(params, fresh(), "EV86");
  let expected = initial, batches = 0;
  while (expected.state !== "RESULT") {
    assert.ok(++batches < 1200, "batch must finish after answering choices");
    expected = expected.pendingDecision ? answerFirst(expected) : runToEnd(params, expected);
  }
  const clock = fakeClock();
  const attach = initialRun => createObservationController(params, { initialRun,
    schedule: clock.schedule, cancel: clock.cancel, onError: error => { throw error; } });
  let controller = attach(initial), steps = 0;
  controller.start();
  try {
    while (controller.snapshot().run.state !== "RESULT") {
      assert.ok(++steps < 2400, "observation must finish after answering choices");
      const { run } = controller.snapshot();
      if (run.pendingDecision) {
        assert.equal(clock.size, 0, "unanswered choices stop the clock");
        controller.resume();
        assert.equal(clock.size, 0);
        controller.dispose();
        controller = attach(answerFirst(run));
        controller.start();
        continue;
      }
      assert.equal(clock.size, 1, "one boundary is scheduled after choices are answered");
      clock.tick();
    }
    assert.equal(clock.size, 0);
    assert.ok(controller.snapshot().run.choiceHistory.length > 0);
    assert.deepEqual(controller.snapshot().run, expected);
  } finally {
    controller.dispose();
  }
});

test("AT05/AT24: pauses cancel stale callbacks, hiding never catches up, and details require resume", () => {
  const params = clockParams;
  const { controller, clock } = observed(fresh(params), params);
  const firstDelay = clock.lastDelay, initial = controller.snapshot().run;
  const stale = clock.callback;
  controller.setSpeed(4);
  assert.equal(clock.lastDelay, firstDelay / 4);
  stale();
  assert.equal(controller.snapshot().run, initial);
  clock.tick();
  assert.deepEqual(controller.snapshot().run, advanceToBoundary(params, initial));
  controller.setDetail("log", true);
  const paused = serializeSimulation(params, controller.snapshot().run);
  controller.setDetail("log", false);
  controller.setHidden(true); controller.setHidden(false);
  assert.equal(clock.size, 0);
  assert.equal(serializeSimulation(params, controller.snapshot().run), paused);
  controller.setHidden(true); controller.resume();
  assert.equal(clock.size, 0);
  controller.setHidden(false); controller.resume();
  assert.equal(clock.size, 1);
  controller.dispose();
  assert.equal(clock.size, 0);
});

test("AT24: the clock cannot advance or resume an unanswered choice", () => {
  const initial = fresh();
  initial.state = "CHOICE"; initial.stage = "choice";
  initial.pendingDecision = { id: "ui-choice", date: initial.calendar.currentDate, resumeStage: "effects",
    options: [{ id: "continue", label: "続ける" }, { id: "rest", label: "休む" }] };
  validateSimulation(params, initial);
  const before = serializeSimulation(params, initial), { controller, clock } = observed(initial);
  controller.setSpeed(4); controller.resume();
  assert.equal(clock.size, 0);
  assert.equal(serializeSimulation(params, controller.snapshot().run), before);
  controller.dispose();
});

const week = (index, values = {}) => ({ weekIndex: index, startDate: "2020-01-01", endDate: "2020-01-08",
  channelId: "channel-1", S: 0, C: null, G: 0, U: 0, partial: false, videoViewsThisWeek: 0, ...values });
const graphRun = weeks => ({ calendar: { currentDate: "2020-06-01" }, weeklySnapshots: weeks, weekProgress: null });
const graphView = { windowWeeks: 52, followLatest: true };

test("AT07/AT21/AT22: S and C lines, zero-origin G bars and tooltip U preserve their units and null gaps", () => {
  const run = graphRun([week(0, { S: 100, C: 0 }), week(1, { S: 800, G: 1000, U: 300 }), week(2, { S: 800, C: 2 })]);
  const before = structuredClone(run), model = weeklyGraph(run, graphView), svg = renderWeeklyGraph(model);
  assert.equal(model.series.S.segments[0][1].value - model.series.S.segments[0][0].value, 700);
  assert.equal(model.series.G.bars[1].value, 1000);
  assert.equal(model.series.G.bars[1].y + model.series.G.bars[1].height, model.plot.bottom);
  assert.equal(model.series.C.segments.length, 2);
  assert.equal(model.series.C.segments[0][0].value, 0);
  assert.equal(model.series.C.segments[0][0].y, model.plot.bottom);
  assert.equal((svg.match(/<svg /g) ?? []).length, 1);
  for (const series of ["S", "C", "G"]) assert.ok(svg.includes(`data-series="${series}"`));
  assert.match(svg, /stroke-dasharray="6 5"/);
  assert.match(svg, /解除 U 300人\/週/);
  assert.match(weekDescription(run.weeklySnapshots[1]), /配信なし/);
  assert.doesNotMatch(weekDescription(run.weeklySnapshots[0]), /配信なし/);
  assert.deepEqual(run, before);
});

test("AT08/AT24: latest 52 weeks, history, channel breaks and partial weeks never invent future values", () => {
  const weeks = Array.from({ length: 60 }, (_, i) => week(i, { S: i * 10 }));
  weeks[40].channelId = "channel-2";
  const run = graphRun(weeks);
  run.weeklySnapshots.push(week(99, { endDate: "2021-01-01", S: 100000 }));
  run.weekProgress = week(60, { startDate: "2020-05-30", endDate: "2020-06-01", partial: true, S: 600 });
  const model = weeklyGraph(run, graphView);
  assert.equal(model.weeks.length, 52);
  assert.equal(model.weeks[0].weekIndex, 9);
  assert.equal(model.weeks.at(-1).weekIndex, 60);
  assert.equal(model.series.S.segments.length, 3);
  assert.ok(model.scales.S < 100000);
  assert.match(weekDescription(model.weeks.at(-1)), /途中／端数週/);
  const history = weeklyGraph(run, { windowWeeks: 13, followLatest: false, endWeekIndex: 30 });
  assert.equal(history.weeks[0].weekIndex, 18);
  assert.equal(history.weeks.at(-1).weekIndex, 30);
  run.weekProgress = null;
  assert.equal(weeklyGraph(run, graphView).weeks.at(-1).weekIndex, 59);
  assert.equal(weeklyGraph(graphRun([]), graphView).weeks.length, 0);
});

test("AT32: radar axes and fixed scale are shared, and rendering cannot change abilities", () => {
  const run = fresh(), before = structuredClone(run), axes = radarModel(run);
  assert.deepEqual(axes.map(axis => axis.key), ABILITY_AXES);
  assert.equal(axes.length, 8);
  const svg = renderRadar(axes);
  assert.match(svg, /0から100/);
  assert.match(svg, /radar-current/); assert.match(svg, /radar-debut/);
  assert.equal((svg.match(/class="grid"/g) ?? []).length, 5);
  assert.doesNotMatch(svg, /input|button|slider/);
  assert.deepEqual(run, before);
});

test("observation page, modules and parameters are served locally from both entry URLs", async t => {
  const server = createStaticServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const path of ["/", "/web/", "/web/app.js", "/web/graph.js", "/web/style.css", "/src/sim.js", "/docs/spec/params.json"]) {
    const response = await fetch(base + path);
    assert.equal(response.status, 200, path);
    const body = await response.text();
    if (["/", "/web/"].includes(path)) {
      assert.match(body, /src="\/web\/app.js"/);
      assert.match(body, /生まれる（おまかせで始める）/);
      assert.doesNotMatch(body, /(?:src|href)="https?:/);
    }
  }
});
