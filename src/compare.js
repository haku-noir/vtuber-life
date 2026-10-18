import { createSimulation, validateSimulation } from "./sim.js";
import { addMonths } from "./calendar.js";
import { createRng } from "./rng.js";
import { lifeRecord } from "./epilogue.js";

export function alternateEra(params, original, year) {
  validateSimulation(params, original);
  const source = params.collections.initialWeights.generation;
  // The permitted start-year interval is supplied by the existing setup data.
  const yearRow = params.collections.initialWeights.items.find(row => row.対象 === "開始年");
  const range = yearRow?.["重み・値"]?.match(/(\d{4})[～〜](\d{4})/u);
  if (!range || !Number.isInteger(year) || year < Number(range[1]) || year > Number(range[2]))
    throw new TypeError("Invalid comparison start year");
  const setup = structuredClone(original.runSetupTemplate);
  setup.startDate = addMonths(setup.startDate, (year - Number(setup.startDate.slice(0, 4))) * 12);
  const differences = [];
  // Re-evaluate era opportunities from the same fixed person, without regenerating them.
  const person = original.personTemplate;
  const practice = Math.max(0, ...(person.experience ?? []).map(row => row.endAge - row.startAge));
  const eligible = source.affiliations.filter(row => year >= row.minYear && practice >= row.minPracticeYears);
  if (!eligible.length) throw new TypeError("No eligible comparison affiliation");
  const rng = createRng(person.personSeed ?? original.seed, "person").fork("affiliation");
  const affiliation = rng.weighted(eligible, eligible.map(row => row.weight.value)).value;
  differences.push({ field: "initialAffiliation", from: original.initialAffiliation, to: affiliation });
  // Short-form intent survives; the platform format is replaced only before its availability.
  const short = params.collections.initialWeights.vDefaults.candidates.mainActivity.find(row => row.value.format === "shorts");
  if (setup.policy.format === "shorts" && short && year < short.minYear) {
    differences.push({ field: "policy.format", from: "shorts", to: "video", reason: "short-video-before-platform" });
    setup.policy.format = "video";
  }
  if (setup.dream && typeof setup.dream === "object") {
    if (setup.dream.targetRule === "specific") throw new TypeError("Initial dream must use a portable target rule");
    delete setup.dream.targetId;
  }
  const next = createSimulation(params, { seed: original.seed, personTemplate: person, runSetupTemplate: setup });
  next.runId = `${original.runId}-era-${year}`;
  next.initialAffiliation = affiliation;
  next.comparison = { sourceRunId: original.runId, originalStartDate: original.calendar.startDate,
    differences, caveat: "同じ人物条件からの仮想人生です。差を年代だけの因果効果や現実の予測とは扱いません。" };
  return validateSimulation(params, next);
}

export function compareRuns(left, right) {
  return { left: lifeRecord(left), right: lifeRecord(right), axis: "elapsed-week", padAfterEnd: false,
    differences: { versions: JSON.stringify(left.versions) !== JSON.stringify(right.versions),
      initialSetup: JSON.stringify(left.runSetupTemplate) !== JSON.stringify(right.runSetupTemplate),
      choices: JSON.stringify(left.choiceHistory) !== JSON.stringify(right.choiceHistory),
      dreams: JSON.stringify(left.dreamState.instances) !== JSON.stringify(right.dreamState.instances),
      policy: JSON.stringify(left.policy) !== JSON.stringify(right.policy) },
    assumptions: structuredClone(right.comparison ?? null) };
}
