import { loadParams } from "../src/params.js";
import { mountLifePosition, canOpenLifePosition } from "./lifeposition.js";
import { createSetup } from "../src/setup.js";
import { createSimulation, advanceToBoundary, setPaused } from "../src/sim.js";
import { addMonths, daysBetween, nextBoundary } from "../src/calendar.js";
import { observationSettings, observedWeeks, weeklyGraph, renderWeeklyGraph, radarModel, renderRadar,
  weekDescription, escapeHtml, formatNumber } from "./graph.js";

// The clock changes only when boundaries are visited, never their calculation.
// schedule/cancel are injectable so tests exercise the same controls as the UI.
export function createObservationController(params, { seed, initialRun,
  schedule = (callback, delay) => setTimeout(callback, delay), cancel = id => clearTimeout(id),
  onChange = () => {}, onError = () => {} } = {}) {
  const settings = observationSettings(params);
  let run = initialRun ?? createSimulation(params, createSetup(params, { seed }).snapshot());
  let timer = null, generation = 0, disposed = false;
  const view = { speed: 1, windowWeeks: settings.defaultWeeks, followLatest: true,
    endWeekIndex: null, selectedWeek: null, visible: { S: true, C: true, G: true }, hidden: false,
    detailOpen: false, lifePositionOpen: false };
  const details = new Set();
  const notify = () => onChange();
  function stopClock() {
    generation++;
    if (timer !== null) cancel(timer);
    timer = null;
  }
  function active() {
    return !disposed && !view.hidden && !view.detailOpen && !view.lifePositionOpen && view.followLatest &&
      run.state === "RUNNING" && !run.pendingDecision;
  }
  function arm() {
    stopClock();
    if (!active()) return;
    const next = nextBoundary(run.calendar);
    if (!next) return;
    const monthStart = `${run.calendar.currentDate.slice(0, 7)}-01`;
    const delay = settings.monthMs * daysBetween(run.calendar.currentDate, next.date) /
      daysBetween(monthStart, addMonths(monthStart, 1)) / view.speed;
    const token = generation;
    timer = schedule(() => {
      if (token !== generation || !active()) return;
      timer = null;
      try {
        run = advanceToBoundary(params, run);
        notify();
        arm();
      } catch (error) {
        pause();
        onError(error);
      }
    }, delay);
  }
  function pause() {
    stopClock();
    run = setPaused(params, run, true);
    notify();
  }
  return {
    settings,
    // The simulation is read-only to observers; view state is returned by value.
    snapshot: () => ({ run, view: { ...view, visible: { ...view.visible } } }),
    start() { notify(); arm(); },
    pause,
    resume() {
      if (disposed || view.hidden || view.lifePositionOpen) return;
      details.clear(); view.detailOpen = false;
      view.followLatest = true; view.endWeekIndex = null; view.selectedWeek = null;
      run = setPaused(params, run, false);
      notify(); arm();
    },
    setLifePositionOpen(open) {
      if (open && (disposed || !canOpenLifePosition(run.state))) return false;
      view.lifePositionOpen = Boolean(open);
      if (open) stopClock();
      notify();
      return true;
    },
    setSpeed(speed) {
      if (!settings.speeds.includes(speed)) throw new RangeError("Unsupported observation speed");
      view.speed = speed; notify(); arm();
    },
    setWindow(weeks) {
      if (!settings.windows.includes(weeks)) throw new RangeError("Unsupported graph window");
      view.windowWeeks = weeks; notify();
    },
    toggleSeries(key) {
      if (!Object.hasOwn(view.visible, key)) throw new TypeError("Unknown graph series");
      view.visible[key] = !view.visible[key]; notify();
    },
    inspectWeek(index) {
      if (!observedWeeks(run).some(week => week.weekIndex === index)) throw new RangeError("Unobserved week");
      view.followLatest = false; view.endWeekIndex = index; view.selectedWeek = index;
      pause();
    },
    setDetail(name, open) {
      if (open) details.add(name); else details.delete(name);
      view.detailOpen = details.size > 0;
      if (open) pause(); else notify();
    },
    setHidden(hidden) {
      view.hidden = Boolean(hidden);
      if (view.hidden) pause(); else notify(); // Return requires an explicit resume.
    },
    dispose() { disposed = true; stopClock(); },
  };
}

const FORMATS = { video: "編集動画", shorts: "短い動画", music: "楽曲・MV", stream: "生配信" };
const STATES = { RUNNING: "見届けています", PAUSED: "一時停止中", CHOICE: "大きな選択を待っています", RESULT: "観察期間の区切り" };
const money = value => `${formatNumber(value)}円`;

export async function mountApp(document) {
  const $ = id => document.getElementById(id);
  const start = $("start"), errorBox = $("error");
  let controller = null;
  mountLifePosition(document, { getController: () => controller });
  const showError = error => {
    errorBox.textContent = `読み込み・進行を止めました。${error.message}。ページを再読み込みしてお試しください。`;
    errorBox.hidden = false;
  };
  let params;
  try { params = await loadParams(); } catch (error) { showError(error); return; }
  start.disabled = false;
  $("loading").hidden = true;

  function render() {
    const { run, view } = controller.snapshot();
    const character = run.runSetupTemplate.characterProfile, person = run.personTemplate;
    $("name").textContent = character.name;
    const weekNumber = run.state === "RESULT" ? run.weeklySnapshots.at(-1).weekIndex + 1 : run.calendar.weekIndex + 1;
    $("date").textContent = `${run.calendar.currentDate} · 第${weekNumber}週 · 開始から${daysBetween(run.calendar.startDate, run.calendar.currentDate)}日`;
    $("status").textContent = STATES[run.state] ?? run.state;
    const background = params.collections.backgrounds.find(row => row.id === person.background);
    const occupation = background?.columns["経歴・職業の種類"] ?? background?.columns["経歴・職業の類型"] ?? person.background;
    $("profile").textContent = `${person.startYear}年開始 · 開始時${person.age}歳 · ${occupation} · ${FORMATS[run.policy.format]}中心`;
    $("pause").disabled = run.state !== "RUNNING";
    $("resume").disabled = view.hidden || view.lifePositionOpen || !["RUNNING", "PAUSED"].includes(run.state) || Boolean(run.pendingDecision);
    $("lp-open").disabled = !canOpenLifePosition(run.state);
    $("speed").value = String(view.speed);
    $("window").value = String(view.windowWeeks);
    for (const key of ["S", "C", "G"]) $("series-" + key).setAttribute("aria-pressed", String(view.visible[key]));
    const graph = weeklyGraph(run, view), weeks = observedWeeks(run);
    $("graph").innerHTML = renderWeeklyGraph(graph, view.visible);
    $("following").textContent = view.followLatest ? "最新の週を追っています" : "過去を閲覧中 · 進行は停止しています";
    const history = $("history");
    history.max = String(weeks.at(-1)?.weekIndex ?? 0);
    history.value = String(view.selectedWeek ?? weeks.at(-1)?.weekIndex ?? 0);
    history.disabled = weeks.length === 0;
    const selected = weeks.find(week => week.weekIndex === view.selectedWeek) ?? weeks.at(-1);
    $("week-info").textContent = selected ? weekDescription(selected) : "最初の週の記録を待っています。";
    $("subscribers").textContent = `${formatNumber(run.channels[0].subscribers)}人`;
    $("funds").textContent = money(run.ledger.balanceYen);
    $("reserved").textContent = money(run.economy.reservedProductionYen);
    $("unmet").textContent = money(run.economy.unmetLivingYen);
    $("fatigue").textContent = formatNumber(run.fatigue);
    $("work-count").textContent = `${run.works.length}作品`;
    const axes = radarModel(run);
    $("radar").innerHTML = renderRadar(axes);
    $("abilities").innerHTML = axes.map(axis => `<tr><th scope="row">${escapeHtml(axis.label)}</th><td>${Math.round(axis.current)}</td><td>${Math.round(axis.debut)}</td></tr>`).join("");
    $("activity-log").innerHTML = run.works.length ? run.works.slice().reverse().map(work =>
      `<li><time>${escapeHtml(work.releaseDate)}</time> ${escapeHtml(FORMATS[work.format])}を公開 · 作品${escapeHtml(work.id)}<br>累計再生 ${formatNumber(work.views)}回 · 登録への寄与 ${formatNumber(work.newSubscribers)}人（ゲーム内の推定寄与）</li>`).join("") : "<li>最初の公開に向けて活動しています。</li>";
    $("life-log").innerHTML = run.economy.summaries.length ? run.economy.summaries.slice().reverse().map(month =>
      `<li><time>${escapeHtml(month.yearMonth)}</time> の暮らし<br>本業収入 ${money(month.jobIncomeYen)} · 生活費支払 ${money(month.livingPaidYen)} · 生活費不足 ${money(month.unmetLivingYen)}<br>活動売上 ${money(month.grossRevenueYen)} · 本人受取 ${money(month.receiptYen)} · 活動利益 ${money(month.activityProfitYen)}</li>`).join("") : "<li>最初の月の記録を待っています。</li>";
    $("result").hidden = run.state !== "RESULT";
    if (run.state === "RESULT") $("result-text").textContent = `${run.calendar.startDate}から${run.calendar.currentDate}までを見届けました。${run.lifeSnapshot.workCount}作品を残し、活動は続いています。`;
  }
  start.addEventListener("click", () => {
    start.disabled = true;
    try {
      // Wall time selects a new seed once; all generation uses the seeded engine.
      const seed = $("seed").value.trim() || `life-${Date.now()}`;
      controller = createObservationController(params, { seed, onChange: render, onError: showError });
      $("seed-used").textContent = seed;
      const options = values => values.map(value => `<option value="${value}">${value === "all" ? "全期間" : value}</option>`).join("");
      $("speed").innerHTML = options(controller.settings.speeds);
      $("window").innerHTML = options(controller.settings.windows);
      $("title-screen").hidden = true;
      $("observation").hidden = false;
      if (document.hidden) controller.setHidden(true);
      controller.start();
      $("observation-heading").focus();
    } catch (error) { controller?.dispose(); showError(error); }
  });
  $("pause").addEventListener("click", () => controller?.pause());
  $("resume").addEventListener("click", () => {
    for (const detail of document.querySelectorAll("details[data-pause]")) detail.open = false;
    controller?.resume();
  });
  $("speed").addEventListener("change", event => controller?.setSpeed(Number(event.target.value)));
  $("window").addEventListener("change", event => controller?.setWindow(event.target.value === "all" ? "all" : Number(event.target.value)));
  for (const key of ["S", "C", "G"]) $("series-" + key).addEventListener("click", () => controller?.toggleSeries(key));
  $("history").addEventListener("input", event => controller?.inspectWeek(Number(event.target.value)));
  const inspect = event => {
    const target = event.target.closest("[data-week]");
    if (!target || (event.type === "keydown" && !["Enter", " "].includes(event.key))) return;
    event.preventDefault();
    controller?.inspectWeek(Number(target.dataset.week));
    $("week-info").focus();
  };
  $("graph").addEventListener("click", inspect);
  $("graph").addEventListener("keydown", inspect);
  $("graph").addEventListener("scroll", () => {
    if (controller?.snapshot().run.state === "RUNNING") controller.pause();
  }, { passive: true });
  for (const detail of document.querySelectorAll("details[data-pause]")) detail.addEventListener("toggle", () => controller?.setDetail(detail.id, detail.open));
  document.addEventListener("visibilitychange", () => controller?.setHidden(document.hidden));
  document.defaultView.addEventListener("pagehide", () => controller?.setHidden(true));
  document.defaultView.addEventListener("pageshow", () => controller?.setHidden(document.hidden));
  return () => controller?.dispose();
}

if (typeof document !== "undefined") mountApp(document).catch(error => {
  const box = document.getElementById("error");
  box.hidden = false; box.textContent = `画面を読み込めませんでした。${error.message}`;
});
