// Read-only supplementary statistics. No simulation, RNG or persistence imports.
const STATS_URL = new URL("../docs/spec/stats-sample.json", import.meta.url);
const ALLOWED = new Set(["LP03", "LP05", "LP08", "LP10", "LP11"]);
const SOURCES = new Set(["M16", "M18", "M24", "M25"]);
const CLASSES = ["statistic", "estimate", "placeholder"];
const finite = value => typeof value === "number" && Number.isFinite(value) && value >= 0;
const fail = () => { throw new TypeError("Invalid StatsDataset"); };
function freeze(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
export function evidenceClass(inputs, minimum = "statistic") {
  const rank = value => { const index = CLASSES.indexOf(value); if (index < 0) fail(); return index; };
  let result = Math.max(rank(minimum), ...inputs.map(input => rank(input.evidenceClass)));
  for (const key of ["sourceId", "period", "definition"])
    if (new Set(inputs.map(input => input[key] ?? "")).size > 1) result = Math.max(result, 1);
  return CLASSES[result];
}
export function oneInN(p) {
  if (!Number.isFinite(p) || p <= 0 || p > 1) return null;
  const n = 1 / p;
  return n >= 10 ? Number(n.toPrecision(2)) : Math.max(1, Math.round(n));
}
export function shareDisplay(p, { upperBound = false, lowest = false, evidenceClass: kind = "placeholder" } = {}) {
  if (lowest || (Number.isFinite(p) && p > 0.5)) return "最も多い範囲";
  if (!Number.isFinite(p) || p < 0 || p > 1) return "未取得";
  if (p === 0) return "比較した周回に、この値以上の記録はありません";
  const prefix = kind === "estimate" ? "≈" : "";
  const percentage = p * 100 < 1 ? Number((p * 100).toPrecision(1)) : Math.round(p * 100);
  return upperBound
    ? `${prefix}上位${percentage}%未満・約${oneInN(p)}人に1人より少ない`
    : `${prefix}上位約${percentage}%・約${oneInN(p)}人に1人`;
}
export function thresholdShare({ count, denominator, denominatorLowerBound }, inputs = []) {
  const upperBound = denominatorLowerBound !== undefined;
  const n = upperBound ? denominatorLowerBound : denominator;
  if (!finite(count) || !finite(n) || n <= 0 || count > n) fail();
  const p = count / n, kind = evidenceClass(inputs, "estimate");
  return { topShare: p, oneInN: oneInN(p), upperBound, evidenceClass: kind,
    display: shareDisplay(p, { upperBound, evidenceClass: kind }) };
}
// Extension/test method only; real interval distributions are never bundled.
export function intervalShare(value, bins) {
  if (!finite(value) || !Array.isArray(bins) || !bins.length) fail();
  bins.forEach((bin, index) => {
    if (!finite(bin.lower) || !(bin.upper === null || finite(bin.upper) && bin.upper > bin.lower) ||
        !finite(bin.share) || bin.share > 1 || !CLASSES.includes(bin.evidenceClass) ||
        (index && bins[index - 1].upper !== bin.lower) || (bin.upper === null && index !== bins.length - 1)) fail();
  });
  if (Math.abs(bins.reduce((sum, bin) => sum + bin.share, 0) - 1) > 1e-8) fail();
  const index = bins.findIndex(bin => value >= bin.lower && (bin.upper === null || value < bin.upper));
  const kind = evidenceClass(bins, "estimate"), bin = bins[index];
  if (!bin) return { topShare: null, oneInN: null, evidenceClass: kind, display: "未取得" };
  if (index === 0) return { topShare: null, oneInN: null, evidenceClass: kind, display: "最も多い範囲" };
  if (bin.lower === 0 || bin.upper === null)
    return { topShare: null, oneInN: null, evidenceClass: kind, display: "区間内の割合は補間しません" };
  const above = bins.slice(index + 1).reduce((sum, item) => sum + item.share, 0);
  const p = above + bin.share * (Math.log(bin.upper) - Math.log(value)) / (Math.log(bin.upper) - Math.log(bin.lower));
  return { topShare: p, oneInN: oneInN(p), evidenceClass: kind, display: shareDisplay(p, { evidenceClass: kind }) };
}

// Sanitizes at the data boundary: unchecked sources retain ONLY title and URL.
// Their points, inputs, notes, definitions and precomputed results cannot reach UI.
export function parseStatsDataset(text) {
  if (typeof text !== "string" || text.length > 2_000_000) fail();
  const raw = JSON.parse(text);
  if (raw?.schema !== "vtl-stats-dataset/1" || typeof raw.statsVersion !== "string" || !raw.statsVersion ||
      !Array.isArray(raw.sources) || !Array.isArray(raw.series)) fail();
  const sources = [], references = [], sourceMap = new Map();
  for (const source of raw.sources) {
    if (!SOURCES.has(source.sourceId) || !["paper", "public_report"].includes(source.sourceType)) continue;
    if (sourceMap.has(source.sourceId) || typeof source.title !== "string" ||
        typeof source.url !== "string" || !/^https?:\/\//.test(source.url)) fail();
    sourceMap.set(source.sourceId, source);
    if (source.citationTermsChecked !== true) {
      references.push({ title: source.title, url: source.url });
      continue;
    }
    if (!["publishedDate", "retrievedDate", "definition"].every(key => typeof source[key] === "string" && source[key]) ||
        !["A", "B", "C", "D"].includes(source.reliability)) fail();
    sources.push({ sourceId: source.sourceId, title: source.title, url: source.url, publishedDate: source.publishedDate,
      retrievedDate: source.retrievedDate, definition: source.definition, sourceType: source.sourceType,
      reliability: source.reliability, citationTermsChecked: true, notes: source.notes ?? "" });
  }
  const checked = new Set(sources.map(source => source.sourceId));
  const idsFor = (series, point) => [...new Set([...(series.sourceIds ?? []), ...(point?.sourceIds ?? [])])];
  const permitted = ids => ids.length > 0 && ids.every(id => checked.has(id));
  const series = [];
  for (const item of raw.series) {
    if (!ALLOWED.has(item.seriesId)) continue;
    if (!CLASSES.includes(item.evidenceClass) || (item.evidenceClass === "placeholder" && item.placeholder !== true)) fail();
    if (item.seriesId === "LP11") {
      if (item.placeholder !== true || item.evidenceClass !== "placeholder" || item.runsPerYear !== 1000) fail();
      // Build-generated samples are optional; null quantiles are not samples.
      const points = (item.points ?? []).map(point => {
        const result = { year: point.year };
        if (point.subscriberSamples != null) {
          if (!Number.isInteger(point.year) || !Array.isArray(point.subscriberSamples) ||
              point.subscriberSamples.length !== item.runsPerYear || !point.subscriberSamples.every(finite) ||
              !point.generation || !["contentVersion", "simulationVersion", "seed", "method"].every(key =>
                typeof point.generation[key] === "string" && point.generation[key])) fail();
          result.subscriberSamples = [...point.subscriberSamples];
          result.generation = { ...point.generation };
        }
        return result;
      });
      series.push({ seriesId: "LP11", evidenceClass: "placeholder", placeholder: true, runsPerYear: item.runsPerYear, points });
      continue;
    }
    if (item.seriesId === "LP05") {
      const ids = idsFor(item);
      if (!permitted(ids)) continue;
      if (item.formula !== "threshold_share_with_lower_bound_denominator") fail();
      const inputs = item.inputs;
      thresholdShare(inputs);
      series.push({ seriesId: item.seriesId, evidenceClass: item.evidenceClass, sourceIds: ids,
        formula: item.formula, inputs: { ...inputs }, notes: item.notes ?? "" });
      continue;
    }
    const points = [];
    for (const point of item.points ?? []) {
      const ids = idsFor(item, point);
      if (!permitted(ids)) continue;
      if (typeof point.period !== "string" ||
          !(finite(point.value) || Array.isArray(point.range) && point.range.length === 2 &&
            point.range.every(finite) && point.range[0] <= point.range[1])) fail();
      points.push({ name: point.name, period: point.period, scope: point.scope, value: point.value,
        range: point.range ? [...point.range] : undefined, unit: point.unit ?? item.unit,
        approximate: point.approximate === true, sourceIds: ids });
    }
    if (points.length) series.push({ seriesId: item.seriesId, metric: item.metric,
      evidenceClass: item.evidenceClass, placeholder: item.placeholder === true, points });
  }
  return freeze({ schema: raw.schema, statsVersion: raw.statsVersion, sources, references, series });
}
export async function loadStatsDataset(readText = async url => {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Stats load failed");
  return response.text();
}) {
  try { return { status: "ready", dataset: parseStatsDataset(await readText(new URL(STATS_URL.href))) }; }
  catch { return { status: "unavailable", dataset: null }; }
}

export function computeLifePosition(dataset, { runId = null, startYear, subscribers, versions = {} } = {}) {
  const main = { seriesId: "LP11", evidenceClass: "placeholder", placeholder: true, display: "未取得", topShare: null };
  const context = [];
  if (dataset) {
    const series = dataset.series.find(item => item.seriesId === "LP11");
    const point = series?.points.find(item => item.year === startYear);
    if (finite(subscribers) && point?.subscriberSamples &&
        point.generation.contentVersion === versions.contentVersion &&
        point.generation.simulationVersion === versions.simulationVersion) {
      const p = point.subscriberSamples.filter(value => value >= subscribers).length / series.runsPerYear;
      Object.assign(main, { topShare: p, oneInN: oneInN(p), display: shareDisplay(p),
        runs: series.runsPerYear, generation: { ...point.generation },
        formula: "p = count(sample >= v) / runsPerYear", inputs: { v: subscribers, year: startYear } });
    }
    for (const item of dataset.series) {
      if (item.seriesId === "LP11") continue;
      if (item.seriesId === "LP05") {
        const inputs = item.sourceIds.map(id => ({ ...dataset.sources.find(source => source.sourceId === id), evidenceClass: item.evidenceClass }));
        context.push({ ...item, ...thresholdShare(item.inputs, inputs) });
      } else {
        for (const point of item.points) {
          const inputs = point.sourceIds.map(id => ({
            ...dataset.sources.find(source => source.sourceId === id), period: point.period,
            evidenceClass: item.evidenceClass,
          }));
          context.push({ seriesId: item.seriesId, ...point, evidenceClass: evidenceClass(inputs) });
        }
      }
    }
  }
  return freeze({ runId, startYear, subscribers, status: dataset ? "ready" : "unavailable",
    statsVersion: dataset?.statsVersion ?? "not-loaded",
    savedStatsVersion: versions.statsVersion ?? "not-loaded",
    versionMismatch: Boolean(dataset && versions.statsVersion && versions.statsVersion !== dataset.statsVersion),
    main, context, sources: dataset?.sources ?? [], references: dataset?.references ?? [] });
}

