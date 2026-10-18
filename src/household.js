import { addMonths, dayNumber } from "./calendar.js";
import { getFamilyEventRules } from "./params.js";
import { createRng } from "./rng.js";

const clamp = value => Math.max(0, Math.min(100, value));
const fail = message => { throw new TypeError(`Invalid household: ${message}`); };
export const birthRoleWording = role => role === "self" ? "妊娠・出産のための休止と育児休業"
  : role === "partner" ? "パートナーの出産に合わせた育児休業" : "家族を迎えるための休業";

export function createHouseholdState(template = {}) {
  const partner = template.partner;
  return { maritalStatus: template.maritalStatus ?? "single", partnerId: partner?.id ?? null,
    relationships: partner ? [{ id: partner.id, kind: "partner", status: "active", quality: partner.relationship,
      strain: 0, overworkWeeks: 0, neglectedWeeks: 0, warnings: 0 }] : [],
    children: structuredClone(template.children ?? []), partnerShare: template.partnerShare ?? 0,
    childcareHoursPerWeek: template.childcareHoursPerWeek ?? 0, birthRole: template.birthRole ?? "not_applicable",
    disclosure: template.disclosure ?? "private", ev93Count: 0, nextFamilyDate: null, pendingBirth: null,
    leave: null, activityScale: 1, activityTimeBands: [], records: [],
    weekLoad: { days: 0, activityHours: 0, privateHours: 0 }, weeklyResponse: null };
}

function ageAt(initialAge, start, date) {
  let years = Number(date.slice(0, 4)) - Number(start.slice(0, 4));
  if (addMonths(start, years * 12) > date) years--;
  return initialAge + years;
}

export function familyEligible(params, run, eventId, relationshipId = null) {
  const h = run.household, r = getFamilyEventRules(params), date = run.calendar.currentDate;
  const relation = h.relationships.find(row => row.id === relationshipId && row.status !== "ended");
  if (eventId === "EV93") {
    const partner = h.relationships.find(row => row.id === h.partnerId && row.status === "active");
    const age = ageAt(run.personTemplate.age, run.calendar.startDate, date);
    return ["married", "partnered"].includes(h.maritalStatus) && !!partner && partner.quality >= r.ev93.quality &&
      age >= r.ev93.minAge && age <= r.ev93.maxAge && h.children.length <= r.ev93.maxChildren &&
      h.ev93Count < r.ev93.maxCount && !h.pendingBirth && !h.leave && (!h.nextFamilyDate || date >= h.nextFamilyDate);
  }
  if (eventId === "EV94") return !!relation && relation.strain >= r.ev94.threshold;
  if (eventId === "EV95") return !!relation && relation.strain >= r.ev95.threshold && relation.warnings >= r.ev95.warnings;
  if (eventId === "EV96") return h.leave?.reason === "childcare";
  return false;
}

// Receives actual weekly load, independently of renderer speed or extra boundaries.
export function advanceRelationshipWeek(params, relation, load) {
  const r = getFamilyEventRules(params).strain, c = r.changes;
  if (relation.status === "ended") return relation;
  for (const key of ["activityHours", "privateHours"])
    if (!Number.isFinite(load[key]) || load[key] < 0) fail("weekly load");
  relation.overworkWeeks = load.activityHours > r.activity ? relation.overworkWeeks + 1 : 0;
  relation.neglectedWeeks = load.together ? 0 : relation.neglectedWeeks + 1;
  relation.strain = clamp(relation.strain + (relation.overworkWeeks ? c[0] : 0) +
    (relation.overworkWeeks >= r.consecutive ? c[1] : 0) + (load.privateHours < r.privateHours ? c[2] : 0) +
    (relation.neglectedWeeks >= r.neglect ? c[3] : 0) + (load.cancelled ? c[4] : 0) +
    (load.together ? c[5] : 0) + (load.discussion ? c[6] : 0) + (load.rest ? c[7] : 0));
  return relation;
}

export function recordHousehold(run, eventId, outcome, optionId = null) {
  const h = run.household;
  h.records.push({ date: run.calendar.currentDate, eventId, outcome, optionId, disclosure: h.disclosure,
    maritalStatus: h.maritalStatus, children: h.children.length });
}

export function refreshChildcare(params, run) {
  const h = run.household, r = getFamilyEventRules(params);
  const loads = h.children.map(child => {
    const age = ageAt(child.relativeAge, child.bornDate ?? run.calendar.startDate, run.calendar.currentDate);
    return r.careBands.find(([min, max]) => age >= min && age <= max)?.[2] ?? 0;
  }).sort((a, b) => b - a);
  h.childcareHoursPerWeek = loads.reduce((sum, hours, i) => sum + hours * (i ? r.siblingFactor : 1), 0) * (1 - h.partnerShare);
  h.activityTimeBands = h.children.length ? ["子の就寝後", "早朝", "平日日中"] : [];
}

export function advanceFamilyDates(params, run) {
  const h = run.household, pending = h.pendingBirth, date = run.calendar.currentDate;
  if (pending && date >= pending.date) {
    const child = { id: `child-${h.children.length + 1}`, relativeAge: 0, bornDate: date };
    h.children.push(child);
    if (!run.persons.some(row => row.id === child.id)) run.persons.push({ id: child.id });
    h.activityScale = 1 - pending.reduction / 100;
    h.leave = pending.leaveMonths ? { reason: "childcare", returnDate: addMonths(date, pending.leaveMonths) } : null;
    h.pendingBirth = null;
    recordHousehold(run, "EV93", "家族が増えた", pending.optionId);
    run.events.push({ id: `family-birth-${child.id}`, kind: "household", date, eventId: "EV93", text: "家族が増えた",
      disclosure: h.disclosure });
  }
  refreshChildcare(params, run);
}

export function applyFamilyChoice(params, run, pending, optionIndex) {
  const h = run.household, r = getFamilyEventRules(params), date = run.calendar.currentDate;
  const rng = createRng(run.seed, "household", pending.id, "outcome");
  const optionId = pending.options[optionIndex].id;
  if (pending.eventId === "EV93") {
    const relation = h.relationships.find(row => row.id === h.partnerId);
    relation.quality = clamp(relation.quality + rng.fork("quality").int(...r.ev93.qualityChanges[optionIndex]));
    h.ev93Count++;
    h.nextFamilyDate = addMonths(date, optionIndex === 3 ? rng.fork("defer").int(...r.ev93.defer) : r.ev93.cooldown);
    if (optionIndex === 0 || optionIndex === 2) {
      h.birthRole = pending.birthRole;
      const leave = optionIndex === 2 ? r.ev93.shortLeave : h.birthRole === "self" ? r.ev93.selfLeave : r.ev93.partnerLeave;
      h.pendingBirth = { date: addMonths(date, rng.fork("birth-delay").int(...r.ev93.birthDelay)), optionId,
        leaveMonths: rng.fork("leave").int(...leave), reduction: rng.fork("reduction").int(...r.ev93.reductions[optionIndex === 0 ? 0 : 1]) };
    }
    recordHousehold(run, pending.eventId, pending.options[optionIndex].label, optionId);
    advanceFamilyDates(params, run);
  } else if (pending.eventId === "EV95") {
    const relation = h.relationships.find(row => row.id === pending.relationshipId);
    // P-21 supplies low/high-strain endpoints. Quality contributes to the position
    // between them without changing the endpoint probabilities.
    const severity = Math.max(0, Math.min(1, (relation.strain - r.ev95.threshold) / (100 - r.ev95.threshold)));
    const t = severity * (1 - relation.quality / 100);
    const outcome = optionIndex === 2 ? (relation.kind === "friend" ? "distant" : "separated") :
      rng.weighted(["continued", "distant", "separated"], r.ev95.probabilities[optionIndex].map(([a, b]) => a + (b - a) * t));
    const resolved = relation.kind === "friend" && outcome === "separated" ? "distant" : outcome;
    relation.warnings = 0;
    if (optionIndex === 0) {
      relation.strain = clamp(relation.strain + r.strain.changes[6]);
      h.activityScale = Math.min(h.activityScale, 1 - r.ev96.reduction[0] / 100);
    }
    if (resolved === "separated") {
      relation.status = "ended"; h.maritalStatus = "single"; h.partnerId = null; h.partnerShare = 0;
    } else relation.status = resolved === "distant" ? "distant" : "active";
    recordHousehold(run, pending.eventId, resolved, optionId);
    refreshChildcare(params, run);
  } else if (pending.eventId === "EV96") {
    if (optionIndex === 2) h.leave.returnDate = addMonths(date, rng.int(...r.ev96.extension));
    else if (optionIndex === 3) run.eventState.graduationRequested = true;
    else { h.leave = null; h.activityScale = optionIndex === 0 ? 1 : 1 - rng.int(...r.ev96.reduction) / 100; }
    recordHousehold(run, pending.eventId, pending.options[optionIndex].label, optionId);
  }
}

export function validateHousehold(run) {
  const h = run.household;
  if (!h || !["single", "dating", "married", "partnered"].includes(h.maritalStatus) ||
      !["self", "partner", "not_applicable"].includes(h.birthRole) || !["private", "partial", "public"].includes(h.disclosure) ||
      !Array.isArray(h.relationships) || !Array.isArray(h.children) || !Array.isArray(h.records)) fail("state");
  const unit = value => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
  if (!unit(h.partnerShare) || !unit(h.activityScale) || !Number.isFinite(h.childcareHoursPerWeek) || h.childcareHoursPerWeek < 0 ||
      !Number.isSafeInteger(h.ev93Count) || h.ev93Count < 0) fail("load/count");
  const ids = new Set();
  for (const row of h.relationships) {
    if (typeof row.id !== "string" || ids.has(row.id) || !["partner", "friend"].includes(row.kind) ||
        !["active", "distant", "ended"].includes(row.status) || typeof row.quality !== "number" || typeof row.strain !== "number" ||
        !unit(row.quality / 100) || !unit(row.strain / 100)) fail("relationship");
    for (const key of ["overworkWeeks", "neglectedWeeks", "warnings"])
      if (!Number.isSafeInteger(row[key]) || row[key] < 0) fail("relationship counters");
    ids.add(row.id);
  }
  if (h.partnerId !== null && !h.relationships.some(row => row.id === h.partnerId && row.kind === "partner" && row.status !== "ended")) fail("partner");
  if ((h.maritalStatus === "single") !== (h.partnerId === null)) fail("marital status");
  for (const child of h.children) {
    if (typeof child.id !== "string" || ids.has(child.id) || !Number.isSafeInteger(child.relativeAge) || child.relativeAge < 0) fail("child");
    ids.add(child.id);
    if (child.bornDate) { dayNumber(child.bornDate); if (child.bornDate > run.calendar.currentDate) fail("future child"); }
  }
  if (h.nextFamilyDate !== null) dayNumber(h.nextFamilyDate);
  if (h.pendingBirth !== null) {
    dayNumber(h.pendingBirth.date);
    if (h.pendingBirth.date < run.calendar.currentDate || !Number.isSafeInteger(h.pendingBirth.leaveMonths) ||
        h.pendingBirth.leaveMonths < 0 || !unit(h.pendingBirth.reduction / 100)) fail("pending birth");
  }
  if (h.leave !== null) {
    if (!["childcare", "health"].includes(h.leave.reason)) fail("leave reason");
    if (h.leave.returnDate !== null) dayNumber(h.leave.returnDate);
  }
  for (const row of h.records) { dayNumber(row.date); if (row.date > run.calendar.currentDate) fail("future record"); }
  if (!h.weekLoad || !["days", "activityHours", "privateHours"].every(key => Number.isFinite(h.weekLoad[key]) && h.weekLoad[key] >= 0) ||
      h.weekLoad.days > 7 || ![null, "together", "discussion", "unchanged"].includes(h.weeklyResponse)) fail("weekly load");
  return h;
}
