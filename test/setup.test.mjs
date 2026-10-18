import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadParams } from "../src/params.js";
import { ageWeights, generateStartDate, generatePerson, generateHousehold } from "../src/person.js";
import { createSetup, importSeedCode, compatibilityWeight, LOCK_GROUPS } from "../src/setup.js";
import { createSimulation, advanceToBoundary, runToEnd } from "../src/sim.js";
import { createRng } from "../src/rng.js";
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

test("AT01/AT02/AT91 setup: QS1 is ready and accepted by simulation in every start year", () => {
  const years = new Set();
  for (let seed = 0; seed < 500; seed++) {
    const session = createSetup(params, { seed }), snapshot = session.snapshot();
    assert.equal(snapshot.ready, true);
    assert.deepEqual(snapshot.issues, []);
    assert.ok(snapshot.personTemplate.naturalSpeech.firstPerson);
    assert.equal(Object.keys(snapshot.personTemplate.abilities).length, 8);
    assert.equal(snapshot.personTemplate.life.careHoursPerWeek, snapshot.personTemplate.household.childcareHoursPerWeek);
    assert.equal(snapshot.runSetupTemplate.dream, null);
    assert.equal(snapshot.runSetupTemplate.autoMajorChoices, false);
    assert.throws(() => session.reroll(), /QS2/);
    assert.throws(() => session.setLock("v_settings", true), /QS2/);
    if (years.has(snapshot.personTemplate.startYear)) continue;
    years.add(snapshot.personTemplate.startYear);
    const run = createSimulation(params, snapshot);
    assert.equal(run.state, "RUNNING");
    assert.ok(advanceToBoundary(params, run).calendar.currentDate > run.calendar.currentDate);
  }
  assert.deepEqual([...years].sort(), Array.from({ length: 11 }, (_, i) => 2016 + i));
});

test("AT02/AT03 setup integration: identical QS1 seeds run to the observation limit without input", () => {
  const run = () => runToEnd(params, createSimulation(params, { seed: "m10-end",
    ...createSetup(params, { seed: "m10-end" }).snapshot() }));
  const a = run(), b = run();
  assert.deepEqual(a, b);
  assert.equal(a.state, "RESULT");
  assert.equal(a.lifeSnapshot.reason, "observation-limit");
});

test("AT93/AT94 partial: QS entries share templates and resolved provenance", () => {
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
  assert.match(session.snapshot().personTemplate.background, /^BG\d{2}$/);
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

test("AT131 partial: species rerolls weight retained natural titles and exclude forbidden pairs", () => {
  const preset = id => ({ preset: id, custom: null });
  const levels = params.collections.compatibility.levels;
  assert.equal(compatibilityWeight(params, "species", "SP03", {}), 1);
  assert.equal(compatibilityWeight(params, "species", "SP03", { occupationV: preset("JB21") }), levels.自然);
  assert.equal(compatibilityWeight(params, "species", "SP03", { occupationV: preset("JB21"), statusV: preset("ST01") }), levels.自然 ** 2);
  assert.equal(compatibilityWeight(params, "species", "SP03", { statusV: preset("ST13") }), levels["ギャップとして許容"]);
  assert.equal(compatibilityWeight(params, "species", "SP11", { occupationV: preset("JB11") }), levels["おまかせでは選ばない"]);
  assert.equal(compatibilityWeight(params, "species", "SP03", { occupationV: { preset: null, custom: "自由入力" } }), 1);
  const session = createSetup(params, { seed: "species-reroll", entry: "QS3" });
  session.override("occupationV", preset("JB11"));
  const before = session.snapshot();
  for (let i = 0; i < 100; i++) {
    const next = session.reroll("species");
    assert.notEqual(next.runSetupTemplate.v.species.preset, "SP11");
    assert.deepEqual(next.runSetupTemplate.v.occupationV, before.runSetupTemplate.v.occupationV);
    assert.deepEqual(next.runSetupTemplate.v.statusV, before.runSetupTemplate.v.statusV);
    assert.strictEqual(next.personTemplate, before.personTemplate);
  }
});

test("AT95 partial: locks guard rerolls; explicit overrides stay editable and undoable", () => {
  const session = createSetup(params, { seed: "locked-edit", entry: "QS3" });
  const before = session.setLock("v_settings", true);
  const changed = session.override("species", { preset: "SP03", custom: null });
  assert.equal(changed.runSetupTemplate.v.species.preset, "SP03");
  assert.deepEqual(changed.lockedGroups, before.lockedGroups);
  assert.deepEqual(changed.fieldSeeds, before.fieldSeeds);
  assert.strictEqual(changed.personTemplate, before.personTemplate);
  assert.equal(changed.setupProvenance.v.species.playerOverride, true);
  assert.deepEqual(session.reroll("species"), changed);
  assert.deepEqual(session.undo(), before);
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
  const restored = importSeedCode(params, code);
  assert.equal(restored.ok, true);
  assert.equal(restored.session.snapshot().ready, true);
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

test("AT98/AT99 codec: binary size, wire fixture, uint32 seeds and safe-integer generations", () => {
  const minimal = { ...seedRecord(), worldSeed: 0, personSeed: 0, vSeed: 0, rerollCount: 0,
    fieldGenerations: Object.fromEntries(SEED_FIELDS.map(field => [field, 0])), lockedGroups: [], overrides: {}, selections: {} };
  assert.equal(encodeSeedCode(minimal), "VTL5-A4B9-8YJP-JHVS-Q56V-ZY39-B7P-A");
  assert.equal(encodeSeedCode(minimal).length, 35);
  assert.ok(encodeSeedCode(seedRecord()).length < 110);
  for (const seed of [0, 1, 0x7fffffff, 0x80000000, 0xffffffff]) {
    for (const count of [0, 127, 128, 16384, 0xffffffff, Number.MAX_SAFE_INTEGER]) {
      const record = { ...minimal, worldSeed: seed, personSeed: 0xffffffff - seed, vSeed: seed,
        rerollCount: count, fieldGenerations: Object.fromEntries(SEED_FIELDS.map((field, i) => [field, i % 2 ? count : 0])),
        lockedGroups: ["v_appearance", "v_settings", "activity_policy"],
        overrides: { personaStyle: { primary: "PT01", secondary: "PT24" }, statusV: { preset: "ST09", custom: null, formerTitle: "ST01" } },
        selections: { firstPerson: { preset: "CS01_00", custom: null }, statusV: { preset: "ST01", custom: null, formerTitle: null } } };
      const result = decodeSeedCode(encodeSeedCode(record));
      assert.equal(result.ok, true);
      assert.deepEqual(result.record, record);
    }
  }
});

test("AT99 codec: valid checksums cannot hide invalid binary structure or version bundles", () => {
  const wire = bytes => {
    const alphabet = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
    let value = 1n, body = "", checksum = 0;
    for (const byte of bytes) value = (value << 8n) | BigInt(byte);
    while (value) { body = alphabet[Number(value % 31n)] + body; value /= 31n; }
    for (const char of body) checksum = (checksum * 17 + alphabet.indexOf(char)) % 31;
    return `VTL5-${body.match(/.{1,4}/gu).join("-")}-${alphabet[checksum]}`;
  };
  const seeds = Array(12).fill(0);
  assert.equal(decodeSeedCode(wire([2, 0, ...seeds])).error, "別の版のたね");
  for (const bytes of [
    [1, 128, ...seeds], [1, 0, ...seeds, 0], [1, 0, ...seeds.slice(1)],
    [1, 16, ...seeds, 128], // truncated integer
    [1, 16, ...seeds, ...Array(8).fill(255), 1], // overflow
    [1, 16, ...seeds, 129, 0, 0], // overlong encoding of 1
    [1, 16, ...seeds, 1, 1, 2], // field generation exceeds total
    [1, 32, ...seeds, 0], // redundant empty map
    [1, 32, ...seeds, 128, 128, 64], // unknown field bit
    [1, 32, ...seeds, 8, 101, 0], // invalid PT ID
  ]) assert.equal(decodeSeedCode(wire(bytes)).ok, false);
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
  for (const background of ["BG06", "BG07", "BG08", "BG09", "BG10", "BG11", "BG13"])
    assert.throws(() => generateHousehold(params, { ...input, background }));
  for (const age of [17, 18.5, NaN]) assert.throws(() => generateHousehold(params, { ...input, age }));
  assert.deepEqual(generatePerson(params, 123), generatePerson(params, 123));
});

test("P-18 age: truncated normal peaks at 25 and uses configured standard deviation", () => {
  const rows = ageWeights(params), age = params.collections.initialWeights.generation.age;
  assert.deepEqual([age.min, age.max, age.mean, age.standardDeviation], [18, 45, 25, 6]);
  assert.equal(rows.length, 28);
  assert.equal(rows.reduce((a, b) => a.weight > b.weight ? a : b).age, 25);
  assert.equal(rows.find(row => row.age === 19).weight, rows.find(row => row.age === 31).weight);
  assert.equal(rows.find(row => row.age === 31).weight, Math.exp(-0.5));
  const total = rows.reduce((sum, row) => sum + row.weight, 0), counts = new Map(rows.map(row => [row.age, 0]));
  for (let seed = 0; seed < 20000; seed++) {
    const selected = createRng(seed, "person").fork("age").weighted(rows, rows.map(row => row.weight)).age;
    counts.set(selected, counts.get(selected) + 1);
    if (seed < 200) assert.equal(generatePerson(params, seed).personTemplate.age, selected);
  }
  for (const row of rows) assert.ok(Math.abs(counts.get(row.age) / 20000 - row.weight / total) < 0.008);
  const altered = copy(params);
  altered.collections.initialWeights.generation.age.standardDeviation = 3;
  assert.ok(ageWeights(altered).find(row => row.age === 31).weight < rows.find(row => row.age === 31).weight);
  altered.collections.initialWeights.generation.age.mean = 30;
  assert.equal(ageWeights(altered).find(row => row.age === 30).weight, 1);
  for (const standardDeviation of [0, -1, NaN]) {
    altered.collections.initialWeights.generation.age.standardDeviation = standardDeviation;
    assert.throws(() => generatePerson(altered, 1), /age distribution/);
  }
});

test("P-18 background eligibility and initial values are data-driven without retired IDs or blanket bonuses", () => {
  const g = params.collections.initialWeights.generation;
  const mapped = g.backgroundCategories.flatMap(category => category.candidates.map(row => row.backgroundId));
  const active = params.collections.backgrounds.filter(row => !row.status?.startsWith("削除")).map(row => row.id);
  assert.deepEqual([...mapped].sort(), [...active].sort());
  const seen = new Set();
  for (let seed = 0; seed < 1000; seed++) {
    const { personTemplate: p, provenance } = generatePerson(params, seed);
    seen.add(p.background);
    const category = g.backgroundCategories.find(row => row.key === p.backgroundCategory);
    const rule = category.candidates.find(row => row.backgroundId === p.background);
    assert.ok(p.age >= rule.minAge && p.age <= rule.maxAge);
    assert.ok(p.startYear >= rule.minYear && p.startYear <= rule.maxYear);
    assert.equal(p.coreDisposition && Object.keys(p.coreDisposition).length, 8);
    for (const value of Object.values(p.coreDisposition)) assert.ok(value >= 0 && value <= 1);
    for (const value of Object.values(p.abilities)) assert.ok(value >= 0 && value <= 100);
    for (const e of p.experience) assert.ok(e.startAge >= g.experience.earliestAge && e.endAge === p.age);
    assert.deepEqual(p.qualifications, []);
    assert.equal(provenance.age.evidenceClass, "仮置き");
    assert.equal(provenance.abilities.method, "derived");
    if (p.background === "BG31") {
      assert.equal(p.life.monthlyIncomeYen, 0);
      assert.equal(p.life.workHoursPerWeek, 0);
    }
  }
  assert.deepEqual([...seen].sort(), active.sort());
  const altered = copy(params);
  altered.collections.initialWeights.generation.backgroundCategories = [{
    ...g.backgroundCategories[0], candidates: [{ ...g.backgroundCategories[0].candidates[2],
      backgroundId: "BG31", lifeProfile: "homemaker" }],
  }];
  const original = generatePerson(params, 42).personTemplate, changed = generatePerson(altered, 42).personTemplate;
  assert.deepEqual(changed.abilities, original.abilities);
  assert.deepEqual(changed.coreDisposition, original.coreDisposition);
  assert.deepEqual(changed.naturalSpeech, original.naturalSpeech);
});

test("P-18 affiliation fails clearly when no row fits the year or experience", () => {
  for (const constraint of [{ minYear: 2027 }, { minPracticeYears: 7 }]) {
    const altered = copy(params);
    altered.collections.initialWeights.generation.affiliations =
      altered.collections.initialWeights.generation.affiliations.map(row => ({ ...row, ...constraint }));
    assert.throws(() => generatePerson(altered, 42), {
      name: "TypeError", message: "No eligible initial affiliation for start year and practice years",
    });
  }
});

test("AT136/AT138/AT139 BG22 always has children, including its single-parent branch", () => {
  let unions = 0, singleParents = 0;
  for (let seed = 0; seed < 10000; seed++) {
    const age = 20 + seed % 26, h = generateHousehold(params, { personSeed: seed, age, background: "BG22" }).household;
    assert.ok(h.children.length >= 1 && h.children.length <= 3);
    assert.ok(h.childcareHoursPerWeek > 0);
    for (const child of h.children) assert.ok(child.relativeAge >= 0 && child.relativeAge <= Math.min(age - 20, 17));
    if (["married", "partnered"].includes(h.maritalStatus)) unions++;
    else {
      singleParents++;
      assert.equal(h.maritalStatus, "single");
      assert.equal(h.partner, null);
      assert.equal(h.partnerShare, 0);
    }
  }
  assert.ok(Math.abs(unions / 10000 - 0.85) < 0.02);
  assert.ok(singleParents > 0);
  assert.throws(() => generateHousehold(params, { personSeed: 1, age: 19, background: "BG22" }));
  const altered = copy(params);
  altered.collections.initialWeights.generation.bg22.unionProbability = 0;
  const h = generateHousehold(altered, { personSeed: 1, age: 20, background: "BG22" }).household;
  assert.equal(h.maritalStatus, "single");
  assert.ok(h.children.every(child => child.relativeAge === 0));
});

test("AT136/AT138/AT139 M18 q15 keeps both BG22 branches with shipped settings", () => {
  const rule = params.collections.initialWeights.generation.bg22;
  assert.equal(rule.unionProbability, 0.85);
  assert.equal(rule.childrenRequired, true);
  assert.equal(rule.nonUnion, "single_parent");
  for (const age of [20, 25, 45]) {
    // Fixed seeds exercise both branches without overriding the shipped probability.
    for (const personSeed of [8, 9]) {
      const result = generateHousehold(params, { personSeed, age, background: "BG22" });
      const h = result.household;
      assert.ok(h.children.length >= 1 && h.children.length <= 3);
      assert.ok(h.childcareHoursPerWeek > 0);
      assert.equal(result.provenance.basis, rule.basis);
      for (const label of ["q15", "yes", "仮置き", "統計値ではない"])
        assert.ok(result.provenance.basis.includes(label));
      if (personSeed === 9) {
        assert.equal(h.maritalStatus, "single");
        assert.equal(h.partner, null);
        assert.equal(h.partnerShare, 0);
      } else {
        assert.ok(["married", "partnered"].includes(h.maritalStatus));
        assert.ok(h.partner);
        assert.ok(h.partnerShare > 0);
      }
    }
  }
});

test("AT136/AT138 BG22 single_parent preserves children without forcing marriage", () => {
  const altered = copy(params), rule = altered.collections.initialWeights.generation.bg22;
  assert.equal(rule.nonUnion, "single_parent");
  assert.equal(rule.childrenRequired, true);
  assert.equal(rule.unionProbability, 0.85);
  assert.ok(rule.basis.includes("仮置き"));
  for (const unionProbability of [0, 1]) {
    rule.unionProbability = unionProbability;
    for (const age of [20, 25, 45]) {
      for (let personSeed = 0; personSeed < 20; personSeed++) {
        const input = { personSeed, age, background: "BG22" };
        const result = generateHousehold(altered, input), h = result.household;
        assert.deepEqual(generateHousehold(altered, input), result);
        assert.equal(result.provenance.basis, rule.basis);
        assert.equal(result.provenance.playerOverride, false);
        assert.ok(h.children.length >= 1 && h.children.length <= 3);
        assert.ok(h.childcareHoursPerWeek > 0);
        for (const child of h.children)
          assert.ok(child.relativeAge >= 0 && child.relativeAge <= Math.min(age - 20, 17));
        if (unionProbability === 0) {
          assert.equal(h.maritalStatus, "single");
          assert.equal(h.partner, null);
          assert.equal(h.partnerShare, 0);
        } else {
          assert.ok(["married", "partnered"].includes(h.maritalStatus));
          assert.ok(h.partner);
          assert.ok(h.partnerShare > 0);
        }
      }
    }
  }
});

test("AT98/AT99 editor: every preset, locks, rerolls and next reroll survive seed-code import", () => {
  for (const seed of [1, 35, 123, "editor-round-trip"]) {
    const session = createSetup(params, { seed, entry: "QS3" });
    const person = session.snapshot().personTemplate;
    session.reroll();
    session.setLock("v_appearance", true);
    session.reroll("mainActivity");
    session.override("world", { preset: "CS12_01", custom: null });
    const before = session.snapshot(), code = session.exportSeedCode();
    const restored = importSeedCode(params, code);
    assert.equal(restored.ok, true);
    const after = restored.session.snapshot();
    assert.deepEqual(after, before);
    assert.equal(restored.session.exportSeedCode(), code);
    assert.equal(restored.session.undoCount, 0);
    assert.deepEqual(restored.session.reroll(), session.reroll());
    assert.strictEqual(session.snapshot().personTemplate, person);
  }
});

test("AT98/AT100 editor: custom names are omitted, withdrawn ledger names cannot be imported", () => {
  const session = createSetup(params, { seed: "name-ledger", entry: "QS3" });
  const before = session.snapshot(), code = session.exportSeedCode();
  assert.equal(before.runSetupTemplate.naming.releaseReady, false);
  assert.equal(before.runSetupTemplate.naming.status, "DRAFT");
  const altered = copy(params);
  altered.collections.initialWeights.vDefaults.nameLedger.candidates.find(row =>
    row.id === before.runSetupTemplate.v.name.preset).status = "REJECTED_COLLISION";
  assert.equal(importSeedCode(altered, code).ok, false);
  session.override("name", { custom: "自由に付けた名前" });
  const imported = importSeedCode(params, session.exportSeedCode());
  assert.equal(imported.ok, true);
  assert.deepEqual(imported.notices, ["自由入力の項目は共有されません"]);
  assert.equal(imported.session.snapshot().runSetupTemplate.v.name.custom, null);
  assert.deepEqual(imported.session.snapshot().personTemplate, before.personTemplate);
  assert.throws(() => session.override("name", { custom: "あ".repeat(25) }));
});

test("P-18 activity presets respect era on generation, edit, reroll and import", () => {
  let early;
  for (let seed = 0; seed < 100; seed++) {
    const session = createSetup(params, { seed, entry: "QS3" });
    if (session.snapshot().personTemplate.startYear < 2021) { early = session; break; }
  }
  assert.ok(early);
  for (let i = 0; i < 30; i++) assert.notEqual(early.reroll("mainActivity").runSetupTemplate.policy.format, "shorts");
  assert.throws(() => early.override("mainActivity", { preset: "CS92_01", custom: null }));
  const decoded = decodeSeedCode(early.exportSeedCode()).record;
  decoded.selections.mainActivity = { preset: "CS92_01", custom: null };
  assert.equal(importSeedCode(params, encodeSeedCode(decoded)).ok, false);
});
