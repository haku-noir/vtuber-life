import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { request } from "node:http";
import { loadParams, parseParams, validateParams, getCandidates, getObservationMonths, PARAMS_URL } from "../src/params.js";
import { createStaticServer } from "../scripts/serve.mjs";

const raw = await readFile(PARAMS_URL, "utf8");
const change = mutate => { const data = JSON.parse(raw); mutate(data); return data; };

test("AT15 foundation: bundled params load with evidence, unresolved weights and retired IDs preserved", async () => {
  const params = await loadParams(url => readFile(url, "utf8"));
  assert.equal(params.contentVersion, "0.5.0");
  assert.equal(getObservationMonths(params), 180);
  assert.equal(params.collections.events.length, 96);
  assert.equal(params.collections.events[0].weight.value, null);
  assert.equal(params.collections.events[0].weight.evidenceClass, "仮置き");
  assert.equal(getCandidates(params, "dreams").some(row => row.id === "D12"), false);
  assert.equal(getCandidates(params, "backgrounds").some(row => row.id === "BG06"), false);
  assert.ok(getCandidates(params, "events").some(row => row.id === "EV86"));
  assert.throws(() => { params.collections.events[0].weight.value = 0; });
  assert.deepEqual(params, JSON.parse(raw));
});

test("AT15/AT19 foundation: params reject wrong versions, duplicate IDs, malformed evidence and references", () => {
  for (const mutate of [
    p => { p.schemaVersion = "future"; }, p => { p.contentVersion = "future"; },
    p => { p.collections.events.push(p.collections.events[0]); },
    p => { p.collections.events[0].columns.ID = "EV99"; },
    p => { p.collections.events[0].evidenceClass = "invented"; },
    p => { p.evidenceClasses.invented = "unknown"; },
    p => { p.collections.personaStyles = {}; },
    p => { delete p.collections.events[0].id; },
    p => { delete p.collections.events[0].weight; },
    p => { delete p.collections.compatibility.levels; },
    p => { p.collections.events[0].weight.value = -1; },
    p => { p.collections.events[0].weight.value = NaN; },
    p => { p.collections.events[0].weight.value = "1"; },
    p => { p.collections.events[0].weight.evidenceClass = "統計"; },
    p => { p.collections.events[0].workId = "missing"; },
    p => { p.collections.compatibility.statusXOccupation[0]["組合せ"] = "JB29～JB32"; },
    p => { p.collections.backgroundLifeEffects[0].ID = "BG99"; },
    p => { delete p.collections.events; },
  ]) assert.throws(() => validateParams(change(mutate)));
  assert.throws(() => parseParams("{"));
});

test("AT19 foundation: params I/O errors propagate without substituting made-up values", async () => {
  await assert.rejects(loadParams(async () => { throw new Error("unavailable"); }), /unavailable/);
  await assert.rejects(loadParams(async () => "not JSON"));
});

test("offline server serves local modules and JSON while denying traversal and private paths", async t => {
  const server = createStaticServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const call = (url, method = "GET") => new Promise((resolve, reject) => {
    const req = request({ hostname: "127.0.0.1", port: server.address().port, path: url, method }, res => {
      let body = "";
      res.setEncoding("utf8"); res.on("data", data => { body += data; });
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on("error", reject); req.end();
  });
  assert.equal((await call("/")).status, 200);
  const module = await call("/src/rng.js");
  assert.equal(module.status, 200);
  assert.match(module.headers["content-type"], /javascript/);
  const params = await call("/docs/spec/params.json");
  assert.deepEqual(parseParams(params.body), parseParams(raw));
  assert.equal((await call("/src/rng.js", "HEAD")).body, "");
  for (const url of ["/../package.json", "/%2e%2e/package.json", "/src/%2e%2e/package.json", "/.git/config", "/src/%5c..%5cpackage.json"])
    assert.equal((await call(url)).status, 403);
  assert.equal((await call("/docs/spec/research-data.md")).status, 404);
  assert.equal((await call("/%zz")).status, 400);
  assert.equal((await call("/", "POST")).status, 405);
  assert.equal((await call("/absent.js")).status, 404);
});
