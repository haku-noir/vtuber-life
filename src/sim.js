import { ABILITY_AXES, BALANCE_VERSION, getSimBalance, validateParams } from "./params.js";
import { addDays, advanceCalendar, dayNumber, daysBetween } from "./calendar.js";
import { createSave, SAVE_VERSIONS, validateSave, serializeSave, loadSave } from "./save.js";
import { beginMonth, finishMonth } from "./economy.js";
import { advanceActivityDay } from "./activity.js";

export const SIM_VERSIONS = Object.freeze({ ...SAVE_VERSIONS,
  simulationVersion: "sim-0.2.0", balanceVersion: BALANCE_VERSION });
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
    endDate: run.calendar.currentDate, channelId: "channel-1", subscribersStart: run.channels[0].subscribers,
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
  run.channels = [{ id: "channel-1", personId: "person-1", subscribers: 0, status: "active" }];
  run.abilities = clone(personTemplate.abilities);
  run.debutAbilities = clone(personTemplate.abilities);
  run.fatigue = 0;
  run.activity = { productionHours: 0, streamHours: 0, regularViewers: 0, streamNewSubscribers: 0,
    projectStartDate: run.calendar.startDate };
  run.releases = [];
  run.economy = { month: null, summaries: [], unmetLivingYen: 0, reservedProductionYen: 0 };
  run.weekProgress = weekAt(run);
  run.lifeSnapshot = null;
  return validateSimulation(params, run);
}

export function validateSimulation(params, run) {
  const balance = getSimBalance(params);
  validateSave(run, SIM_VERSIONS);
  checkInitial(run.personTemplate, run.policy, balance);
  if (run.channels.length !== 1 || run.channels[0].id !== "channel-1" || run.channels[0].status !== "active") fail("channel");
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
  let contributed = run.activity.streamNewSubscribers;
  for (let i = 0; i < run.releases.length; i++) {
    const release = run.releases[i], work = run.works[i];
    if (typeof release.id !== "string" || releases.has(release.id) || release.workId !== work.id ||
        release.releaseDate !== work.releaseDate || !Object.hasOwn(balance.formats, work.format) ||
        !finite(work.quality, 1) || release.views !== work.views || release.newSubscribers !== work.newSubscribers ||
        !money(release.weekViews) || !money(release.weekIndex)) fail("release record");
    releases.add(release.id); contributed += release.newSubscribers;
  }
  let subscribers = 0, acquired = 0;
  const weeks = [...run.weeklySnapshots, ...(run.weekProgress ? [run.weekProgress] : [])];
  for (const week of weeks) {
    if (week.subscribersStart !== subscribers || week.S !== subscribers + week.G - week.U ||
        !money(week.videoViewsThisWeek)) fail("weekly conservation");
    subscribers = week.S; acquired += week.G;
  }
  if (run.weeklySnapshots.length !== run.calendar.weekIndex || subscribers !== run.channels[0].subscribers ||
      acquired !== contributed) fail("audience totals");
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
  if (finished !== (run.state === "RESULT") || (finished && (run.weekProgress !== null ||
      run.lifeSnapshot?.reason !== "observation-limit" || run.lifeSnapshot?.activityStatus !== "continuing"))) fail("end state");
  if (!finished && run.weekProgress === null) fail("missing partial week");
  return run;
}

function advanceDraft(run, balance, eventDates) {
  const step = advanceCalendar(run.calendar, eventDates);
  for (let date = run.calendar.currentDate; date < step.calendar.currentDate; date = addDays(date, 1)) {
    beginMonth(run, date, balance);
    advanceActivityDay(run, date, balance);
  }
  run.weekProgress.endDate = step.calendar.currentDate;
  // Income for the closing month is booked before the week's snapshot. A month
  // beginning at the end cursor is opened only when its first day is simulated.
  if (step.boundary.kinds.includes("month") || step.boundary.kinds.includes("end")) finishMonth(run, balance);
  run.calendar = step.calendar;
  if (step.completedWeek) {
    run.weekProgress.partial = step.completedWeek.partial;
    run.weeklySnapshots.push(run.weekProgress);
    run.weekProgress = run.calendar.currentDate === run.calendar.endDate ? null : weekAt(run);
  }
  if (step.boundary.kinds.includes("end")) {
    run.state = "RESULT";
    run.lifeSnapshot = { date: run.calendar.endDate, reason: "observation-limit", activityStatus: "continuing",
      balanceYen: run.ledger.balanceYen, unmetLivingYen: run.economy.unmetLivingYen,
      workCount: run.works.length, subscribers: run.channels[0].subscribers };
  }
}

export function advanceToBoundary(params, run, eventDates = []) {
  validateSimulation(params, run);
  if (run.state !== "RUNNING" || run.pendingDecision) return run;
  const next = clone(run);
  advanceDraft(next, getSimBalance(params), eventDates);
  return validateSimulation(params, next);
}

// Batch execution uses exactly the same boundary procedure, without UI clocks or
// speculative output. Budget exhaustion returns a resumable committed boundary.
export function runToEnd(params, run, maxBoundaries = Number.MAX_SAFE_INTEGER) {
  validateSimulation(params, run);
  if (!Number.isSafeInteger(maxBoundaries) || maxBoundaries < 0) fail("boundary budget");
  if (run.state !== "RUNNING" || run.pendingDecision || !maxBoundaries) return run;
  const next = clone(run), balance = getSimBalance(params);
  for (let i = 0; i < maxBoundaries && next.state === "RUNNING" && !next.pendingDecision; i++)
    advanceDraft(next, balance, []);
  return validateSimulation(params, next);
}

export function setPaused(params, run, paused) {
  validateSimulation(params, run);
  if (typeof paused !== "boolean") fail("pause flag");
  if (!["RUNNING", "PAUSED"].includes(run.state)) return run;
  return { ...run, state: paused ? "PAUSED" : run.pendingDecision ? "CHOICE" : "RUNNING" };
}

export function serializeSimulation(params, run) {
  validateSimulation(params, run);
  return serializeSave(run, SIM_VERSIONS);
}

export function loadSimulation(params, text) {
  const result = loadSave(text, SIM_VERSIONS);
  if (!result.ok) return result;
  try { return { ok: true, run: validateSimulation(params, result.save) }; }
  catch (error) { return { ok: false, error: error.message }; }
}
