import { checkDreams, closeDreams } from "./dreams.js";

export function createLifeSnapshot(run, reason) {
  return { date: run.calendar.currentDate, reason,
    activityStatus: reason === "final-retirement" ? "retired" : "continuing",
    balanceYen: run.ledger.balanceYen, unmetLivingYen: run.economy.unmetLivingYen,
    workCount: run.works.length, subscribers: run.channels[0].subscribers };
}

// No future simulation, money, achievements, or family members are manufactured here.
export function buildEpilogue(run) {
  const relations = run.household.relationships.filter(row => row.status === "active");
  const children = run.household.children;
  const dailyLife = children.length ? "子供のいる暮らしの中で、自分の時間の使い方を少しずつ考えるようになった。"
    : relations.length ? "身近な人との関係を大切にしながら、日々の時間の使い方を少しずつ考えるようになった。"
      : "活動に向けていた時間の使い方を、少しずつ考えるようになった。";
  const workLife = run.personTemplate.currentWork?.kind === "employment" ? "仕事と暮らしは続いている。"
    : "日々の暮らしは続いている。";
  return { id: "epilogue-1", date: run.calendar.currentDate, reason: "final-retirement",
    referenceIds: ["person-1", ...relations.map(row => row.id), ...children.map(row => row.id),
      ...run.works.map(row => row.id), ...run.events.filter(row => row.kind === "catalog").map(row => row.id)],
    facts: { currentWork: structuredClone(run.personTemplate.currentWork ?? null),
      relationshipIds: relations.map(row => row.id), childIds: children.map(row => row.id), workCount: run.works.length },
    addedNarrative: [
      { period: "数か月後", text: `活動を終えてからも、${workLife}${dailyLife}これまでの経験をどう生かすか、すぐに答えを出す必要はない。` },
      { period: "その後", text: run.works.length
        ? "残した作品と記録を振り返ると、その時々の工夫や迷いが思い出される。数字だけでは表せない時間がそこにあった。人に見せるためでなく、好きだった表現を思い出す日もある。これからの暮らしは、まだ決まっていない。"
        : "記録を振り返ると、表現を始めようとした頃や、その時々に考えたことが思い出される。公に残した作品の数だけで、その時間の意味が決まるわけではない。これから何を大切にするかは、日々の暮らしの中でゆっくり考えていける。" },
    ] };
}

export function finishActivity(params, run) {
  if (run.epilogue) return;
  checkDreams(params, run);
  closeDreams(run);
  run.channels[0].status = "retired";
  run.channels[0].endDate = run.calendar.currentDate;
  run.lifeSnapshot = createLifeSnapshot(run, "final-retirement");
  run.epilogue = buildEpilogue(run);
  run.state = "EPILOGUE";
}

export function buildRunSummary(run) {
  return structuredClone({ runId: run.runId, seed: run.seed, versions: run.versions,
    startDate: run.calendar.startDate, endDate: run.calendar.currentDate,
    reason: run.lifeSnapshot?.reason ?? null, channels: run.channels,
    // Keep references in the persisted summary rather than duplicating an entire save.
    graph: { completedWeeks: run.weeklySnapshots.length, hasPartialWeek: run.weekProgress !== null,
      segmentCount: run.channelWeekSegments.length },
    workIds: run.works.map(row => row.id), eventRecordIds: run.events.map(row => row.id),
    household: run.household, lifeSnapshot: run.lifeSnapshot, epilogueId: run.epilogue?.id ?? null,
    initialDream: run.runSetupTemplate.dream ?? null, dreams: run.dreamState,
    comparison: run.comparison ?? null });
}

export function lifeRecord(run) {
  return { summary: buildRunSummary(run), graphs: structuredClone({ weeklySnapshots: run.weeklySnapshots,
    weekProgress: run.weekProgress, channelWeekSegments: run.channelWeekSegments }),
    works: structuredClone(run.works), releases: structuredClone(run.releases),
    timeline: structuredClone(run.events), epilogue: structuredClone(run.epilogue) };
}

export function validateEnding(run) {
  const final = run.channels[0].status === "retired";
  if (final !== !!run.epilogue || (run.state === "EPILOGUE" && !final) ||
      (final && !["EPILOGUE", "RESULT"].includes(run.state))) throw new TypeError("Invalid epilogue state");
  if (final && JSON.stringify(run.epilogue) !== JSON.stringify(buildEpilogue(run))) throw new TypeError("Invalid epilogue record");
  if (["EPILOGUE", "RESULT"].includes(run.state)) {
    const reason = run.lifeSnapshot?.reason;
    if ((final && reason !== "final-retirement") || (!final && !["observation-limit", "observation-stop"].includes(reason)) ||
        JSON.stringify(run.lifeSnapshot) !== JSON.stringify(createLifeSnapshot(run, reason))) throw new TypeError("Invalid life snapshot");
  } else if (run.lifeSnapshot !== null) throw new TypeError("Premature life snapshot");
  if (run.state === "RESULT") {
    if (!run.lifeSnapshot || !["final-retirement", "observation-limit", "observation-stop"].includes(run.lifeSnapshot.reason) ||
        JSON.stringify(run.runSummary) !== JSON.stringify(buildRunSummary(run))) throw new TypeError("Invalid life record");
  } else if (run.runSummary !== null) throw new TypeError("Premature life record");
}
