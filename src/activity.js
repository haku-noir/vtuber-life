import { ABILITY_AXES } from "./params.js";
import { createRng } from "./rng.js";
import { daysBetween } from "./calendar.js";
import { dailyAvailableHours, payProduction, accrueRevenue } from "./economy.js";

function improve(run, axis, hours, rate, balance) {
  const current = run.abilities[axis];
  run.abilities[axis] = Math.min(balance.ability.max,
    current + hours * rate * (1 - current / balance.ability.max));
}

function publish(run, date, balance) {
  const f = balance.formats[run.policy.format];
  while (run.activity.productionHours >= f.productionHours) {
    const id = `work-${run.works.length + 1}`;
    if (!payProduction(run, date, id, balance)) break;
    const quality = ABILITY_AXES.reduce((sum, axis) => sum + run.abilities[axis] * f.abilityWeights[axis], 0) / balance.ability.max;
    run.activity.productionHours -= f.productionHours;
    run.works.push({ id, channelId: "channel-1", createdDate: run.activity.projectStartDate,
      releaseDate: date, format: run.policy.format, quality, views: 0, comments: 0, newSubscribers: 0 });
    run.releases.push({ id: `release-${run.releases.length + 1}`, workId: id, releaseDate: date,
      views: 0, weekViews: 0, comments: 0, newSubscribers: 0, weekIndex: run.calendar.weekIndex });
    run.events.push({ id: `published-${id}`, date, kind: "publication", workId: id });
    run.activity.projectStartDate = date;
  }
}

// Channel-level deduplication happens before integer attribution to sources.
function attribute(total, sources) {
  const sum = sources.reduce((n, row) => n + row.reach, 0);
  if (!sum || !total) return sources.map(() => 0);
  const exact = sources.map(row => total * row.reach / sum);
  const result = exact.map(Math.floor);
  const order = exact.map((v, i) => ({ i, remainder: v - result[i] }))
    .sort((a, b) => b.remainder - a.remainder || a.i - b.i);
  for (let i = 0, left = total - result.reduce((a, v) => a + v, 0); i < left; i++) result[order[i].i]++;
  return result;
}

export function advanceActivityDay(run, date, balance) {
  const f = balance.formats[run.policy.format], a = balance.audience, d = balance.discovery;
  const relativeDay = daysBetween(run.calendar.startDate, date);
  const rng = createRng(run.seed, "activity", relativeDay);
  const lessonHours = run.economy.month.lessonHoursPerDay;
  const hours = Math.max(0, dailyAvailableHours(run.personTemplate.life, balance) - lessonHours) *
    (1 - balance.time.maxFatigueReduction * run.fatigue / balance.time.fatigueLimit);
  const productionHours = hours * f.productionShare;
  run.activity.productionHours += productionHours;
  // An unfunded project can wait; unused time never becomes an unbounded backlog.
  run.activity.productionHours = Math.min(run.activity.productionHours, f.productionHours + productionHours);
  const practiceHours = hours * f.practiceShare;
  for (const axis of ABILITY_AXES) improve(run, axis,
    (practiceHours + productionHours) * f.abilityWeights[axis], balance.ability.practiceGainPerHour, balance);
  improve(run, "singing", lessonHours, balance.ability.lessonGainPerHour, balance);
  publish(run, date, balance);

  let views = 0;
  const sources = [];
  for (let i = 0; i < run.releases.length; i++) {
    const release = run.releases[i], work = run.works[i];
    const age = daysBetween(release.releaseDate, date), workRng = rng.fork(release.id);
    const rediscovered = age >= d.rediscoveryAfterDays && workRng.fork("rediscovery").next() < d.rediscoveryDailyChance;
    const variation = d.variationMin + workRng.fork("reach").next() * (d.variationMax - d.variationMin);
    const count = Math.floor(d.dailyReach * balance.formats[work.format].reachMultiplier *
      (d.qualityFloor + (1 - d.qualityFloor) * work.quality) * variation *
      (rediscovered ? d.rediscoveryMultiplier : d.tailRatio + Math.exp(-age / d.decayDays)));
    if (release.weekIndex !== run.calendar.weekIndex) { release.weekIndex = run.calendar.weekIndex; release.weekViews = 0; }
    release.views += count; release.weekViews += count;
    const comments = Math.floor(count * a.commentRate);
    release.comments += comments; work.views += count; work.comments += comments; views += count;
    sources.push({ release, reach: count * a.uniqueReachRatio });
    if (rediscovered) run.events.push({ id: `rediscovery-${release.id}-${relativeDay}`, date, kind: "rediscovery", workId: work.id });
  }

  let streamMinutes = 0, viewerMinutes = 0, streamReach = 0;
  if (run.policy.liveMode === "regular") {
    run.activity.streamHours += hours * f.streamShare;
    const required = f.streamSessionHours + f.streamPreparationHours;
    const sessions = Math.floor(run.activity.streamHours / required);
    run.activity.streamHours -= sessions * required;
    for (let i = 0; i < sessions; i++) {
      const sessionRng = rng.fork("stream", i);
      const attendance = a.attendanceMin + sessionRng.next() * (a.attendanceMax - a.attendanceMin);
      const viewers = Math.floor(run.activity.regularViewers * attendance) + sessionRng.int(0, a.walkInMax);
      const minutes = f.streamSessionHours * 60;
      streamMinutes += minutes; viewerMinutes += viewers * minutes; streamReach += viewers;
    }
    improve(run, "talk", sessions * f.streamSessionHours, balance.ability.practiceGainPerHour, balance);
  }
  sources.push({ release: null, reach: streamReach });
  const reach = sources.reduce((sum, row) => sum + row.reach, 0);
  const deduplicated = Math.floor(reach * (1 - a.overlapRatio));
  const expected = deduplicated * a.subscribeRate;
  const G = Math.floor(expected) + Number(rng.fork("subscribe").next() < expected % 1);
  const churn = run.channels[0].subscribers * a.dailyChurnRate;
  const U = Math.min(run.channels[0].subscribers, Math.floor(churn) + Number(rng.fork("churn").next() < churn % 1));
  const attribution = attribute(G, sources);
  sources.forEach((source, i) => {
    if (source.release) {
      source.release.newSubscribers += attribution[i];
      run.works[i].newSubscribers += attribution[i];
    } else run.activity.streamNewSubscribers += attribution[i];
  });
  run.activity.regularViewers = run.activity.regularViewers * a.regularRetention + deduplicated * a.regularConversion;
  run.channels[0].subscribers += G - U;
  const usedHours = productionHours + practiceHours + lessonHours +
    (run.policy.liveMode === "regular" ? hours * f.streamShare : 0);
  run.fatigue = Math.max(0, Math.min(balance.time.fatigueLimit,
    run.fatigue + usedHours * balance.time.fatiguePerHour - balance.time.recoveryPerDay));
  const week = run.weekProgress;
  week.G += G; week.U += U; week.S = run.channels[0].subscribers; week.videoViewsThisWeek += views;
  week.streamMinutes += streamMinutes; week.viewerMinutes += viewerMinutes;
  week.C = week.streamMinutes ? week.viewerMinutes / week.streamMinutes : null;
  accrueRevenue(run, views, viewerMinutes, balance);
}
