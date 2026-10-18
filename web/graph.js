import { ABILITY_AXES } from "../src/params.js";

// These adapters read P-17's prose-valued UI settings, without fallback tuning.
export function observationSettings(params) {
  const value = name => {
    const rows = params.collections.provisionalValues.filter(row => row.columns.項目 === name);
    if (rows.length !== 1) throw new TypeError(`Missing observation setting: ${name}`);
    return rows[0].columns["暫定値・扱い"];
  };
  const timing = /^平均約([\d.]+)秒／月相当、([\d.・]+)倍$/u.exec(value("自動送り"));
  const range = /^直近(\d+)週。([\d・]+)週・全期間へ変更$/u.exec(value("グラフ表示幅"));
  if (!timing || !range) throw new TypeError("Unrecognized P-17 observation settings");
  const monthMs = Number(timing[1]) * 1000, speeds = timing[2].split("・").map(Number);
  const defaultWeeks = Number(range[1]);
  const windows = [...new Set([defaultWeeks, ...range[2].split("・").map(Number)])].sort((a, b) => a - b);
  if (![monthMs, ...speeds, ...windows].every(n => Number.isFinite(n) && n > 0) ||
      !windows.every(Number.isSafeInteger) || !speeds.includes(1)) throw new TypeError("Invalid observation settings");
  return { monthMs, speeds, defaultWeeks, windows: [...windows, "all"] };
}

export const escapeHtml = value => String(value).replace(/[&<>"']/g, ch =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
export const formatNumber = value => new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 1 }).format(value);

export function observedWeeks(run) {
  const weeks = run.weeklySnapshots.filter(week => week.endDate <= run.calendar.currentDate);
  const partial = run.weekProgress;
  if (partial && partial.startDate < partial.endDate && partial.endDate <= run.calendar.currentDate)
    weeks.push(partial);
  return weeks.map(week => ({ ...week }));
}

export function weekDescription(week) {
  return `第${week.weekIndex + 1}週 · ${week.startDate} ～ ${week.endDate}（終端日を含まない）${week.partial ? " · 途中／端数週" : ""}：` +
    `登録者 S ${formatNumber(week.S)}人、同接 C ${week.C === null ? "配信なし" : `${formatNumber(week.C)}人`}、` +
    `新規登録 G ${formatNumber(week.G)}人/週、解除 U ${formatNumber(week.U)}人/週、` +
    `作品再生 ${formatNumber(week.videoViewsThisWeek)}回`;
}

// Powers of two give stable, linear axes that expand only on a new high.
const ceiling = values => 2 ** Math.ceil(Math.log2(Math.max(1, ...values)));
const rounded = n => Math.round(n * 100) / 100;
const point = (x, y) => `${rounded(x)},${rounded(y)}`;

export function weeklyGraph(run, view) {
  const observed = observedWeeks(run);
  const end = view.followLatest || view.endWeekIndex == null ? Infinity : view.endWeekIndex;
  const available = observed.filter(week => week.weekIndex <= end);
  const weeks = view.windowWeeks === "all" ? available : available.slice(-view.windowWeeks);
  const scales = { S: ceiling(observed.map(week => week.S)),
    right: ceiling(observed.flatMap(week => [week.C ?? 0, week.G])) };
  const plot = { left: 82, right: 718, top: 58, bottom: 282 };
  const slots = view.windowWeeks === "all" ? Math.max(1, weeks.length) : view.windowWeeks;
  const width = (plot.right - plot.left) / slots;
  const x = i => plot.right - (weeks.length - i - 0.5) * width;
  const y = (value, maximum) => plot.bottom - value / maximum * (plot.bottom - plot.top);
  const series = {};
  for (const key of ["S", "C"]) {
    const segments = [];
    let previous = null;
    for (const [i, week] of weeks.entries()) {
      if (week[key] === null) { previous = null; continue; }
      if (!previous || previous.channelId !== week.channelId || previous.weekIndex + 1 !== week.weekIndex)
        segments.push([]);
      segments.at(-1).push({ x: x(i), y: y(week[key], key === "S" ? scales.S : scales.right), value: week[key] });
      previous = week;
    }
    series[key] = { segments, dashed: key === "C" };
  }
  series.G = { bars: weeks.map((week, i) => ({ x: x(i) - width * 0.32,
    y: y(week.G, scales.right), width: width * 0.64,
    height: plot.bottom - y(week.G, scales.right), value: week.G })) };
  return { weeks, scales, plot, series, centers: weeks.map((_, i) => x(i)), slotWidth: width };
}

export function renderWeeklyGraph(model, visible = { S: true, C: true, G: true }) {
  const { plot, scales, series, weeks } = model;
  const ticks = Array.from({ length: 5 }, (_, i) => {
    const y = plot.bottom - i * (plot.bottom - plot.top) / 4;
    return `<line class="grid" x1="${plot.left}" x2="${plot.right}" y1="${y}" y2="${y}"/>` +
      `<text x="${plot.left - 8}" y="${y + 4}" text-anchor="end">${formatNumber(scales.S * i / 4)}</text>` +
      `<text x="${plot.right + 8}" y="${y + 4}">${formatNumber(scales.right * i / 4)}</text>`;
  }).join("");
  const bars = visible.G ? `<g data-series="G" class="series-g">${series.G.bars.map(bar =>
    `<rect x="${rounded(bar.x)}" y="${rounded(bar.y)}" width="${rounded(bar.width)}" height="${rounded(bar.height)}"/>`).join("")}</g>` : "";
  const lines = ["S", "C"].map(key => visible[key] ? `<g data-series="${key}" class="series-${key.toLowerCase()}">` +
    series[key].segments.map(segment => `<polyline fill="none" stroke-width="2.5"${series[key].dashed ? ' stroke-dasharray="6 5"' : ""} points="${segment.map(p => point(p.x, p.y)).join(" ")}"/>` +
      segment.map(p => `<circle cx="${rounded(p.x)}" cy="${rounded(p.y)}" r="2"/>`).join("")).join("") + "</g>" : "").join("");
  const targets = weeks.map((week, i) => `<g data-week="${week.weekIndex}" tabindex="0" role="button" aria-label="${escapeHtml(weekDescription(week))}">` +
    `<title>${escapeHtml(weekDescription(week))}</title><rect class="week-target" x="${rounded(model.centers[i] - model.slotWidth / 2)}" y="${plot.top}" width="${rounded(model.slotWidth)}" height="${plot.bottom - plot.top}"/></g>`).join("");
  return `<svg viewBox="0 0 800 334" role="group" aria-label="週単位の活動グラフ">` +
    `<text x="${plot.left}" y="22">登録者［人］</text><text x="${plot.right}" y="22" text-anchor="end">同接［人］／新規登録［人/週］</text>` +
    ticks + bars + lines + targets +
    (weeks.length ? `<text x="${plot.left}" y="312">${escapeHtml(weeks[0].startDate)}</text><text x="${plot.right}" y="312" text-anchor="end">${escapeHtml(weeks.at(-1).endDate)} · 第${weeks.at(-1).weekIndex + 1}週</text>` :
      '<text x="400" y="168" text-anchor="middle">活動の記録を待っています</text>') + "</svg>";
}

const AXIS_LABELS = ["歌唱", "画力", "ダンス・身体表現", "ゲーム", "トーク・実況", "コラボ・掛け合い", "企画・構成", "編集・制作"];
export function radarModel(run) {
  return ABILITY_AXES.map((key, i) => ({ key, label: AXIS_LABELS[i],
    current: run.abilities[key], debut: run.debutAbilities[key] }));
}

export function renderRadar(axes) {
  const coordinate = (i, value) => {
    const angle = -Math.PI / 2 + i * Math.PI / 4;
    return [180 + Math.cos(angle) * value, 155 + Math.sin(angle) * value];
  };
  const polygon = value => axes.map((_, i) => point(...coordinate(i, value))).join(" ");
  const grid = [20, 40, 60, 80, 100].map(value => `<polygon class="grid" fill="none" points="${polygon(value)}"/><text x="184" y="${155 - value}">${value}</text>`).join("");
  const labels = axes.map((axis, i) => {
    const [x, y] = coordinate(i, 124);
    return `<text x="${rounded(x)}" y="${rounded(y)}" text-anchor="middle">${escapeHtml(axis.label)}</text>`;
  }).join("");
  const shapes = ["debut", "current"].map(key => `<polygon class="radar-${key}" points="${axes.map((axis, i) => point(...coordinate(i, axis[key]))).join(" ")}"/>`).join("");
  return `<svg viewBox="0 0 360 310" role="img" aria-label="能力の輪郭。0から100の固定尺度。実線は現在、破線はデビュー時">${grid}${shapes}${labels}</svg>`;
}
