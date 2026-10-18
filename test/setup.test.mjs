import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadParams } from "../src/params.js";
import { generateStartDate, generatePerson, generateHousehold } from "../src/person.js";
import { createSetup, importSeedCode, compatibilityWeight, LOCK_GROUPS } from "../src/setup.js";
import { encodeSeedCode, decodeSeedCode, SEED_VERSIONS, SEED_FIELDS } from "../src/seedcode.js";

const params = await loadParams(url => readFile(url, "utf8"));
const copy = value => JSON.parse(JSON.stringify(value));
const seedRecord = () => ({ versions: { ...SEED_VERSIONS }, worldSeed: 12, personSeed: 34, vSeed: 56,
  startYearWeightMode: "uniform", rerollCount: 3,
  fieldGenerations: Object.fromEntries(SEED_FIELDS.map(field => [field, 2])),
  lockedGroups: ["v_settings"], overrides: { species: { preset: "SP03", custom: null },
    statusV: { preset: "ST09", custom: null, formerTitle: "JB21" } },
  selections: { occupationV: { preset: "JB20", custom: null } }, freeTextOmitted: false });

test("AT01/AT101 partial: all start years and leap day are reachable with uniform day sampling", () => {
  const years = new Set(), dates = new Set();
  for (let seed = 0; seed < 15000; seed++) {
    const date = generateStartDate(params, seed);
    years.add(Number(date.slice(0, 4))); dates.add(date);
    assert.equal(new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10), date);
  }
  assert.deepEqual([...years].sort(), Array.from({ length: 11 }, (_, i) => 2016 + i));
  assert.ok([...dates].some(date => date.endsWith("02-29")));
  assert.equal(generateStartDate(params, 12), generateStartDate(params, 12));
  const invalid = copy(params);
  invalid.collections.initialWeights.items.find(row => row.対象 === "開始年").方法 = "比例";
  assert.throws(() => generateStartDate(invalid, 12));
});

test("AT02/AT91 pending data: unresolved distributions cannot masquerade as a playable person", () => {
  const session = createSetup(params, { seed: 123 });
  const snapshot = session.snapshot();
  assert.equal(snapshot.ready, false);
  assert.ok(snapshot.issues.some(row => row.field === "age"));
  assert.ok(snapshot.issues.some(row => row.field === "coreDisposition"));
  assert.ok(snapshot.issues.some(row => row.field === "name"));
  assert.equal(snapshot.personTemplate.age, null);
  assert.equal(snapshot.personTemplate.naturalSpeech, null);
  assert.throws(() => session.exportSeedCode(), /unfinished/);
  assert.throws(() => session.reroll(), /QS2/);
  assert.throws(() => session.setLock("v_settings", true), /QS2/);
  assert.equal(snapshot.runSetupTemplate.dream, null);
  assert.equal(snapshot.runSetupTemplate.autoMajorChoices, false);
});

test("AT93/AT94 partial: QS entries share templates, provenance records resolved and unresolved values", () => {
  const overrides = { species: { preset: "SP11", custom: null }, occupationV: { preset: "JB11", custom: null } };
  const snapshots = ["QS1", "QS2", "QS3"].map(entry => createSetup(params, { seed: "same", entry, overrides }).snapshot());
  for (const s of snapshots) {
    assert.deepEqual(s.personTemplate, snapshots[0].personTemplate);
    assert.deepEqual(s.runSetupTemplate, snapshots[0].runSetupTemplate);
    for (const [field, value] of Object.entries(s.runSetupTemplate.v)) {
      const p = s.setupProvenance.v[field];
      assert.deepEqual(p.value, value); assert.ok(p.method); assert.ok(p.evidenceClass);
    }
    assert.equal(s.setupProvenance.person.age.playerOverride, false);
    assert.equal(s.setupProvenance.person.startYear.evidenceClass, "仮置き");
    assert.equal(s.setupProvenance.v.occupationV.method, "player");
    assert.throws(() => { s.personTemplate.age = 20; });
  }
});

test("AT95/AT127/AT138 partial: 100 rerolls preserve fixed person, locked values and field seeds", () => {
  const session = createSetup(params, { seed: 35, entry: "QS3" });
  const original = session.setLock("v_settings", true);
  for (let i = 0; i < 100; i++) {
    const next = session.reroll();
    assert.strictEqual(next.personTemplate, original.personTemplate);
    for (const field of LOCK_GROUPS.v_settings) {
      assert.deepEqual(next.runSetupTemplate.v[field], original.runSetupTemplate.v[field]);
      assert.equal(next.fieldSeeds[field], original.fieldSeeds[field]);
    }
  }
  for (const field of ["age", "background", "household", "naturalSpeech", "coreDisposition", "personSeed"]) {
    assert.throws(() => session.reroll(field));
    assert.throws(() => session.override(field, { preset: "BG31", custom: null }));
    assert.throws(() => session.setLock(field, true));
  }
  assert.equal(session.undoCount, 10);
  assert.equal(JSON.stringify(session.snapshot()).includes("history"), false);
});

test("AT95/AT128 partial: item rerolls affect only that item; undo restores values and RNG keys", () => {
  const session = createSetup(params, { seed: 77, entry: "QS2" });
  const original = session.snapshot();
  const next = session.reroll("occupationV");
  for (const field of SEED_FIELDS.filter(field => field !== "occupationV")) {
    assert.deepEqual(next.runSetupTemplate.v[field], original.runSetupTemplate.v[field]);
    assert.equal(next.fieldSeeds[field], original.fieldSeeds[field]);
  }
  assert.deepEqual(session.undo(), original);
  assert.deepEqual(session.reroll("occupationV"), next);
  const points = [session.snapshot()];
  for (let i = 0; i < 15; i++) points.push(session.reroll("firstPerson"));
  for (let i = 0; i < 10; i++) assert.deepEqual(session.undo(), points[14 - i]);
  assert.deepEqual(session.undo(), points[5]);
  assert.equal(session.undoCount, 0);
});

test("AT131 partial: automatic SP/JB/ST pairs avoid forbidden combinations, player gaps remain", () => {
  for (let seed = 0; seed < 500; seed++) {
    const session = createSetup(params, { seed, entry: "QS3" });
    const v = session.snapshot().runSetupTemplate.v;
    assert.ok(compatibilityWeight(params, "occupationV", v.occupationV.preset, v) > 0);
    assert.ok(compatibilityWeight(params, "statusV", v.statusV.preset, v) > 0);
    if (v.statusV.preset === "ST09") assert.ok(v.statusV.formerTitle);
  }
  const session = createSetup(params, { seed: 1, entry: "QS3" });
  session.override("species", { preset: "SP11", custom: null });
  const gap = session.override("occupationV", { preset: "JB11", custom: null });
  assert.equal(gap.runSetupTemplate.v.occupationV.preset, "JB11");
  assert.equal(gap.issues.some(row => row.field === "occupationV"), false);
  assert.equal(session.snapshot().personTemplate.background, null);
  for (let i = 0; i < 30; i++) assert.notEqual(session.reroll("occupationV").runSetupTemplate.v.occupationV.preset, "JB11");
});

test("AT97/AT133 partial: missing former title is reported without silently changing it", () => {
  const session = createSetup(params, { seed: 12, entry: "QS3" });
  const s = session.override("statusV", { preset: "ST09", custom: null });
  assert.ok(s.issues.some(row => row.field === "statusV"));
  assert.equal(s.runSetupTemplate.v.statusV.formerTitle, null);
  const fixed = session.override("statusV", { preset: "ST09", custom: null, formerTitle: "JB21" });
  assert.equal(fixed.issues.some(row => row.field === "statusV"), false);
});

test("AT108 partial: custom text uses codepoint limits and removes controls and URLs", () => {
  const session = createSetup(params, { seed: 2, entry: "QS3" });
  const s = session.override("firstPerson", { custom: "わ\nたし\u202e https://example.invalid" });
  assert.equal(s.runSetupTemplate.v.firstPerson.custom, "わたし");
  session.override("firstPerson", { custom: "😀".repeat(8) });
  assert.throws(() => session.override("firstPerson", { custom: "😀".repeat(9) }));
  assert.throws(() => session.override("firstPerson", { custom: "x", preset: "CS01_00" }));
  const before = session.snapshot();
  assert.throws(() => session.override("occupationV", { preset: "BG01", custom: null }));
  assert.deepEqual(session.snapshot(), before);
});

test("AT98/AT99 codec: seed metadata, locks, generations and candidate selections round-trip", () => {
  const record = seedRecord(), code = encodeSeedCode(record), result = decodeSeedCode(code);
  assert.match(code, /^VTL5-[2-9A-HJKMNP-Z-]+$/);
  assert.equal(result.ok, true); assert.deepEqual(result.record, record);
  assert.equal(encodeSeedCode(result.record), code);
  for (const invalid of ["", "VTL5-", code.slice(0, -1), code + "-", code.replace("VTL5-", "VTL4-"),
    code.slice(0, -1) + (code.endsWith("2") ? "3" : "2"), code.replace(/-./u, "-0"), "VTL5-" + "2".repeat(17000)])
    assert.equal(decodeSeedCode(invalid).ok, false);
  for (let i = 5; i < Math.min(code.length, 150); i++) if (code[i] !== "-")
    assert.equal(decodeSeedCode(code.slice(0, i) + (code[i] === "2" ? "3" : "2") + code.slice(i + 1)).ok, false);
  const other = seedRecord(); other.versions.contentVersion = "future";
  assert.throws(() => encodeSeedCode(other), /別の版/);
  const extra = seedRecord(); extra.deviceId = "private";
  assert.throws(() => encodeSeedCode(extra));
  assert.equal(importSeedCode(params, "invalid").ok, false);
  const incomplete = importSeedCode(params, code);
  assert.equal(incomplete.ok, false);
  assert.equal(Object.hasOwn(incomplete, "session"), false);
  assert.equal(incomplete.error, "初期値データが未確定です");
});

test("AT98 codec: custom text never appears in decoded payload and carries an omission notice", () => {
  const record = seedRecord();
  record.overrides.firstPerson = { preset: null, custom: "秘密の自由入力" };
  record.selections.firstPerson = { preset: "CS01_00", custom: null };
  const result = decodeSeedCode(encodeSeedCode(record));
  assert.equal(result.ok, true);
  assert.equal(Object.hasOwn(result.record.overrides, "firstPerson"), false);
  assert.equal(Object.hasOwn(result.record.selections, "firstPerson"), false);
  assert.equal(JSON.stringify(result.record).includes("秘密"), false);
  assert.deepEqual(result.notices, ["自由入力の項目は共有されません"]);
});

test("AT139 household component: 100,000 fixed-age adults follow P-20 union probabilities", () => {
  const ages = [22, 27, 32, 37, 45], totals = ages.map(() => 0), unions = ages.map(() => 0);
  let bg31Unions = 0, otherChildren = 0;
  for (let seed = 0; seed < 100000; seed++) {
    const band = seed % ages.length, age = ages[band];
    const h = generateHousehold(params, { personSeed: seed, age, background: "BG18" }).household;
    totals[band]++;
    if (["married", "partnered"].includes(h.maritalStatus)) unions[band]++;
    if (h.children.length) otherChildren++;
    for (const child of h.children) {
      assert.ok(child.relativeAge >= 0 && child.relativeAge <= Math.min(age - 20, 17));
      assert.deepEqual(Object.keys(child), ["id", "relativeAge"]);
    }
    assert.equal(h.disclosure, "private");
    if (seed < 10000) {
      const bg31 = generateHousehold(params, { personSeed: seed, age, background: "BG31" }).household;
      if (["married", "partnered"].includes(bg31.maritalStatus)) bg31Unions++;
    }
  }
  for (let i = 0; i < ages.length; i++)
    assert.ok(Math.abs(unions[i] / totals[i] - params.collections.householdInitial.marriedBaseByAgeBand[i].value) < 0.02);
  assert.ok(bg31Unions / 10000 >= 0.9); assert.ok(otherChildren > 0);
});

test("AT136/AT146/AT147 household component: deterministic, immutable, no ability or identity data", () => {
  const input = { personSeed: 123, age: 30, background: "BG31" };
  const result = generateHousehold(params, input);
  assert.deepEqual(result, generateHousehold(params, input));
  assert.throws(() => { result.household.children.push({}); });
  assert.equal(result.provenance.playerOverride, false);
  assert.ok(result.household.childcareHoursPerWeek > 0);
  assert.equal(Object.hasOwn(result.household, "abilities"), false);
  for (const background of ["BG06", "BG07", "BG08", "BG09", "BG10", "BG11", "BG13", "BG22"])
    assert.throws(() => generateHousehold(params, { ...input, background }));
  for (const age of [17, 18.5, NaN]) assert.throws(() => generateHousehold(params, { ...input, age }));
  assert.deepEqual(generatePerson(params, 123), generatePerson(params, 123));
});
