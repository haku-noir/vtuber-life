import { createRng } from "./rng.js";
import { finishActivity } from "./epilogue.js";
import { getCandidates, getFamilyEventRules, getHeavyEventRules, getSimBalance, RECURRENT_HEAVY_EVENT_IDS } from "./params.js";
import { addMonths } from "./calendar.js";
import { advanceFamilyDates, advanceRelationshipWeek, applyFamilyChoice, birthRoleWording,
  familyEligible, recordHousehold } from "./household.js";

export const HEAVY_EVENT_IDS = Object.freeze(["EV14", "EV25", "EV86", "EV87", "EV88", "EV95"]);
export const SUPPORT_CARD = Object.freeze({ title: "支援の案内",
  text: "つらいときは、信頼できる人や地域の相談窓口、医療機関に相談できます。休んだり、画面を閉じたりしてかまいません。応援や対応を続ける必要はありません。" });
const fail = message => { throw new TypeError(`Invalid event state: ${message}`); };
const definition = (params, id) => getCandidates(params, "events").find(row => row.id === id);
const familyIds = ["EV93", "EV94", "EV95", "EV96"];

export function eventWeight(params, id, run) {
  const row = definition(params, id);
  if (!row) fail("unknown event");
  const r = getFamilyEventRules(params);
  if (id === "EV93") return r.ev93.chance * (run.household.children.length >= r.ev93.childThreshold ? r.ev93.childMultiplier : 1);
  if (id === "EV94") return r.ev94.chance;
  if (id === "EV95") return r.ev95.chance;
  if (id === "EV96") return 1;
  if (RECURRENT_HEAVY_EVENT_IDS.includes(id)) return getHeavyEventRules(params)[id].chance;
  return row.weight.value; // null remains unresolved, never zero or an invented default.
}

function recurrenceReady(params, run, eventId) {
  if (!RECURRENT_HEAVY_EVENT_IDS.includes(eventId)) return true;
  const { intervalMonths } = getHeavyEventRules(params)[eventId];
  return !run.events.some(record => record.kind === "catalog" && record.eventId === eventId &&
    run.calendar.currentDate < addMonths(record.date, intervalMonths));
}

export function createEventState(params, run) {
  return { lastMonth: run.calendar.startDate.slice(0, 7), lastWeek: -1, queue: [],
    unresolvedWeights: getCandidates(params, "events").filter(row => !familyIds.includes(row.id) && row.weight.value === null).map(row => row.id),
    graduationRequested: false };
}

function optionsFor(params, run, eventId, role) {
  const r = getFamilyEventRules(params);
  let labels = r.choices[eventId];
  if (eventId === "EV93") labels = labels.map((label, i) => i === 0 ? `${label}（${birthRoleWording(role)}）` : label);
  if (eventId === "EV96") labels = labels.map(label => `${label}（${birthRoleWording(run.household.birthRole)}）`);
  if (!labels && HEAVY_EVENT_IDS.includes(eventId)) {
    const text = definition(params, eventId).conditionsAndBehavior;
    const list = /対処（([^）]+)）/u.exec(text)?.[1] ?? /。([^。]+)を選べる/u.exec(text)?.[1];
    labels = list ? list.split("・") : ["休む", "相談する"];
  }
  if (eventId === "EV26") labels = ["元のペースに戻る", "少ない頻度で続ける"];
  if (eventId === "EV27") labels = ["活動を続ける", "家庭を優先して活動を終える"];
  if (!labels || labels.length < 2) fail("unimplemented choice definition");
  return labels.map((label, index) => ({ id: `option-${index + 1}`, label }));
}

function eligible(params, run, eventId, relationshipId) {
  if (familyIds.includes(eventId)) return familyEligible(params, run, eventId, relationshipId);
  if (eventId === "EV26") return run.household.leave?.reason === "health";
  if (eventId === "EV27") return run.eventState.graduationRequested;
  return HEAVY_EVENT_IDS.includes(eventId) && run.channels[0].status === "active";
}

// Explicit event entry also supports scripted situations. It does not assign a
// random weight to catalog entries whose balancing data is still unresolved.
export function offerEvent(params, run, eventId, relationshipId = null) {
  if (run.pendingDecision || run.state !== "RUNNING") fail("run must be running");
  const row = definition(params, eventId);
  if (!row || !eligible(params, run, eventId, relationshipId) || !recurrenceReady(params, run, eventId)) fail("ineligible event");
  const count = run.events.filter(event => event.eventId === eventId && event.kind === "catalog").length;
  const id = `event-${eventId}-${count + 1}`;
  const record = { id, eventId, kind: "catalog", date: run.calendar.currentDate, relationshipId,
    text: eventId === "EV95" ? "関係について話し合う時期を迎えた" : row.columns.名称 ?? row.columns.系列,
    disclosure: run.household.disclosure };
  if (HEAVY_EVENT_IDS.includes(eventId)) record.supportCard = { ...SUPPORT_CARD };
  run.events.push(record);
  if (eventId === "EV94") {
    run.household.relationships.find(relation => relation.id === relationshipId).warnings++;
    recordHousehold(run, eventId, record.text);
    return;
  }
  let birthRole = run.household.birthRole;
  if (eventId === "EV93" && birthRole === "not_applicable")
    birthRole = createRng(run.seed, "household", id, "birthRole").weighted(["self", "partner"], getFamilyEventRules(params).birthRoleWeights);
  run.pendingDecision = { id: `decision-${id}`, eventId, eventRecordId: id, date: record.date,
    relationshipId, birthRole, resumeStage: "events", options: optionsFor(params, run, eventId, birthRole),
    ...(record.supportCard ? { supportCard: { ...SUPPORT_CARD } } : {}) };
  run.stage = "events";
  run.state = "CHOICE";
}

export function drainEventQueue(params, run) {
  while (!run.pendingDecision && run.eventState.queue.length) {
    const candidate = run.eventState.queue.shift();
    if (eligible(params, run, candidate.eventId, candidate.relationshipId) && recurrenceReady(params, run, candidate.eventId))
      offerEvent(params, run, candidate.eventId, candidate.relationshipId);
  }
  if (!run.pendingDecision) run.stage = "boundary";
}

export function advanceEvents(params, run, { week = false, month = false } = {}) {
  if (run.pendingDecision || run.state !== "RUNNING") return;
  advanceFamilyDates(params, run);
  const h = run.household, state = run.eventState, date = run.calendar.currentDate;
  // Older saves can contain an undated health leave. Start its configured
  // waiting period at the first processed boundary without rewriting history.
  if (h.leave?.reason === "health" && h.leave.returnDate === null)
    h.leave.returnDate = addMonths(date, getSimBalance(params).healthLeave.months);
  if (week && state.lastWeek < run.calendar.weekIndex - 1) {
    const index = run.calendar.weekIndex - 1;
    const response = h.weeklyResponse;
    for (const relation of h.relationships) {
      advanceRelationshipWeek(params, relation, { ...h.weekLoad, together: response === "together" ||
        h.weekLoad.privateHours >= getFamilyEventRules(params).strain.privateHours,
        discussion: response === "discussion", rest: !!h.leave });
      if (familyEligible(params, run, "EV94", relation.id) &&
          createRng(run.seed, "household", "EV94", index, relation.id).next() < eventWeight(params, "EV94", run))
        offerEvent(params, run, "EV94", relation.id);
    }
    state.lastWeek = index; h.weeklyResponse = null;
    h.weekLoad = { days: 0, activityHours: 0, privateHours: 0 };
  }
  const candidates = [];
  if (month && state.lastMonth !== date.slice(0, 7)) {
    const key = date.slice(0, 7);
    for (const row of getCandidates(params, "events")) {
      if (row.id === "EV94" || row.id === "EV96") continue;
      const targets = row.id === "EV95" ? h.relationships.map(relation => relation.id) : [null];
      for (const relationshipId of targets) {
        if (!eligible(params, run, row.id, relationshipId) || !recurrenceReady(params, run, row.id)) continue;
        const weight = eventWeight(params, row.id, run);
        if (weight === null) continue;
        if (weight < 0 || weight > 1 || !Number.isFinite(weight)) fail("monthly probability");
        if (createRng(run.seed, "world", row.id, key, relationshipId ?? "channel").next() < weight)
          candidates.push({ eventId: row.id, relationshipId, weight });
      }
    }
    // Stable weighted ordering resolves simultaneous candidates without losing
    // an event behind a pending choice. No reroll occurs after answering.
    const rng = createRng(run.seed, "world", "event-order", key);
    while (candidates.length) {
      const picked = rng.weighted(candidates, candidates.map(row => row.weight));
      state.queue.push({ eventId: picked.eventId, relationshipId: picked.relationshipId });
      candidates.splice(candidates.indexOf(picked), 1);
    }
    state.lastMonth = key;
  }
  if (h.leave?.reason === "childcare" && h.leave.returnDate <= date &&
      !state.queue.some(row => row.eventId === "EV96")) state.queue.unshift({ eventId: "EV96", relationshipId: null });
  // Only the queue needs checking: the entry guard skips pending decisions,
  // and answering EV26 clears health leave before events can advance again.
  if (h.leave?.reason === "health" && h.leave.returnDate <= date &&
      !state.queue.some(row => row.eventId === "EV26")) state.queue.unshift({ eventId: "EV26", relationshipId: null });
  drainEventQueue(params, run);
}

export function resolveEventChoice(params, run, decisionId, optionId) {
  const previous = run.choiceHistory.find(row => row.decisionId === decisionId);
  if (previous) {
    if (previous.optionId !== optionId) fail("conflicting answer replay");
    return false;
  }
  const pending = run.pendingDecision;
  if (!pending || pending.id !== decisionId) fail("unknown decision");
  if (!pending.eventId) fail("decision belongs to another subsystem");
  const index = pending.options.findIndex(row => row.id === optionId);
  if (index < 0) fail("unknown option");
  if (familyIds.includes(pending.eventId)) applyFamilyChoice(params, run, pending, index);
  else if (pending.eventId === "EV26") {
    run.household.leave = null;
    run.household.activityScale = index ? 1 - getFamilyEventRules(params).ev96.reduction[0] / 100 : 1;
  } else if (pending.eventId === "EV27") {
    run.eventState.graduationRequested = false;
    if (index === 1) finishActivity(params, run);
  } else if (HEAVY_EVENT_IDS.includes(pending.eventId)) {
    const label = pending.options[index].label;
    if (/休む|休止/u.test(label) && run.household.leave?.reason !== "childcare")
      run.household.leave = { reason: "health",
        returnDate: addMonths(run.calendar.currentDate, getSimBalance(params).healthLeave.months) };
    if (/予定を減らす/u.test(label)) run.household.activityScale = 1 - getFamilyEventRules(params).ev96.reduction[0] / 100;
  }
  run.choiceHistory.push({ decisionId, optionId, date: pending.date, eventId: pending.eventId });
  run.appliedEffectIds.push(`${decisionId}-${optionId}`);
  run.pendingDecision = null;
  if (run.state !== "EPILOGUE") run.state = "RUNNING";
  if (pending.eventId === "EV96" && index === 3) run.eventState.queue.unshift({ eventId: "EV27", relationshipId: null });
  if (run.state === "RUNNING") drainEventQueue(params, run);
  else { run.eventState.queue = []; run.stage = "boundary"; }
  return true;
}

export function validateEventState(params, run) {
  const s = run.eventState;
  if (!s || !Number.isSafeInteger(s.lastWeek) || s.lastWeek < -1 || s.lastWeek >= run.calendar.weekIndex ||
      !/^\d{4}-\d{2}$/.test(s.lastMonth) || s.lastMonth > run.calendar.currentDate.slice(0, 7) ||
      !Array.isArray(s.queue) || !Array.isArray(s.unresolvedWeights) || typeof s.graduationRequested !== "boolean") fail("cursor");
  const expected = createEventState(params, run).unresolvedWeights;
  // These five entries were previously unresolved. Accept that exact historical
  // diagnostic list without adding save fields or changing the saved history.
  const legacy = getCandidates(params, "events").filter(row => !familyIds.includes(row.id) &&
    (row.weight.value === null || RECURRENT_HEAVY_EVENT_IDS.includes(row.id))).map(row => row.id);
  if (![expected, legacy].some(list => JSON.stringify(list) === JSON.stringify(s.unresolvedWeights))) fail("unresolved weights");
  for (const row of s.queue) if (!definition(params, row.eventId) ||
      (row.relationshipId !== null && !run.household.relationships.some(relation => relation.id === row.relationshipId))) fail("queued event");
  for (const record of run.events.filter(row => row.kind === "catalog")) {
    if (!definition(params, record.eventId)) fail("event definition");
    if (HEAVY_EVENT_IDS.includes(record.eventId) && JSON.stringify(record.supportCard) !== JSON.stringify(SUPPORT_CARD)) fail("support card");
  }
  for (const record of run.events.filter(row => row.kind === "achievement-evidence")) validateAchievementEvidence(record.evidence);
  for (const choice of run.choiceHistory) {
    const record = run.events.find(row => `decision-${row.id}` === choice.decisionId && row.kind === "catalog");
    if (!record || record.eventId !== choice.eventId || record.date !== choice.date ||
        !run.appliedEffectIds.includes(`${choice.decisionId}-${choice.optionId}`)) fail("unapplied answer");
  }
  if (run.appliedEffectIds.length !== run.choiceHistory.length) fail("effect count");
  const pending = run.pendingDecision;
  if (pending) {
    // The base save contract also permits decisions owned by other subsystems
    // (including the existing UI pause fixture). They remain stopped here.
    if (pending.eventId === undefined && !pending.id.startsWith("decision-event-") && pending.resumeStage !== "events") return;
    const record = run.events.find(row => row.id === pending.eventRecordId);
    if (!record || pending.id !== `decision-${record.id}` || record.eventId !== pending.eventId ||
        record.date !== pending.date || record.relationshipId !== pending.relationshipId ||
        !["self", "partner", "not_applicable"].includes(pending.birthRole) ||
        (pending.eventId === "EV93" && pending.birthRole === "not_applicable") ||
        !eligible(params, run, pending.eventId, pending.relationshipId) || pending.resumeStage !== "events" || run.stage !== "events" ||
        JSON.stringify(pending.options) !== JSON.stringify(optionsFor(params, run, pending.eventId, pending.birthRole))) fail("pending payload");
    if (HEAVY_EVENT_IDS.includes(pending.eventId) && JSON.stringify(pending.supportCard) !== JSON.stringify(SUPPORT_CARD)) fail("pending support");
  }
}

function validateAchievementEvidence(e) {
  if (!e || !["concert", "op", "game"].includes(e.type) ||
      !["announced", "postponed", "cancelled", "held", "released"].includes(e.status)) fail("achievement evidence");
  if (e.type === "concert" && (!Number.isSafeInteger(e.localAudience) || e.localAudience < 0 ||
      !["solo", "unit-lead", "guest"].includes(e.role) || !Array.isArray(e.venueAttributes) ||
      e.venueAttributes.some(value => !["arena", "symbolic", "dome"].includes(value)) || typeof e.allOriginal !== "boolean")) fail("concert evidence");
  if (e.type === "op" && (![e.official, e.singingCredit, e.cover].every(value => typeof value === "boolean") ||
      !["OP", "ED", "insert", "game-theme"].includes(e.usage))) fail("OP evidence");
  if (e.type === "game" && ![e.licensed, e.centralIP, e.complete, e.publiclyPlayable].every(value => typeof value === "boolean")) fail("game evidence");
}

// Called by a completed project/scripted event, never by choosing a dream.
export function appendAchievementEvidence(run, evidenceId, evidence) {
  validateAchievementEvidence(evidence);
  if (typeof evidenceId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(evidenceId)) fail("evidence ID");
  const previous = run.events.find(row => row.id === evidenceId);
  if (previous) {
    if (previous.kind !== "achievement-evidence" || JSON.stringify(previous.evidence) !== JSON.stringify(evidence)) fail("conflicting evidence replay");
    return;
  }
  run.events.push({ id: evidenceId, kind: "achievement-evidence", date: run.calendar.currentDate,
    evidence: structuredClone(evidence) });
}
