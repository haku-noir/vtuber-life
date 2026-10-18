import { addDays, addMonths, daysBetween } from "./calendar.js";
import { applyTransaction, settleMonth } from "./save.js";

// Functions mutate only the run's private transaction draft, never the caller's run.
function post(run, date, transactionId, kind, amountYen, extra = {}) {
  run.ledger = applyTransaction(run.ledger, {
    transactionId, yearMonth: date.slice(0, 7), date, kind, amountYen, ...extra,
  });
}

export function dailyAvailableHours(life, balance) {
  return Math.max(0, 24 - balance.time.restHoursPerDay - balance.time.lifeHoursPerDay -
    (life.workHoursPerWeek + life.careHoursPerWeek) / 7);
}

export function beginMonth(run, date, balance) {
  const yearMonth = date.slice(0, 7);
  if (run.economy.month?.yearMonth === yearMonth) return;
  const first = `${yearMonth}-01`, next = addMonths(first, 1);
  const end = next < run.calendar.endDate ? next : run.calendar.endDate;
  const days = daysBetween(date, end), ratio = days / daysBetween(first, next);
  const life = run.personTemplate.life;
  const month = { yearMonth, startDate: date, endDate: end, days,
    jobIncomeYen: Math.floor(life.monthlyIncomeYen * ratio),
    livingDueYen: Math.floor(life.livingCostYen * ratio), livingPaidYen: 0, unmetLivingYen: 0,
    lessonCostYen: 0, lessonHoursPerDay: 0, productionCostYen: 0,
    gross: { advertising: 0, support: 0, membership: 0, sponsorship: 0, sales: 0 },
    grossRevenueYen: 0, receiptYen: 0, activityProfitYen: 0 };
  run.economy.month = month;
  post(run, date, "job", "income", month.jobIncomeYen);
  month.livingPaidYen = Math.min(month.livingDueYen, run.ledger.balanceYen);
  month.unmetLivingYen = month.livingDueYen - month.livingPaidYen;
  run.economy.unmetLivingYen += month.unmetLivingYen;
  post(run, date, "living", "expense", month.livingPaidYen);
  const f = balance.formats[run.policy.format];
  run.economy.reservedProductionYen = run.ledger.balanceYen >= f.productionCostYen ? f.productionCostYen : 0;
  const lessonCost = Math.floor(balance.lesson.monthlyCostYen * ratio);
  const lessonHours = balance.lesson.monthlyHours * ratio;
  if (run.policy.voiceTraining && dailyAvailableHours(life, balance) >= lessonHours / days &&
      run.ledger.balanceYen - run.economy.reservedProductionYen >= lessonCost) {
    month.lessonCostYen = lessonCost;
    month.lessonHoursPerDay = lessonHours / days;
    post(run, date, "voice-training", "expense", lessonCost);
  }
}

export function payProduction(run, date, workId, balance) {
  const cost = balance.formats[run.policy.format].productionCostYen;
  if (cost > run.ledger.balanceYen) return false;
  post(run, date, `production-${workId}`, "expense", cost, { workId });
  run.economy.month.productionCostYen += cost;
  run.economy.reservedProductionYen = run.ledger.balanceYen >= cost ? cost : 0;
  return true;
}

export function accrueRevenue(run, views, viewerMinutes, balance) {
  run.economy.month.gross.advertising += views * balance.money.adYenPerView;
  run.economy.month.gross.support += viewerMinutes / 60 * balance.money.supportYenPerViewerHour;
}

export function finishMonth(run, balance) {
  const month = run.economy.month;
  if (!month || run.ledger.settledMonths.includes(month.yearMonth)) return;
  const date = addDays(month.endDate, -1);
  for (const source of Object.keys(month.gross)) {
    month.gross[source] = Math.floor(month.gross[source]);
    const receipt = Math.floor(month.gross[source] * balance.money.receiptShare);
    month.grossRevenueYen += month.gross[source];
    month.receiptYen += receipt;
    post(run, date, `activity-${source}`, "income", receipt);
  }
  month.activityProfitYen = month.receiptYen - month.productionCostYen - month.lessonCostYen;
  run.ledger = settleMonth(run.ledger, month.yearMonth, []);
  run.economy.summaries.push({ ...month, gross: { ...month.gross } });
  run.economy.reservedProductionYen = 0;
}
