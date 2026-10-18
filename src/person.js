import { createRng } from "./rng.js";
import { addDays, daysBetween } from "./calendar.js";
import { ABILITY_AXES, getCandidates } from "./params.js";

export function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

export function initialRule(params, target) {
  const rule = params.collections.initialWeights.items.find(row => row.対象 === target);
  if (!rule) throw new TypeError(`Missing initial rule: ${target}`);
  return rule;
}

export function provenance(value, rule, method, playerOverride = false) {
  return { value, method, evidenceClass: rule.区分, basis: rule["重み・値"], playerOverride };
}

export function generateStartDate(params, personSeed) {
  const rule = initialRule(params, "開始年");
  const match = /^(\d{4})～(\d{4})年、各年1\/(\d+)/u.exec(rule["重み・値"]);
  if (rule.方法 !== "一様" || !match || Number(match[2]) - Number(match[1]) + 1 !== Number(match[3]))
    throw new TypeError("Unresolved start-year weights");
  if (initialRule(params, "開始月・日")["重み・値"] !== "年内の各日同じ")
    throw new TypeError("Unresolved start-date weights");
  const rng = createRng(personSeed, "person");
  const year = rng.fork("startYear").int(Number(match[1]), Number(match[2]));
  const first = `${year}-01-01`;
  return addDays(first, rng.fork("startDate").int(0, daysBetween(first, `${year + 1}-01-01`) - 1));
}

// Integer ages are sampled from the normal density at each integer, conditioned
// on the configured bounds. These are game weights, not population statistics.
export function ageWeights(params) {
  const a = params.collections.initialWeights.generation.age;
  if (a.distribution !== "truncated_discrete_normal" || !Number.isSafeInteger(a.min) ||
      !Number.isSafeInteger(a.max) || a.min < 18 || a.max < a.min || a.max - a.min > 200 ||
      !Number.isFinite(a.mean) || a.mean < a.min || a.mean > a.max ||
      !Number.isFinite(a.standardDeviation) || a.standardDeviation <= 0)
    throw new TypeError("Invalid age distribution");
  return Array.from({ length: a.max - a.min + 1 }, (_, i) => ({
    age: a.min + i, weight: Math.exp(-0.5 * ((a.min + i - a.mean) / a.standardDeviation) ** 2),
  }));
}

function integer(rng, range) {
  if (!range || !Number.isSafeInteger(range.min) || !Number.isSafeInteger(range.max) ||
      range.min < 0 || range.max < range.min) throw new TypeError("Invalid initial range");
  return rng.int(range.min, range.max);
}
function uniform(rng, range) {
  if (!range || !Number.isFinite(range.min) || !Number.isFinite(range.max) ||
      range.min < 0 || range.max < range.min) throw new TypeError("Invalid initial range");
  return range.min + rng.next() * (range.max - range.min);
}
const pick = (rng, rows) => rng.weighted(rows, rows.map(row => row.weight.value));
const generated = (value, source, method) => ({
  value, method, evidenceClass: source.evidenceClass, basis: source.basis, playerOverride: false,
});

export function generatePerson(params, personSeed) {
  const source = params.collections.initialWeights.generation;
  if (!source || source.evidenceClass !== "仮置き") throw new TypeError("Missing P-18 generation data");
  const rng = createRng(personSeed, "person"), startDate = generateStartDate(params, personSeed);
  const startYear = Number(startDate.slice(0, 4)), ages = ageWeights(params);
  const age = rng.fork("age").weighted(ages, ages.map(row => row.weight)).age;
  const active = new Set(getCandidates(params, "backgrounds").map(row => row.id));
  const categories = source.backgroundCategories.map(category => ({ ...category,
    candidates: category.candidates.filter(row => active.has(row.backgroundId) &&
      age >= row.minAge && age <= row.maxAge && startYear >= row.minYear && startYear <= row.maxYear),
  })).filter(category => category.candidates.length);
  const category = pick(rng.fork("backgroundCategory"), categories);
  const backgroundRule = pick(rng.fork("background"), category.candidates);
  const background = backgroundRule.backgroundId, lifeRule = source.life;
  const profile = lifeRule.profiles[backgroundRule.lifeProfile];
  if (!profile) throw new TypeError("Missing background life profile");
  const life = {
    monthlyIncomeYen: integer(rng.fork("income"), profile.monthlyIncomeYen),
    livingCostYen: integer(rng.fork("livingCost"), lifeRule.livingCostYen),
    openingBalanceYen: integer(rng.fork("balance"), lifeRule.openingBalanceYen),
    workHoursPerWeek: integer(rng.fork("work"), profile.workHoursPerWeek),
    region: pick(rng.fork("region"), lifeRule.regions).value,
  };
  const family = generateHousehold(params, { personSeed, age, background });
  life.careHoursPerWeek = family.household.childcareHoursPerWeek;
  const core = source.coreDisposition;
  if (core.distribution !== "uniform" || core.axes.length !== 8 || new Set(core.axes).size !== 8 ||
      core.min !== 0 || core.max !== 1) throw new TypeError("Invalid disposition axes");
  const coreDisposition = Object.fromEntries(core.axes.map(axis => [axis, uniform(rng.fork("core", axis), core)]));
  const naturalSpeech = Object.fromEntries(Object.entries(source.naturalSpeech).map(([field, rows]) =>
    [field, pick(rng.fork("speech", field), rows).value]));
  if (!naturalSpeech.firstPerson || !naturalSpeech.acknowledgement) throw new TypeError("Missing NaturalSpeech");
  const e = source.experience, abilities = {}, aptitudes = {};
  // Practice and aptitude are sampled separately from BG, household and V.
  // A job or qualification never supplies a blanket ability bonus.
  const experience = ABILITY_AXES.map(axis => {
    const years = integer(rng.fork("practiceYears", axis), {
      min: e.years.min, max: Math.min(e.years.max, age - e.earliestAge),
    });
    const hours = years * integer(rng.fork("practiceHours", axis), e.hoursPerYear);
    aptitudes[axis] = uniform(rng.fork("aptitude", axis), e.aptitude);
    abilities[axis] = Math.min(params.collections.simBalance.ability.max,
      Math.max(params.collections.simBalance.ability.min, e.abilityBase + aptitudes[axis] * e.aptitudeScale + hours * e.gainPerHour));
    return { kind: "practice", axis, startAge: age - years, endAge: age, hours };
  });
  const practiceYears = Math.max(...experience.map(row => row.endAge - row.startAge));
  const initialAffiliation = pick(rng.fork("affiliation"), source.affiliations.filter(row =>
    startYear >= row.minYear && practiceYears >= row.minPracticeYears)).value;
  const currentWork = { background, kind: backgroundRule.kind, lifeProfile: backgroundRule.lifeProfile };
  const employment = backgroundRule.kind === "employment" ? [{ background, startAge: age, endAge: null }] : [];
  const personTemplate = freeze({ personSeed, generationVersion: source.version, startDate, startYear,
    age, background, backgroundCategory: category.key, currentWork, employment, experience, qualifications: [],
    aptitudes, abilities, life, household: family.household, coreDisposition, naturalSpeech, initialAffiliation,
    motivation: pick(rng.fork("motivation"), lifeRule.motivations).value });
  const fields = {
    startYear: provenance(startYear, initialRule(params, "開始年"), "uniform"),
    startDate: provenance(startDate, initialRule(params, "開始月・日"), "uniform"),
    age: generated(age, source, "truncated_discrete_normal"),
    background: generated(background, source, "category_then_eligible_weighted"),
    household: family.provenance,
  };
  for (const key of ["backgroundCategory", "currentWork", "employment", "experience", "qualifications",
    "aptitudes", "abilities", "life", "coreDisposition", "naturalSpeech", "initialAffiliation", "motivation"])
    fields[key] = generated(personTemplate[key], source,
      ["abilities", "employment", "currentWork", "qualifications"].includes(key) ? "derived" : "random");
  return freeze({ personTemplate, provenance: fields, issues: [] });
}

const parsedHouseholds = new WeakMap();
function capture(text, pattern, field) {
  const match = pattern.exec(text);
  if (!match) throw new TypeError(`Unresolved household parameter: ${field}`);
  return match.slice(1).map(Number);
}

// Limited adapters for P-20's prose-valued JSON. A changed grammar fails loudly.
function householdRules(params) {
  const source = params.collections.householdInitial;
  if (Object.isFrozen(source) && parsedHouseholds.has(source)) return parsedHouseholds.get(source);
  const text = (table, key) => {
    const row = table.find(row => row.項目 === key);
    if (!row) throw new TypeError(`Missing household parameter: ${key}`);
    return row.値;
  };
  const adjustment = key => text(source.occupationAdjustmentsAndBreakdown, key);
  const child = key => text(source.children, key);
  const decimal = "([0-9]+(?:\\.[0-9]+)?)";
  const rules = {
    married: source.marriedBaseByAgeBand.map(row => {
      const match = /^(\d+)(?:～(\d+)歳|歳以上)$/u.exec(row.ageBand);
      if (!match) throw new TypeError("Invalid age band");
      return { min: Number(match[1]), max: match[2] ? Number(match[2]) : Infinity, ...row };
    }),
    starter: source.starterAdjustment.value,
    bg31: capture(adjustment("BG31 専業主婦（主夫）"), new RegExp(`確率を${decimal}に`), "BG31")[0],
    bg21: capture(adjustment("BG21 大学・専門学校の学生"), new RegExp(`^基準値×${decimal}$`), "BG21")[0],
    other: capture(adjustment("その他の職業"), new RegExp(`^基準値×${decimal}$`), "other")[0],
    union: capture(adjustment("既婚の内訳"), new RegExp(`^法律婚${decimal}／事実婚・パートナー同居${decimal}$`), "union"),
    dating: capture(adjustment("未婚のうち交際中で始まる"), new RegExp(`^${decimal}$`), "dating")[0],
    children: [...child("既婚の場合に子供あり").matchAll(/(\d+)(?:～(\d+)歳|歳以上)(0\.\d+)/gu)]
      .map(m => ({ min: Number(m[1]), max: m[2] ? Number(m[2]) : Infinity, value: Number(m[3]) })),
    counts: capture(child("人数"), new RegExp(`^1人${decimal}、2人${decimal}、3人以上${decimal}$`), "counts"),
    childAge: capture(child("子の年齢"), /^(\d+)歳～（本人の実年齢−(\d+)）歳で一様。上限(\d+)歳$/u, "child age"),
    care: capture(child("育児負荷（週の時間、子1人あたり）"), /^(\d+)～(\d+)歳(\d+)時間、(\d+)～(\d+)歳(\d+)時間、(\d+)～(\d+)歳(\d+)時間、(\d+)～(\d+)歳(\d+)時間。2人目以降は×([\d.]+)$/u, "care"),
    share: capture(child("パートナーの家事・育児の分担比"), /^([\d.]+)～([\d.]+)で一様$/u, "share"),
    relationship: capture(child("関係の良好度の初期値"), /^既婚・交際中で(\d+)～(\d+)の一様$/u, "relationship"),
    income: child("パートナーの収入区分").split("を各")[0].split("・"),
    incomeWeight: capture(child("パートナーの収入区分"), /を各1\/(\d+)$/u, "income")[0],
    evidenceClass: "仮置き", sourceIds: [...new Set(source.marriedBaseByAgeBand.flatMap(row => row.sourceIds))],
  };
  if (!rules.children.length || rules.income.length !== rules.incomeWeight) throw new TypeError("Invalid household rules");
  if (Object.isFrozen(source)) parsedHouseholds.set(source, rules);
  return rules;
}

// Internal domain API for an already generated adult. This is not a player override.
export function generateHousehold(params, { personSeed, age, background }) {
  if (!Number.isSafeInteger(age) || age < 18 || !getCandidates(params, "backgrounds").some(row => row.id === background))
    throw new TypeError("Household requires an adult and an active BG");
  const bg22 = params.collections.initialWeights.generation.bg22;
  if (bg22.childrenRequired !== true || bg22.nonUnion !== "single_parent" ||
      !Number.isSafeInteger(bg22.minimumAge) || bg22.minimumAge < 20)
    throw new TypeError("Invalid BG22 household rule");
  if (background === "BG22" && age < bg22.minimumAge) throw new TypeError("BG22 requires a feasible child age");
  const r = householdRules(params), rng = createRng(personSeed, "person", "household");
  const band = r.married.find(row => age >= row.min && age <= row.max);
  const childBand = r.children.find(row => age >= row.min && age <= row.max);
  if (!band || !childBand) throw new TypeError("Missing household age band");
  const chance = background === "BG22" ? bg22.unionProbability : background === "BG31" ? r.bg31 : band.value * r.starter * (background === "BG21" ? r.bg21 : r.other);
  if (!Number.isFinite(chance) || chance < 0 || chance > 1) throw new TypeError("Invalid union probability");
  const inUnion = rng.fork("union").next() < chance;
  const maritalStatus = inUnion ? rng.fork("status").weighted(["married", "partnered"], r.union)
    : background !== "BG22" && rng.fork("dating").next() < r.dating ? "dating" : "single";
  const hasPartner = maritalStatus !== "single";
  const partnerShare = inUnion ? r.share[0] + rng.fork("share").next() * (r.share[1] - r.share[0]) : 0;
  const maxAge = Math.min(age - r.childAge[1], r.childAge[2]);
  const hasChildren = maxAge >= r.childAge[0] && (background === "BG22" ||
    (inUnion && rng.fork("children").next() < childBand.value));
  const childCount = hasChildren ? rng.fork("count").weighted([1, 2, 3], r.counts) : 0;
  const children = Array.from({ length: childCount }, (_, i) => ({
    id: `child-${i + 1}`, relativeAge: rng.fork("child", i).int(r.childAge[0], maxAge),
  }));
  const careBands = Array.from({ length: 4 }, (_, i) => r.care.slice(i * 3, i * 3 + 3));
  // Apply the full load to the youngest child, then P-20's marginal multiplier.
  const careHours = children.map(child => careBands.find(([min, max]) => child.relativeAge >= min && child.relativeAge <= max)[2])
    .sort((a, b) => b - a).reduce((sum, hours, i) => sum + hours * (i ? r.care[12] : 1), 0) * (1 - partnerShare);
  const household = { maritalStatus, partner: hasPartner ? {
    id: "partner-1", relationship: rng.fork("relationship").int(...r.relationship),
    incomeBand: inUnion ? rng.fork("income").weighted(r.income, r.income.map(() => 1 / r.incomeWeight)) : null,
  } : null, children, partnerShare, childcareHoursPerWeek: careHours,
  birthRole: "not_applicable", disclosure: "private" };
  return freeze({ household, provenance: { value: household, method: "stat_informed_weighted",
    evidenceClass: "推定／仮置き", referenceStatsIds: [...new Set([...r.sourceIds, "M32"])],
    basis: background === "BG22" ? "P-18 BG22 / P-20: 非同居はひとり親" : "P-20", playerOverride: false } });
}
