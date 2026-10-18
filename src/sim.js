import { ABILITY_AXES, BALANCE_VERSION, getSimBalance, validateParams } from "./params.js";
import { addDays, advanceCalendar, dayNumber, daysBetween } from "./calendar.js";
import { createSave, SAVE_VERSIONS, validateSave, serializeSave, loadSave } from "./save.js";
import { beginMonth, finishMonth, dailyAvailableHours } from "./economy.js";
import { advanceActivityDay } from "./activity.js";
import { createHouseholdState, validateHousehold } from "./household.js";
import { createEventState, advanceEvents, offerEvent, resolveEventChoice, validateEventState, appendAchievementEvidence } from "./events.js";
import { initializeDreams, checkDreams, validateDreams, selectDream, setDreamStatus, discloseDream,
  carryDreams, markDreamPresentationSeen } from "./dreams.js";
import { createLifeSnapshot, finishActivity, buildRunSummary, validateEnding } from "./epilogue.js";

export const SIM_VERSIONS = Object.freeze({ ...SAVE_VERSIONS,
  simulationVersion: "sim-0.4.0", balanceVersion: BALANCE_VERSION });
const clone = value => structuredClone(value);
const fail = message => { throw new TypeError(`Invalid simulation: ${message}`); };
const finite = (value, max = Number.MAX_SAFE_INTEGER) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= max;
const money = value => Number.isSafeInteger(value) && value >= 0;

function checkInitial(person, policy, balance) {
  if (!person || !person.life || !person.abilities) fail("complete life and abilities required");
  for (const axis of ABILITY_AXES) if (!finite(person.abilities[axis], balance.ability.max)) fail(`ability ${axis}`);
  for (const key of ["monthlyIncomeYen", "livingCostYen", "openingBalanceYen"])
    if (!money(person.life[key])) fail(`life ${key}`);
  for (const key of ["workHoursPerWeek", "careHoursPerWeek"])
    if (!finite(person.life[key], 168)) fail(`life ${key}`);
  if (!policy || !Object.hasOwn(balance.formats, policy.format) || !["off", "regular"].includes(policy.liveMode) ||
      typeof policy.voiceTraining !== "boolean") fail("activity policy");
}

function weekAt(run) {
  return { weekIndex: run.calendar.weekIndex, startDate: run.calendar.weekStart,
    observedStartDate: run.channels[0].startDate > run.calendar.weekStart ? run.channels[0].startDate : run.calendar.weekStart,
    endDate: run.calendar.currentDate, channelId: run.channels[0].id, subscribersStart: run.channels[0].subscribers,
    S: run.channels[0].subscribers, G: 0, U: 0, C: null, viewerMinutes: 0, streamMinutes: 0,
    videoViewsThisWeek: 0, partial: true };
}

// Domain entry point for explicit, resolved initial conditions. M10 connects QS1's
// completed PersonTemplate; incomplete M2 drafts are deliberately not filled in.
export function createSimulation(params, { seed, personTemplate, runSetupTemplate, ready } = {}) {
  validateParams(params);
  if (ready === false) fail("setup is not ready");
  const balance = getSimBalance(params);
  checkInitial(personTemplate, runSetupTemplate?.policy, balance);
  const run = createSave(params, { seed, startDate: runSetupTemplate.startDate,
    openingBalanceYen: personTemplate.life.openingBalanceYen });
  run.versions = { ...SIM_VERSIONS };
  run.personTemplate = clone(personTemplate);
  run.runSetupTemplate = clone(runSetupTemplate);
  run.policy = clone(runSetupTemplate.policy);
  run.persons = [{ id: "person-1" }];
  run.channels = [{ id: "channel-1", personId: "person-1", subscribers: 0, status: "active",
    startDate: run.calendar.startDate, endDate: null, streamNewSubscribers: 0 }];
  run.abilities = clone(personTemplate.abilities);
  run.debutAbilities = clone(personTemplate.abilities);
  run.fatigue = 0;
  run.activity = { productionHours: 0, streamHours: 0, regularViewers: 0, streamNewSubscribers: 0,
    projectStartDate: run.calendar.startDate };
  run.releases = [];
  run.economy = { month: null, summaries: [], unmetLivingYen: 0, reservedProductionYen: 0 };
  run.weekProgress = weekAt(run);
  run.lifeSnapshot = null;
  run.epilogue = null;
  run.runSummary = null;
  run.channelWeekSegments = [];
  run.initialAffiliation = personTemplate.initialAffiliation ?? null;
  run.comparison = null;
  run.household = createHouseholdState(personTemplate.household);
  for (const row of [...run.household.relationships, ...run.household.children]) run.persons.push({ id: row.id });
  run.eventState = createEventState(params, run);
  initializeDreams(params, run);
  return validateSimulation(params, run);
}

export function validateSimulation(params, run) {
  const balance = getSimBalance(params);
  validateSave(run, SIM_VERSIONS);
  checkInitial(run.personTemplate, run.policy, balance);
  if (!run.channels.length || run.channels.some((channel, i) =>
      channel.id !== `channel-${run.channels.length - i}` || !money(channel.subscribers) || !money(channel.streamNewSubscribers) ||
      !["active", "retired"].includes(channel.status) || (i > 0 && channel.status !== "retired") ||
      channel.startDate < run.calendar.startDate || channel.startDate > run.calendar.currentDate ||
      (channel.status === "retired" && (!channel.endDate || channel.endDate > run.calendar.currentDate)))) fail("channel");
  validateHousehold(run);
  validateEventState(params, run);
  validateDreams(params, run);
  validateEnding(run);
  for (const axis of ABILITY_AXES) {
    if (!finite(run.abilities?.[axis], balance.ability.max) ||
        run.debutAbilities?.[axis] !== run.personTemplate.abilities[axis]) fail("ability state");
  }
  if (!finite(run.fatigue, balance.time.fatigueLimit)) fail("fatigue");
  for (const key of ["productionHours", "streamHours", "regularViewers", "streamNewSubscribers"])
    if (!finite(run.activity?.[key])) fail(`activity ${key}`);
  dayNumber(run.activity.projectStartDate);
  if (run.activity.projectStartDate < run.calendar.startDate || run.activity.projectStartDate > run.calendar.currentDate ||
      !money(run.activity.streamNewSubscribers)) fail("activity cursor");
  if (!Array.isArray(run.releases) || run.releases.length !== run.works.length) fail("release table");
  const releases = new Set();
  const contributed = new Map(run.channels.map((row, i) => [row.id, i === 0 ? run.activity.streamNewSubscribers : row.streamNewSubscribers]));
  for (let i = 0; i < run.releases.length; i++) {
    const release = run.releases[i], work = run.works[i];
    if (typeof release.id !== "string" || releases.has(release.id) || release.workId !== work.id ||
        release.releaseDate !== work.releaseDate || !Object.hasOwn(balance.formats, work.format) ||
        !finite(work.quality, 1) || release.views !== work.views || release.newSubscribers !== work.newSubscribers ||
        !money(release.weekViews) || !money(release.weekIndex)) fail("release record");
    releases.add(release.id); contributed.set(work.channelId, contributed.get(work.channelId) + release.newSubscribers);
  }
  const subscribers = new Map(run.channels.map(row => [row.id, 0])), acquired = new Map(subscribers);
  if (!Array.isArray(run.channelWeekSegments)) fail("channel segments");
  for (const segment of run.channelWeekSegments) {
    dayNumber(segment.startDate); dayNumber(segment.endDate); dayNumber(segment.observedStartDate);
    if (segment.observedStartDate < segment.startDate || segment.endDate < segment.observedStartDate ||
        segment.endDate > run.calendar.currentDate || daysBetween(segment.startDate, segment.endDate) > 7 ||
        ![segment.G, segment.U, segment.S].every(value => money(value)) ||
        !finite(segment.viewerMinutes) || !finite(segment.streamMinutes) ||
        segment.C !== (segment.streamMinutes ? segment.viewerMinutes / segment.streamMinutes : null)) fail("channel segment");
  }
  const weeks = [...run.weeklySnapshots, ...run.channelWeekSegments, ...(run.weekProgress ? [run.weekProgress] : [])]
    .sort((a, b) => a.endDate.localeCompare(b.endDate));
  for (const week of weeks) {
    const previous = subscribers.get(week.channelId);
    if (week.subscribersStart !== previous || week.S !== previous + week.G - week.U ||
        !money(week.videoViewsThisWeek)) fail("weekly conservation");
    subscribers.set(week.channelId, week.S); acquired.set(week.channelId, acquired.get(week.channelId) + week.G);
  }
  if (run.weeklySnapshots.length !== run.calendar.weekIndex || run.channels.some(row =>
      subscribers.get(row.id) !== row.subscribers || acquired.get(row.id) !== contributed.get(row.id))) fail("audience totals");
  if (!run.economy || !money(run.economy.unmetLivingYen) || !money(run.economy.reservedProductionYen) ||
      run.economy.reservedProductionYen > run.ledger.balanceYen || !Array.isArray(run.economy.summaries)) fail("economy");
  if (run.economy.summaries.length !== run.ledger.settledMonths.length) fail("monthly settlement count");
  function checkMonth(month) {
    if (!month || !Number.isSafeInteger(month.days) || month.days < 1 || month.days > 31 ||
        daysBetween(month.startDate, month.endDate) !== month.days || month.yearMonth !== month.startDate.slice(0, 7) ||
        month.startDate < run.calendar.startDate || month.startDate > run.calendar.currentDate ||
        month.endDate > run.calendar.endDate) fail("monthly dates");
    for (const key of ["jobIncomeYen", "livingDueYen", "livingPaidYen", "unmetLivingYen", "lessonCostYen",
      "productionCostYen", "grossRevenueYen", "receiptYen"]) if (!money(month[key])) fail(`monthly ${key}`);
    if (!finite(month.lessonHoursPerDay, 24) || !Number.isSafeInteger(month.activityProfitYen) ||
        month.livingDueYen !== month.livingPaidYen + month.unmetLivingYen ||
        !month.gross || Object.keys(month.gross).length !== 5) fail("monthly accounting");
    for (const key of ["advertising", "support", "membership", "sponsorship", "sales"])
      if (!finite(month.gross[key])) fail("gross revenue");
  }
  if (run.economy.month !== null) checkMonth(run.economy.month);
  else if (run.calendar.currentDate !== run.calendar.startDate) fail("missing month");
  const settled = new Set();
  let unmet = 0;
  for (const month of run.economy.summaries) {
    checkMonth(month);
    if (settled.has(month.yearMonth) || !run.ledger.settledMonths.includes(month.yearMonth) || month.endDate > run.calendar.currentDate ||
        month.livingDueYen !== month.livingPaidYen + month.unmetLivingYen ||
        month.activityProfitYen !== month.receiptYen - month.productionCostYen - month.lessonCostYen) fail("monthly summary");
    settled.add(month.yearMonth); unmet += month.unmetLivingYen;
  }
  if (run.economy.month && !settled.has(run.economy.month.yearMonth)) unmet += run.economy.month.unmetLivingYen;
  if (unmet !== run.economy.unmetLivingYen) fail("unmet living total");
  const finished = run.calendar.currentDate === run.calendar.endDate;
  if ((finished && run.state !== "RESULT") || (finished && (run.weekProgress !== null ||
      run.lifeSnapshot?.reason !== "observation-limit" || run.lifeSnapshot?.activityStatus !== "continuing"))) fail("end state");
  if (!finished && run.weekProgress === null) fail("missing partial week");
  return run;
}

// Adapt the existing single-channel daily engine on a private draft. Closed
// channels keep their works/receipts as history; reuse requires a future rights model.
function advanceCurrentChannel(run, date, balance) {
  const allWorks = run.works, allReleases = run.releases, channelId = run.channels[0].id;
  const indices = allWorks.map((row, i) => row.channelId === channelId ? i : -1).filter(i => i >= 0);
  run.works = indices.map(i => allWorks[i]); run.releases = indices.map(i => allReleases[i]);
  const oldCount = run.works.length, entryCount = run.ledger.entries.length, eventCount = run.events.length;
  try {
    advanceActivityDay(run, date, balance);
    const workIds = new Map(), releaseIds = new Map();
    for (let i = oldCount; i < run.works.length; i++) {
      const work = run.works[i], release = run.releases[i];
      const id = `${channelId}-work-${i + 1}`, rid = `${channelId}-release-${i + 1}`;
      workIds.set(work.id, id); releaseIds.set(release.id, rid);
      work.id = id; work.channelId = channelId; release.id = rid; release.workId = id;
      allWorks.push(work); allReleases.push(release);
    }
    for (const entry of run.ledger.entries.slice(entryCount)) if (workIds.has(entry.workId)) {
      entry.workId = workIds.get(entry.workId); entry.transactionId = `production-${entry.workId}`;
    }
    for (const event of run.events.slice(eventCount)) {
      if (workIds.has(event.workId)) event.workId = workIds.get(event.workId);
      if (event.kind === "publication") event.id = `published-${event.workId}`;
      for (const [oldId, id] of releaseIds) if (event.id.startsWith(`rediscovery-${oldId}-`))
        event.id = event.id.replace(`rediscovery-${oldId}-`, `rediscovery-${id}-`);
    }
  } finally { run.works = allWorks; run.releases = allReleases; }
}

function advanceDraft(params, run, balance, eventDates) {
  const dates = [...eventDates, run.household.pendingBirth?.date, run.household.leave?.returnDate]
    .filter(date => date && date > run.calendar.currentDate);
  const step = advanceCalendar(run.calendar, dates);
  for (let date = run.calendar.currentDate; date < step.calendar.currentDate; date = addDays(date, 1)) {
    const template = run.personTemplate, h = run.household;
    const baseCare = template.household?.childcareHoursPerWeek ?? 0;
    const life = { ...template.life, careHoursPerWeek: Math.max(0, template.life.careHoursPerWeek - baseCare + h.childcareHoursPerWeek) };
    const available = dailyAvailableHours(life, balance);
    const scale = h.leave ? 0 : h.activityScale;
    life.careHoursPerWeek += available * 7 * (1 - scale);
    // Existing activity/economy functions consume life via PersonTemplate. Supply
    // a scoped runtime view on the private draft and restore the fixed template.
    run.personTemplate = { ...template, life };
    try {
      const policy = run.policy;
      if (h.leave) run.policy = { ...policy, voiceTraining: false, liveMode: "off" };
      try {
        beginMonth(run, date, balance);
        const lesson = h.leave ? 0 : run.economy.month.lessonHoursPerDay;
        const hours = Math.max(0, dailyAvailableHours(life, balance) - lesson) *
          (1 - balance.time.maxFatigueReduction * run.fatigue / balance.time.fatigueLimit);
        const f = balance.formats[run.policy.format];
        h.weekLoad.activityHours += lesson + hours * (f.productionShare + f.practiceShare +
          (run.policy.liveMode === "regular" ? f.streamShare : 0));
        h.weekLoad.privateHours += balance.time.lifeHoursPerDay + available * (1 - scale);
        h.weekLoad.days++;
        const savedLesson = run.economy.month.lessonHoursPerDay;
        if (h.leave) run.economy.month.lessonHoursPerDay = 0;
        try { advanceCurrentChannel(run, date, balance); }
        finally { run.economy.month.lessonHoursPerDay = savedLesson; }
      } finally { run.policy = policy; }
    } finally { run.personTemplate = template; }
  }
  run.weekProgress.endDate = step.calendar.currentDate;
  // Income for the closing month is booked before the week's snapshot. A month
  // beginning at the end cursor is opened only when its first day is simulated.
  if (step.boundary.kinds.includes("month") || step.boundary.kinds.includes("end")) finishMonth(run, balance);
  run.calendar = step.calendar;
  checkDreams(params, run);
  if (step.completedWeek) {
    run.weekProgress.partial = step.completedWeek.partial;
    run.weeklySnapshots.push(run.weekProgress);
    run.weekProgress = run.calendar.currentDate === run.calendar.endDate ? null : weekAt(run);
  }
  if (step.boundary.kinds.includes("end")) {
    run.state = "RESULT";
    run.lifeSnapshot = createLifeSnapshot(run, "observation-limit");
    run.runSummary = buildRunSummary(run);
  } else advanceEvents(params, run, { week: !!step.completedWeek, month: step.boundary.kinds.includes("month") });
}

export function advanceToBoundary(params, run, eventDates = []) {
  validateSimulation(params, run);
  if (run.state === "EPILOGUE") return completeEpilogue(params, run);
  if (run.state !== "RUNNING" || run.pendingDecision) return run;
  const next = clone(run);
  advanceDraft(params, next, getSimBalance(params), eventDates);
  return validateSimulation(params, next);
}

// Batch execution uses exactly the same boundary procedure, without UI clocks or
// speculative output. Budget exhaustion returns a resumable committed boundary.
export function runToEnd(params, run, maxBoundaries = Number.MAX_SAFE_INTEGER) {
  validateSimulation(params, run);
  if (!Number.isSafeInteger(maxBoundaries) || maxBoundaries < 0) fail("boundary budget");
  if (run.state === "EPILOGUE" && maxBoundaries) return completeEpilogue(params, run);
  if (run.state !== "RUNNING" || run.pendingDecision || !maxBoundaries) return run;
  const next = clone(run), balance = getSimBalance(params);
  for (let i = 0; i < maxBoundaries && next.state === "RUNNING" && !next.pendingDecision; i++)
    advanceDraft(params, next, balance, []);
  return validateSimulation(params, next);
}

export function setPaused(params, run, paused) {
  validateSimulation(params, run);
  if (typeof paused !== "boolean") fail("pause flag");
  if (!["RUNNING", "PAUSED", "CHOICE"].includes(run.state)) return run;
  return { ...run, state: paused ? "PAUSED" : run.pendingDecision ? "CHOICE" : "RUNNING" };
}

export function answerDecision(params, run, decisionId, optionId) {
  validateSimulation(params, run);
  const next = clone(run);
  if (!resolveEventChoice(params, next, decisionId, optionId)) return run;
  if (run.state === "PAUSED" && next.state !== "EPILOGUE") next.state = "PAUSED";
  return validateSimulation(params, next);
}

// For scripted events and an explicitly requested early return from leave.
export function requestEvent(params, run, eventId, relationshipId = null) {
  validateSimulation(params, run);
  const next = clone(run);
  offerEvent(params, next, eventId, relationshipId);
  return validateSimulation(params, next);
}

export function respondToRelationshipWarning(params, run, response) {
  validateSimulation(params, run);
  if (!["together", "discussion", "unchanged"].includes(response)) fail("relationship response");
  if (!["RUNNING", "PAUSED"].includes(run.state) || run.pendingDecision ||
      !run.household.relationships.some(row => row.warnings > 0)) return run;
  const next = clone(run);
  next.household.weeklyResponse = response;
  return validateSimulation(params, next);
}

export function serializeSimulation(params, run) {
  validateSimulation(params, run);
  return serializeSave(run, SIM_VERSIONS);
}

export function changeDream(params, run, selection) {
  validateSimulation(params, run);
  if (!["RUNNING", "PAUSED", "CHOICE"].includes(run.state)) fail("dream editing after ending");
  const next = clone(run);
  checkDreams(params, next);
  selectDream(params, next, selection);
  return validateSimulation(params, next);
}

export function updateDream(params, run, action) {
  validateSimulation(params, run);
  if (!["RUNNING", "PAUSED", "CHOICE"].includes(run.state)) fail("dream editing after ending");
  const next = clone(run);
  if (action === "public") discloseDream(next);
  else setDreamStatus(next, action);
  checkDreams(params, next);
  return validateSimulation(params, next);
}

export function acknowledgeDreamPresentation(params, run, id) {
  validateSimulation(params, run);
  const next = clone(run);
  markDreamPresentationSeen(next, id);
  if (next.state === "RESULT") next.runSummary = buildRunSummary(next);
  return validateSimulation(params, next);
}

export function recordAchievementEvent(params, run, evidenceId, evidence) {
  validateSimulation(params, run);
  if (!["RUNNING", "PAUSED"].includes(run.state) || run.pendingDecision) fail("achievement event state");
  const next = clone(run);
  appendAchievementEvidence(next, evidenceId, evidence);
  checkDreams(params, next);
  return validateSimulation(params, next);
}

export function endActivity(params, run) {
  validateSimulation(params, run);
  if (!["RUNNING", "PAUSED"].includes(run.state) || run.pendingDecision) fail("final ending state");
  const next = clone(run);
  finishActivity(params, next);
  return validateSimulation(params, next);
}

export function completeEpilogue(params, run) {
  validateSimulation(params, run);
  if (run.state !== "EPILOGUE") return run;
  const next = clone(run);
  next.state = "RESULT"; next.runSummary = buildRunSummary(next);
  return validateSimulation(params, next);
}

export function stopObservation(params, run) {
  validateSimulation(params, run);
  if (!["RUNNING", "PAUSED"].includes(run.state) || run.pendingDecision) fail("observation state");
  const next = clone(run);
  checkDreams(params, next);
  next.state = "RESULT"; next.lifeSnapshot = createLifeSnapshot(next, "observation-stop");
  next.runSummary = buildRunSummary(next);
  return validateSimulation(params, next);
}

export function rebirth(params, run, { dreamAction = "hold" } = {}) {
  validateSimulation(params, run);
  if (!["RUNNING", "PAUSED"].includes(run.state) || run.pendingDecision || !["hold", "retarget"].includes(dreamAction)) fail("rebirth state");
  const next = clone(run), old = next.channels[0];
  checkDreams(params, next);
  old.status = "retired"; old.endDate = next.calendar.currentDate;
  old.streamNewSubscribers = next.activity.streamNewSubscribers;
  if (next.weekProgress.endDate > next.weekProgress.observedStartDate || next.weekProgress.G || next.weekProgress.U)
    next.channelWeekSegments.push(clone(next.weekProgress));
  next.channels.unshift({ id: `channel-${next.channels.length + 1}`, personId: "person-1", subscribers: 0,
    status: "active", startDate: next.calendar.currentDate, endDate: null, streamNewSubscribers: 0 });
  next.activity = { productionHours: 0, streamHours: 0, regularViewers: 0, streamNewSubscribers: 0,
    projectStartDate: next.calendar.currentDate };
  next.weekProgress = weekAt(next);
  carryDreams(next, old.id, dreamAction);
  next.events.push({ id: `rebirth-${next.channels[0].id}`, kind: "rebirth", date: next.calendar.currentDate,
    channelId: next.channels[0].id, previousChannelId: old.id, dreamAction, disclosure: "private" });
  return validateSimulation(params, next);
}

export function loadSimulation(params, text) {
  const result = loadSave(text, SIM_VERSIONS);
  if (!result.ok) return result;
  try { return { ok: true, run: validateSimulation(params, result.save) }; }
  catch (error) { return { ok: false, error: error.message }; }
}
