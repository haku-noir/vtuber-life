import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseStatsDataset, loadStatsDataset, computeLifePosition, thresholdShare, intervalShare,
  evidenceClass, oneInN, shareDisplay } from "../src/lifeposition.js";
import { renderLifePosition, mountLifePosition, DISCLAIMER, canOpenLifePosition } from "../web/lifeposition.js";
import { createObservationController } from "../web/app.js";
import { loadParams } from "../src/params.js";
import { createSetup } from "../src/setup.js";
import { createSimulation, advanceToBoundary, serializeSimulation } from "../src/sim.js";

const text = await readFile(new URL("../docs/spec/stats-sample.json", import.meta.url), "utf8");
const raw = JSON.parse(text);
const params = await loadParams(url => readFile(url, "utf8"));
const value = { startYear: 2019, subscribers: 12300, versions: { statsVersion: "old" } };
const parse = data => parseStatsDataset(JSON.stringify(data));
const checked = () => { const data = structuredClone(raw); data.sources.forEach(source => source.citationTermsChecked = true); return data; };
const bins = [
  { lower: 0, upper: 1000, share: .6 }, { lower: 1000, upper: 10000, share: .25 },
  { lower: 10000, upper: 100000, share: .12 }, { lower: 100000, upper: null, share: .03 },
].map(bin => ({ ...bin, evidenceClass: "placeholder" }));

test("AT118: sourced lower-bound example is recomputed with estimate badge and direction", () => {
  const data = checked();
  data.series.find(item => item.seriesId === "LP05").result = { topShareUpperBound: 0.99 };
  const view = computeLifePosition(parse(data), value);
  const example = view.context.find(item => item.seriesId === "LP05");
  assert.equal(example.topShare, 35 / 6000);
  assert.equal(example.display, "≈上位0.6%未満・約170人に1人より少ない");
  assert.equal(example.evidenceClass, "estimate");
  const html = renderLifePosition(view);
  assert.match(html, /evidence-estimate.*推定/);
  assert.match(html, /≈上位0.6%未満・約170人に1人より少ない/);
});

test("AT119/AT120: fictional intervals, common range, unbounded intervals and zero shares", () => {
  assert.equal(intervalShare(12300, bins).display, "上位約14%・約7人に1人");
  assert.equal(intervalShare(5000, bins).display, "上位約23%・約4人に1人");
  assert.equal(intervalShare(800, bins).display, "最も多い範囲");
  assert.equal(intervalShare(100000, bins).topShare, null);
  assert.equal(shareDisplay(.51), "最も多い範囲");
  assert.equal(shareDisplay(.5), "上位約50%・約2人に1人");
  assert.equal(oneInN(0), null);
  assert.equal(oneInN(1), 1);
  assert.equal(oneInN(35 / 6000), 170);
  assert.doesNotMatch(shareDisplay(0), /Infinity|上位/);
  assert.throws(() => thresholdShare({ count: 5, denominator: 0 }));
  assert.throws(() => intervalShare(500, [{ ...bins[0], share: 1.5 }]));
  assert.ok(!JSON.stringify(raw).includes('"lower":1000'));
});

test("AT121: unchecked sources expose only title/URL; forbidden indicators and sources are excluded", () => {
  const data = structuredClone(raw);
  data.sources.push({ sourceId: "M01", title: "excluded", url: "https://example.invalid", sourceType: "public_report", citationTermsChecked: true });
  data.series.push({ seriesId: "LP02", points: [{ value: 987654321 }], sourceIds: ["M01"] });
  const dataset = parse(data);
  assert.deepEqual(dataset.references.map(source => Object.keys(source)), raw.sources.map(() => ["title", "url"]));
  assert.equal(dataset.sources.length, 0);
  assert.deepEqual(dataset.series.map(item => item.seriesId), ["LP11"]);
  const view = computeLifePosition(dataset, value);
  assert.equal(view.main.display, "未取得");
  for (const html of [renderLifePosition(view), renderLifePosition(view, true)]) {
    assert.doesNotMatch(html, /LP01|LP02|LP04|LP06|LP07|LP09|987654321|11,300|6000|4.9千|270万/);
  }
  assert.match(renderLifePosition(view, true), /arxiv.org/);
  assert.throws(() => parse({ ...raw, schema: "unknown" }));
});

test("AT121/AT122: point-level citation gates and evidence inheritance fail closed", () => {
  const data = checked();
  data.sources.find(source => source.sourceId === "M18").citationTermsChecked = false;
  const view = computeLifePosition(parse(data), value);
  assert.ok(!view.context.some(item => item.name === "jp_market_size"));
  assert.ok(view.context.some(item => item.name === "hours_watched"));
  data.series.find(item => item.seriesId === "LP03").sourceIds.push("missing");
  assert.ok(!computeLifePosition(parse(data), value).context.some(item => item.seriesId === "LP03"));
  const stat = { evidenceClass: "statistic", sourceId: "M16", period: "2026", definition: "channels" };
  assert.equal(evidenceClass([stat, stat]), "statistic");
  for (const key of ["sourceId", "period", "definition"])
    assert.equal(evidenceClass([stat, { ...stat, [key]: "different" }]), "estimate");
  assert.equal(evidenceClass([stat, { evidenceClass: "placeholder" }]), "placeholder");
  assert.equal(evidenceClass([stat, { ...stat, evidenceClass: "estimate" }]), "estimate");
  const mixed = checked();
  mixed.series.find(item => item.seriesId === "LP03").sourceIds.push("M18");
  assert.equal(computeLifePosition(parse(mixed), value).context.find(item => item.seriesId === "LP03").evidenceClass, "estimate");
});

test("LP11: exactly 1000 versioned same-year runs, ties included, immutable inputs and no invented quantiles", () => {
  const data = structuredClone(raw), series = data.series.find(item => item.seriesId === "LP11");
  const generation = { contentVersion: "test-content", simulationVersion: "test-sim", seed: "build-seeds-0-999", method: "fixed observation endpoint" };
  series.points = [{ year: 2019, subscriberSamples: Array.from({ length: 1000 }, (_, i) => i), generation }];
  const dataset = parse(data), input = { ...value, subscribers: 900, versions: generation };
  const before = JSON.stringify(dataset);
  const result = computeLifePosition(dataset, input);
  assert.equal(result.main.topShare, .1);
  assert.equal(result.main.runs, 1000);
  assert.equal(result.main.display, "上位約10%・約10人に1人");
  assert.equal(computeLifePosition(dataset, { ...input, startYear: 2020 }).main.display, "未取得");
  assert.equal(computeLifePosition(dataset, value).main.display, "未取得");
  assert.equal(JSON.stringify(dataset), before);
  assert.deepEqual(computeLifePosition(dataset, input), result);
  assert.ok(Object.isFrozen(dataset.series));
  series.points[0].subscriberSamples.pop();
  assert.throws(() => parse(data));
});

test("AT123/AT124: permanent disclaimer, accessible badges, version notice and local-only loader", async () => {
  const view = computeLifePosition(parse(checked()), value);
  for (const methods of [false, true]) {
    const html = renderLifePosition(view, methods);
    assert.ok(html.startsWith('<p class="lp-disclaimer">' + DISCLAIMER + '</p>'));
    assert.doesNotMatch(html, /下位|負け|失敗|dismiss|close-disclaimer/);
  }
  const methods = renderLifePosition(view, true);
  for (const word of ["信頼度", "計算式", "取得日", "シード", "statsVersion", "保存時の版 oldとは異なります"])
    assert.ok(methods.includes(word));
  const css = await readFile(new URL("../web/style.css", import.meta.url), "utf8");
  assert.match(css, /evidence-statistic[^}]*solid/);
  assert.match(css, /evidence-estimate[^}]*dashed/);
  assert.match(css, /evidence-placeholder[^}]*repeating-linear-gradient/);
  const html = await readFile(new URL("../web/index.html", import.meta.url), "utf8");
  assert.ok(html.indexOf('id="lp-open"') > html.indexOf('id="logs-heading"'));
  assert.ok(html.indexOf('id="lp-open"') > html.indexOf('id="result"'));
  let called = 0;
  const loaded = await loadStatsDataset(async url => { called++; assert.ok(url.pathname.endsWith("/docs/spec/stats-sample.json")); return text; });
  assert.equal(loaded.status, "ready");
  assert.equal(called, 1);
  assert.equal((await loadStatsDataset(async () => { throw new Error("missing"); })).status, "unavailable");
  assert.equal((await loadStatsDataset(async () => "{}")).status, "unavailable");
});

test("AT125: opening/closing and failed stats reads leave simulation, RNG, dreams and save unchanged", async () => {
  const initial = createSimulation(params, createSetup(params, { seed: "m14-purity" }).snapshot());
  const controller = createObservationController(params, { initialRun: initial, schedule: () => 1, cancel: () => {} });
  assert.equal(controller.setLifePositionOpen(true), false);
  controller.pause();
  const before = serializeSimulation(params, controller.snapshot().run);
  assert.equal(controller.setLifePositionOpen(true), true);
  const failed = await loadStatsDataset(async () => { throw new Error("offline"); });
  for (const dataset of [failed.dataset, parse(raw)]) {
    const view = computeLifePosition(dataset, value);
    renderLifePosition(view); renderLifePosition(view, true);
  }
  controller.resume();
  assert.equal(controller.snapshot().run.state, "PAUSED");
  controller.setLifePositionOpen(false);
  assert.equal(serializeSimulation(params, controller.snapshot().run), before);
  controller.resume();
  assert.deepEqual(controller.snapshot().run, initial);
  let observed = controller.snapshot().run, baseline = initial;
  for (let i = 0; i < 8; i++) {
    observed = advanceToBoundary(params, observed);
    baseline = advanceToBoundary(params, baseline);
  }
  assert.deepEqual(observed, baseline);
  controller.dispose();
  for (const state of ["RUNNING", "CHOICE", "EPILOGUE", "TITLE"]) assert.equal(canOpenLifePosition(state), false);
  for (const state of ["PAUSED", "RESULT"]) assert.equal(canOpenLifePosition(state), true);
});

function fakeDocument() {
  const elements = new Map();
  for (const id of ["lp-heading", "lp-methods", "lp-content", "lp-close", "lp-open", "lp-enabled", "life-position", "observation"])
    elements.set(id, { hidden: id === "life-position", checked: true, handlers: {},
      addEventListener(name, handler) { this.handlers[name] = handler; }, focus() {} });
  return { getElementById: id => elements.get(id), defaultView: { confirm: () => false } };
}
test("AT123/AT125: UI reads lazily, hides behind preference, confirms links, and cannot reopen after delayed load", async () => {
  const document = fakeDocument(), $ = document.getElementById;
  const initialRun = createSimulation(params, createSetup(params, { seed: "m14-screen" }).snapshot());
  const controller = createObservationController(params, { initialRun, schedule: () => 1, cancel: () => {} });
  let resolve, loads = 0;
  mountLifePosition(document, { getController: () => controller, load: () => { loads++; return new Promise(done => resolve = done); } });
  await $("lp-open").handlers.click();
  assert.equal(loads, 0);
  controller.pause();
  $("lp-enabled").checked = false;
  $("lp-enabled").handlers.change();
  await $("lp-open").handlers.click();
  assert.equal(loads, 0);
  $("lp-enabled").checked = true; $("lp-enabled").handlers.change();
  const opening = $("lp-open").handlers.click();
  await Promise.resolve();
  assert.equal(loads, 1);
  assert.equal($("life-position").hidden, false);
  assert.equal($("observation").hidden, true);
  controller.resume(); assert.equal(controller.snapshot().run.state, "PAUSED");
  $("lp-close").handlers.click();
  resolve({ dataset: parse(raw) }); await opening;
  assert.equal($("life-position").hidden, true);
  assert.equal($("observation").hidden, false);
  await $("lp-open").handlers.click();
  assert.equal(loads, 1);
  $("lp-methods").handlers.click();
  assert.match($("lp-content").innerHTML, /statsVersion/);
  let prevented = false;
  $("lp-content").handlers.click({ target: { closest: () => ({}) }, preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  $("lp-close").handlers.click();
  controller.dispose();
});

