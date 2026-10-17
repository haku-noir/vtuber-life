import test from "node:test";
import assert from "node:assert/strict";
import { createRng, restoreRng, hashKey, RNG_STREAMS } from "../src/rng.js";

test("AT14 foundation: identical keyed streams and restored cursors reproduce draws", () => {
  for (const stream of RNG_STREAMS) {
    const a = createRng("seed-日本語", stream, "EV01", 17, "person-1");
    const b = createRng("seed-日本語", stream, "EV01", 17, "person-1");
    for (let i = 0; i < 100; i++) assert.equal(a.uint32(), b.uint32());
    const restored = restoreRng(JSON.parse(JSON.stringify(a.snapshot())));
    for (let i = 0; i < 100; i++) assert.equal(a.uint32(), restored.uint32());
  }
});

test("AT14/AT05 foundation: display draws and V rerolls do not consume person or activity streams", () => {
  const person = createRng(42, "person"), activity = createRng(42, "activity");
  const display = createRng(42, "display"), setup = createRng(42, "setupV");
  const beforePerson = person.snapshot(), beforeActivity = activity.snapshot();
  for (let i = 0; i < 1000; i++) { display.next(); setup.fork(i, "CS01").next(); }
  assert.deepEqual(person.snapshot(), beforePerson);
  assert.deepEqual(activity.snapshot(), beforeActivity);
  const child = activity.fork("EV01", 2);
  activity.next(); activity.next();
  assert.equal(child.uint32(), activity.fork("EV01", 2).uint32());
  assert.notEqual(hashKey(42, "person"), hashKey(42, "activity"));
  assert.notEqual(hashKey("42", "person"), hashKey(42, "person"));
  assert.notEqual(hashKey(42, "a", "bc"), hashKey(42, "ab", "c"));
});

test("AT15 foundation: RNG validates seeds, ranges, weights and snapshots before consuming draws", () => {
  const rng = createRng(0, "activity"), before = rng.snapshot();
  for (const weights of [[null, 1], [-1, 1], [NaN, 1], [Infinity, 1], [0, 0], [1], [1e308, 1e308]])
    assert.throws(() => rng.weighted(["a", "b"], weights));
  for (const range of [[2, 1], [0.1, 2], [0, 2 ** 32], [NaN, 3]]) assert.throws(() => rng.int(...range));
  assert.deepEqual(rng.snapshot(), before);
  assert.throws(() => createRng(undefined, "person"));
  assert.throws(() => createRng({}, "person"));
  assert.throws(() => restoreRng({ ...before, state: -1 }));
  assert.throws(() => restoreRng({ ...before, version: "future" }));
  for (let i = 0; i < 1000; i++) {
    assert.equal(rng.weighted(["zero", "one", "zero"], [0, 1, 0]), "one");
    assert.ok([-2, -1, 0, 1, 2].includes(rng.int(-2, 2)));
    const value = rng.next(); assert.ok(value >= 0 && value < 1);
  }
});

test("AT14 foundation: mulberry32 reference vector is stable", () => {
  const rng = restoreRng({ ...createRng(1, "activity").snapshot(), state: 1 });
  assert.deepEqual(Array.from({ length: 4 }, () => rng.uint32()), [2693262067, 11749833, 2265367787, 4213581821]);
});
