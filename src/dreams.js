import { getCandidates } from "./params.js";
import { dayNumber } from "./calendar.js";

export const DREAM_RULE_VERSION = "dream-1";
const fail = message => { throw new TypeError(`Invalid dream: ${message}`); };
const states = ["ACTIVE", "ON_HOLD", "ACHIEVED", "RETIRED", "ENDED_UNFULFILLED"];
const count = n => Number.isSafeInteger(n) && n >= 0;

// P-05 is prose-valued. Read thresholds from that source, never from display rounding.
export function dreamCatalog(params) {
  return getCandidates(params, "dreams").filter(row => row.sourceSection === "27.1").map(row => {
    const text = row.columns["達成と認める出来事"];
    const numeric = /(?:登録者|原曲|オリジナル曲)/u.test(row.columns.夢);
    const threshold = numeric ? Number(text.match(/[\d,]+(?=人|回)/u)?.[0].replaceAll(",", "")) : null;
    if (numeric && (!count(threshold) || !threshold)) fail("P-05 threshold");
    return { id: row.id, label: row.id === "D03" ? "象徴的な会場でライブを開く" : row.columns.夢,
      threshold, kind: /^D0[1-4]$/.test(row.id) ? "concert" : row.id === "D05" ? "op"
        : /^D0[6-8]$/.test(row.id) ? "subscribers" : row.id === "D13" ? "game" : "music" };
  });
}

export function initializeDreams(params, run, initial = run.runSetupTemplate?.dream ?? null) {
  run.dreamState = { currentId: null, instances: [], achievements: [], presentations: [], disclosures: [] };
  if (initial) selectDream(params, run, typeof initial === "string" ? { definitionId: initial } : initial);
}

function ruleFor(params, run, selection) {
  const def = dreamCatalog(params).find(row => row.id === selection.definitionId);
  if (!def) fail("unknown or retired definition");
  const targetRule = selection.targetRule ?? (def.kind === "subscribers" ? "initial-channel" : "any-eligible");
  if (!["initial-channel", "current-channel", "any-eligible", "specific"].includes(targetRule)) fail("target rule");
  let targetId = selection.targetId ?? null;
  if (targetRule === "initial-channel") targetId = "channel-1";
  if (targetRule === "current-channel") targetId = run.channels[0].id;
  if (def.kind === "subscribers" && !run.channels.some(row => row.id === targetId)) fail("channel target");
  if (targetRule === "specific" && !targetId) fail("specific target");
  if (def.kind !== "subscribers" && ["initial-channel", "current-channel"].includes(targetRule)) fail("target kind");
  if (targetRule === "any-eligible") targetId = null;
  if (targetRule === "specific" && def.kind !== "subscribers" &&
      !(def.kind === "music" ? run.releases : run.events).some(row => row.id === targetId)) fail("missing target");
  const role = selection.role ?? "solo";
  if (!["solo", "unit-lead", "appearance"].includes(role)) fail("concert role");
  return { definitionId: def.id, targetRule, targetId, role, allOriginal: selection.allOriginal === true };
}

function transition(run, dream, state, reason) {
  dream.state = state;
  dream.history.push({ date: run.calendar.currentDate, state, reason });
}

export function selectDream(params, run, selection) {
  const s = run.dreamState;
  // Validate before touching a previously selected dream.
  const rule = selection === null ? null : ruleFor(params, run, selection);
  const previous = s.instances.find(row => row.id === s.currentId);
  if (previous && ["ACTIVE", "ON_HOLD"].includes(previous.state)) transition(run, previous, "RETIRED", "changed");
  s.currentId = null;
  if (!rule) return;
  const dream = { id: `dream-${s.instances.length + 1}`, ...rule, ruleVersion: DREAM_RULE_VERSION,
    setDate: run.calendar.currentDate, state: "ACTIVE", disclosure: "private", history: [],
    achievementId: null, achievedDate: null, alreadyAchieved: false };
  transition(run, dream, "ACTIVE", "selected");
  s.instances.push(dream); s.currentId = dream.id;
  const existing = s.achievements.find(row => matches(dream, row));
  if (existing) {
    dream.achievementId = existing.id; dream.achievedDate = existing.firstReachedDate; dream.alreadyAchieved = true;
    transition(run, dream, "ACHIEVED", "already-reached");
  }
}

export function setDreamStatus(run, state) {
  const dream = run.dreamState.instances.find(row => row.id === run.dreamState.currentId);
  if (!dream || !["ACTIVE", "ON_HOLD"].includes(dream.state) || !["ACTIVE", "ON_HOLD"].includes(state)) fail("transition");
  if (dream.state !== state) transition(run, dream, state, "player");
}

export function discloseDream(run) {
  const dream = run.dreamState.instances.find(row => row.id === run.dreamState.currentId);
  if (!dream) fail("no current dream");
  if (dream.disclosure === "public") return;
  dream.disclosure = "public";
  run.dreamState.disclosures.push({ dreamId: dream.id, date: run.calendar.currentDate });
}

function matches(dream, achievement) {
  return dream.definitionId === achievement.definitionId &&
    (dream.targetId === null || dream.targetId === achievement.targetId) &&
    (achievement.kind !== "concert" || ((dream.role === "appearance" || dream.role === achievement.role) &&
      (!dream.allOriginal || achievement.allOriginal)));
}

function candidates(run, def) {
  if (def.kind === "subscribers") return run.channels.filter(row => row.subscribers >= def.threshold)
    .map(row => ({ targetId: row.id, actual: row.subscribers, evidenceIds: [], role: null, allOriginal: false }));
  if (def.kind === "music") return run.releases.flatMap(release => {
    const work = run.works.find(row => row.id === release.workId);
    return work?.original === true && work.primarySinger === true && work.countingReleaseId === release.id &&
      release.official === true && release.fullLength === true && ["mv", "audio"].includes(release.kind) &&
      release.service === "primary-video" && release.releaseDate <= run.calendar.currentDate && release.views >= def.threshold
      ? [{ targetId: release.id, actual: release.views, evidenceIds: [work.id, release.id], role: null, allOriginal: false }] : [];
  });
  return run.events.filter(row => row.kind === "achievement-evidence" && row.evidence.type === def.kind).flatMap(row => {
    const e = row.evidence;
    let qualifies = false;
    if (def.kind === "concert") qualifies = e.status === "held" && e.localAudience > 0 &&
      (def.id === "D01" || e.venueAttributes.includes({ D02: "arena", D03: "symbolic", D04: "dome" }[def.id]));
    if (def.kind === "op") qualifies = e.status === "released" && e.official && e.usage === "OP" && e.singingCredit && !e.cover;
    if (def.kind === "game") qualifies = e.status === "released" && e.licensed && e.centralIP && e.complete && e.publiclyPlayable;
    return qualifies ? [{ targetId: row.id, actual: null, evidenceIds: [row.id], role: e.role ?? null,
      allOriginal: e.allOriginal === true }] : [];
  });
}

export function checkDreams(params, run) {
  const s = run.dreamState, added = [];
  const keys = new Set(s.achievements.map(row => row.key));
  for (const def of dreamCatalog(params)) for (const evidence of candidates(run, def)) {
    const key = JSON.stringify([run.runId, DREAM_RULE_VERSION, def.id, evidence.targetId, def.threshold, evidence.role, evidence.allOriginal]);
    if (keys.has(key)) continue;
    const row = { id: `achievement-${s.achievements.length + 1}`, key, ruleVersion: DREAM_RULE_VERSION,
      definitionId: def.id, kind: def.kind, threshold: def.threshold, ...evidence, firstReachedDate: run.calendar.currentDate };
    s.achievements.push(row); keys.add(key); added.push(row.id);
  }
  const dream = s.instances.find(row => row.id === s.currentId);
  const achievement = dream?.state === "ACTIVE" && s.achievements.find(row => matches(dream, row));
  const achievedDreamIds = [];
  if (achievement) {
    dream.achievementId = achievement.id; dream.achievedDate = achievement.firstReachedDate;
    transition(run, dream, "ACHIEVED", "reached"); achievedDreamIds.push(dream.id);
  }
  if (added.length || achievedDreamIds.length) s.presentations.push({ id: `presentation-${s.presentations.length + 1}`,
    date: run.calendar.currentDate, achievementIds: added, dreamIds: achievedDreamIds,
    // Private wishes are for the observer; public reactions only see published facts.
    publicDreamIds: achievedDreamIds.filter(id => s.instances.find(row => row.id === id).disclosure === "public"),
    recalledEventIds: run.events.filter(row => row.date <= run.calendar.currentDate).slice(-3).map(row => row.id), seen: false });
}

export function markDreamPresentationSeen(run, id) {
  const row = run.dreamState.presentations.find(row => row.id === id);
  if (!row) fail("presentation");
  row.seen = true;
}

export function closeDreams(run) {
  for (const dream of run.dreamState.instances) if (["ACTIVE", "ON_HOLD"].includes(dream.state))
    transition(run, dream, "ENDED_UNFULFILLED", "activity-ended");
}

export function carryDreams(run, oldChannelId, mode) {
  if (!["hold", "retarget"].includes(mode)) fail("rebirth dream choice");
  const dream = run.dreamState.instances.find(row => row.id === run.dreamState.currentId);
  if (!dream || dream.targetId !== oldChannelId) return;
  if (mode === "hold") {
    if (dream.state === "ACTIVE") transition(run, dream, "ON_HOLD", "rebirth");
  } else {
    // Preserve the old instance, especially its achieved evidence.
    if (["ACTIVE", "ON_HOLD"].includes(dream.state)) transition(run, dream, "RETIRED", "rebirth-retarget");
    const next = { ...structuredClone(dream), id: `dream-${run.dreamState.instances.length + 1}`,
      targetRule: "current-channel", targetId: run.channels[0].id, setDate: run.calendar.currentDate,
      disclosure: "private", history: [], achievementId: null, achievedDate: null, alreadyAchieved: false };
    transition(run, next, "ACTIVE", "rebirth-retarget");
    run.dreamState.instances.push(next); run.dreamState.currentId = next.id;
  }
}

// Explicit migration helper only; it does not pretend to load an unspecified old save schema.
export function migrateLegacyDreams(params, run) {
  initializeDreams(params, run, null);
  checkDreams(params, run);
  for (const row of run.dreamState.achievements) row.firstReachedDate = null;
  run.dreamState.presentations = [];
  return run;
}

export function validateDreams(params, run) {
  const s = run.dreamState, defs = dreamCatalog(params);
  if (!s || ![s.instances, s.achievements, s.presentations, s.disclosures].every(Array.isArray)) fail("collections");
  const unique = rows => new Set(rows.map(row => row.id)).size === rows.length;
  if (![s.instances, s.achievements, s.presentations].every(unique) ||
      new Set(s.achievements.map(row => row.key)).size !== s.achievements.length) fail("duplicate record");
  const date = value => { dayNumber(value); if (value < run.calendar.startDate || value > run.calendar.currentDate) fail("date"); };
  if (s.currentId !== null && !s.instances.some(row => row.id === s.currentId)) fail("current reference");
  for (const d of s.instances) {
    if (!defs.some(row => row.id === d.definitionId) || !states.includes(d.state) || d.ruleVersion !== DREAM_RULE_VERSION ||
        !["private", "public"].includes(d.disclosure) || !Array.isArray(d.history) || !d.history.length ||
        d.history.at(-1).state !== d.state) fail("instance");
    const rule = ruleFor(params, run, d);
    // current-channel describes the selection rule; its resolved target remains
    // the old channel when rebirth explicitly puts that instance on hold.
    if (d.targetRule !== "current-channel" && rule.targetId !== d.targetId) fail("resolved target");
    if (defs.find(row => row.id === d.definitionId).kind === "subscribers" &&
        !run.channels.some(row => row.id === d.targetId)) fail("saved channel target");
    date(d.setDate); d.history.forEach(row => { date(row.date); if (!states.includes(row.state)) fail("history"); });
    if (d.state === "ACHIEVED" && !s.achievements.some(row => row.id === d.achievementId && matches(d, row) && row.firstReachedDate === d.achievedDate)) fail("achievement reference");
  }
  const evidenceIds = new Set([...run.events, ...run.works, ...run.releases].map(row => row.id));
  for (const a of s.achievements) {
    const def = defs.find(row => row.id === a.definitionId);
    if (!def || a.kind !== def.kind || a.threshold !== def.threshold || a.ruleVersion !== DREAM_RULE_VERSION ||
        a.key !== JSON.stringify([run.runId, DREAM_RULE_VERSION, a.definitionId, a.targetId, a.threshold, a.role, a.allOriginal]) ||
        !Array.isArray(a.evidenceIds) || a.evidenceIds.some(id => !evidenceIds.has(id)) ||
        (def.threshold !== null && (!count(a.actual) || a.actual < def.threshold)) ||
        !(def.kind === "subscribers" ? run.channels.some(row => row.id === a.targetId) : evidenceIds.has(a.targetId))) fail("achievement");
    if (a.firstReachedDate !== null) date(a.firstReachedDate);
  }
  for (const p of s.presentations) {
    date(p.date);
    if (typeof p.seen !== "boolean" || ![p.achievementIds, p.dreamIds, p.publicDreamIds, p.recalledEventIds].every(Array.isArray) ||
        p.achievementIds.some(id => !s.achievements.some(row => row.id === id)) ||
        p.dreamIds.some(id => !s.instances.some(row => row.id === id)) ||
        p.publicDreamIds.some(id => !s.disclosures.some(row => row.dreamId === id && row.date <= p.date)) ||
        p.recalledEventIds.some(id => !run.events.some(row => row.id === id && row.date <= p.date))) fail("presentation reference");
  }
  for (const d of s.disclosures) { date(d.date); if (!s.instances.some(row => row.id === d.dreamId)) fail("disclosure"); }
}
