import { computeLifePosition, loadStatsDataset } from "../src/lifeposition.js";
import { escapeHtml } from "./graph.js";

export const DISCLAIMER = "ここに示す数字は、活動の成功や、人としての価値・優劣を示すものではありません。架空の人生と現実の統計は、同じ条件で測ったものでもありません。";
const CAUTION = "現実の数字は、特定の調査・レポートが対象にした範囲だけを数えています。登録者の多寡は活動の目的・形式・時代で意味が変わります。ゲーム内の人物は架空の世界の数字です。夢を持たない人・動画だけの人・休止した人も等しく一つの人生です。";
const LABELS = { LP03: "活動中の人数の目安", LP05: "現実の割合の例", LP08: "同接の文脈（上位チャンネルのみ）", LP10: "時代の文脈" };
const NAMES = { hours_watched: "視聴時間", jp_market_size: "国内市場規模",
  bilibili_membership_next_month_renewal: "翌月の会員継続割合", independent_share_of_channels: "個人チャンネルの割合" };
const UNITS = { channels: "チャンネル", viewers: "人", hours: "時間", JPY: "円", share: "（割合）" };
const BADGES = { statistic: "統計", estimate: "推定", placeholder: "仮置き" };
const e = escapeHtml;
const number = value => new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 4 }).format(value);
export const canOpenLifePosition = state => ["PAUSED", "RESULT"].includes(state);
export function badge(kind) {
  return `<span class="evidence-badge evidence-${e(kind)}">${e(BADGES[kind])}</span>`;
}
function contextValue(item) {
  if (item.display) return item.display;
  const value = item.range ? item.range.map(number).join("～") : number(item.value);
  return `${item.evidenceClass === "estimate" ? "≈" : ""}${item.approximate ? "約" : ""}${value} ${UNITS[item.unit] ?? item.unit ?? ""}`;
}
function sourceLink(source) {
  return `<a href="${e(source.url)}" data-source-url="${e(source.url)}" target="_blank" rel="noopener noreferrer">${e(source.title)} — ${e(source.url)}</a>`;
}
function table(headers, rows) {
  return `<div class="lp-table"><table><thead><tr>${headers.map(header => `<th scope="col">${header}</th>`).join("")}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}
export function renderLifePosition(view, methods = false) {
  const disclaimer = `<p class="lp-disclaimer">${DISCLAIMER}</p>`;
  const version = `<p>statsVersion: ${e(view.statsVersion)}${view.versionMismatch ? ` ／ 保存時の版 ${e(view.savedStatsVersion)}とは異なります` : ""}</p>`;
  if (methods) {
    const sources = table(["出典ID・題名・URL", "公表日・取得日", "定義・信頼度・注意"], view.sources.map(source => [
      `${e(source.sourceId)} ${sourceLink(source)}`,
      `${e(source.publishedDate)} ／ ${e(source.retrievedDate)}`,
      `${e(source.definition)} ／ 信頼度${e(source.reliability)} ／ ${e(source.notes)}`,
    ]));
    const inputs = table(["指標・入力ID", "計算式・入力"], view.context.map(item => [
      `${e(item.seriesId)} ${e(item.name ?? item.scope ?? "")} ［${e(item.sourceIds.join(", "))}］`,
      item.inputs ? `p = count / denominatorLowerBound; N = 1 / p<br>${e(JSON.stringify(item.inputs))}` :
        `出典の値をそのまま表示 ／ ${e(item.period)} ／ ${e(item.scope ?? "")}`,
    ]));
    const generation = view.main.generation
      ? `周回数 ${view.main.runs} ／ 開始年 ${view.startYear} ／ 版・シード・生成方法 ${e(JSON.stringify(view.main.generation))}<br>${e(view.main.formula)} ／ ${e(JSON.stringify(view.main.inputs))}`
      : "版・周回数・シード・生成方法は未取得。対応する版・同じ開始年の周回分布はまだありません。";
    return disclaimer + `<p>${CAUTION}</p><p>${badge("statistic")} 出典の集計・公表値 ／ ${badge("estimate")} ≈ 計算・補間・下限からの換算 ／ ${badge("placeholder")} ゲームの設定・周回分布。計算は最も弱い区分を引き継ぎます。</p>
      <h3>表示した数値の出典</h3>${sources}
      <h3>出典名とURL</h3><ul>${view.references.map(source => `<li>${sourceLink(source)}</li>`).join("")}</ul>
      <h3>計算式と入力</h3>${inputs}
      <p>割合 p の逆数を約N人に1人とし、Nが10以上は有効数字2桁、10未満は整数に丸めます。割合が50%を超える場合や最初の区間は「最も多い範囲」と表示します。</p>
      <h3>ゲーム内の周回分布の作り方</h3><p>${generation}</p>${version}`;
  }
  return disclaimer + version + `<p>${e(view.startYear)}年に開始 ／ いま登録者 ${number(view.subscribers)}人（ゲーム内）</p>
    ${view.status === "unavailable" ? '<p role="status">未取得。統計データを読み込めませんでした。</p>' : ""}
    <details open class="lp-group"><summary>ゲーム内の同じ年の人生</summary><p>${badge("placeholder")} ${e(view.main.display)}</p>
      <p class="caption">${view.main.runs ? `${view.main.runs}周回との比較。現実の統計ではありません。` : "同じ開始年・同じ版の周回分布は未取得です。"}</p></details>
    <details open class="lp-group"><summary>現実の文脈（参考）</summary>${view.context.length ? view.context.map(item =>
      `<p>${badge(item.evidenceClass)} ${e(LABELS[item.seriesId])} ${e(NAMES[item.name] ?? "")}：${e(contextValue(item))}<br>
      <span class="caption">${e(item.period ?? item.inputs?.scope ?? "")} ［${e(item.sourceIds.join(", "))}］</span></p>`).join("") :
      "<p>表示できる数値はありません。出典名とURLは「出典と方法」で確認できます。</p>"}</details>`;
}

// Local screen state only. A rejected/failed read never reaches the game error handler.
export function mountLifePosition(document, { getController, load = loadStatsDataset } = {}) {
  const $ = id => document.getElementById(id);
  let pending = null, current = null, methods = false, token = 0;
  const render = () => {
    $("lp-heading").textContent = methods ? "出典と方法" : "人生の位置（補助表示）";
    $("lp-methods").textContent = methods ? "人生の位置に戻る" : "出典と方法を見る";
    $("lp-content").innerHTML = renderLifePosition(current, methods);
  };
  function close() {
    token++;
    getController()?.setLifePositionOpen(false);
    $("life-position").hidden = true;
    $("observation").hidden = false;
    $("lp-open").focus();
  }
  $("lp-open").addEventListener("click", async () => {
    const controller = getController();
    if (!$("lp-enabled").checked || !controller?.setLifePositionOpen(true)) return;
    const request = ++token, run = controller.snapshot().run;
    methods = false;
    current = computeLifePosition(null, runValues(run));
    $("observation").hidden = true;
    $("life-position").hidden = false;
    render(); $("lp-heading").focus();
    pending ??= Promise.resolve().then(load).catch(() => ({ dataset: null })).then(result => {
      // Keep successful reads; reopening can retry failures even after this screen closes.
      if (!result.dataset) pending = null;
      return result;
    });
    const result = await pending;
    if (request !== token) return;
    current = computeLifePosition(result.dataset, runValues(run));
    render();
  });
  $("lp-close").addEventListener("click", close);
  $("lp-methods").addEventListener("click", () => { if (current) { methods = !methods; render(); $("lp-heading").focus(); } });
  $("lp-enabled").addEventListener("change", () => {
    $("lp-open").hidden = !$("lp-enabled").checked;
    if (!$("lp-enabled").checked && !$("life-position").hidden) close();
  });
  $("lp-content").addEventListener("click", event => {
    const link = event.target.closest("[data-source-url]");
    if (link && !document.defaultView.confirm("外部ブラウザで出典を開きます。続けますか？")) event.preventDefault();
  });
  $("life-position").addEventListener("keydown", event => {
    if (event.key === "Escape") { event.preventDefault(); close(); }
  });
}
function runValues(run) {
  const channel = run.channels[0];
  return { runId: run.runId, startYear: Number(run.calendar.startDate.slice(0, 4)),
    subscribers: channel.subscribers, versions: run.versions };
}

