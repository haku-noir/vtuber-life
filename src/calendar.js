const DAY_MS = 86400000;

export function dayNumber(date) {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date < "0001-01-01")
    throw new TypeError("Expected ISO calendar date");
  const value = Date.parse(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(value) || new Date(value).toISOString().slice(0, 10) !== date)
    throw new RangeError("Invalid calendar date");
  return value / DAY_MS;
}

function fromDay(day) {
  const date = new Date(day * DAY_MS).toISOString().slice(0, 10);
  dayNumber(date);
  return date;
}

export function addDays(date, days) {
  if (!Number.isSafeInteger(days)) throw new TypeError("Days must be integers");
  return fromDay(dayNumber(date) + days);
}

export function daysBetween(start, end) { return dayNumber(end) - dayNumber(start); }

export function addMonths(date, months) {
  dayNumber(date);
  if (!Number.isSafeInteger(months)) throw new TypeError("Months must be integers");
  const [year, month, day] = date.split("-").map(Number);
  const index = year * 12 + month - 1 + months;
  const y = Math.floor(index / 12), m = index % 12 + 1;
  if (y < 1 || y > 9999) throw new RangeError("Date outside supported years");
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  const last = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(Math.min(day, last)).padStart(2, "0")}`;
}

export function createCalendar(startDate, observationMonths) {
  if (!Number.isInteger(observationMonths) || observationMonths <= 0 || observationMonths > 1200)
    throw new RangeError("Invalid observation months");
  return { startDate, currentDate: startDate, endDate: addMonths(startDate, observationMonths),
    observationMonths, weekStart: startDate, weekIndex: 0 };
}

export function validateCalendar(calendar) {
  if (!calendar || typeof calendar !== "object") throw new TypeError("Missing calendar");
  const expected = createCalendar(calendar.startDate, calendar.observationMonths);
  const { currentDate, endDate, weekStart, weekIndex } = calendar;
  dayNumber(currentDate); dayNumber(weekStart);
  if (endDate !== expected.endDate || currentDate < calendar.startDate || currentDate > endDate)
    throw new RangeError("Calendar outside observation period");
  const elapsed = daysBetween(calendar.startDate, currentDate);
  const index = currentDate === endDate ? Math.ceil(elapsed / 7) : Math.floor(elapsed / 7);
  const start = currentDate === endDate ? endDate : addDays(calendar.startDate, index * 7);
  if (weekIndex !== index || weekStart !== start) throw new RangeError("Invalid partial week cursor");
  return calendar;
}

// Periods are [start, end). Upcoming event dates must have been consumed at the current cursor.
export function nextBoundary(calendar, eventDates = []) {
  validateCalendar(calendar);
  if (!Array.isArray(eventDates)) throw new TypeError("Expected event dates");
  for (const date of eventDates) {
    dayNumber(date);
    if (date <= calendar.currentDate) throw new RangeError("Event must be after current cursor");
  }
  if (calendar.currentDate === calendar.endDate) return null;
  const candidates = [];
  if (daysBetween(calendar.weekStart, calendar.endDate) >= 7)
    candidates.push([addDays(calendar.weekStart, 7), "week"]);
  if (calendar.currentDate.slice(0, 7) !== calendar.endDate.slice(0, 7))
    candidates.push([addMonths(`${calendar.currentDate.slice(0, 7)}-01`, 1), "month"]);
  candidates.push([calendar.endDate, "end"], ...eventDates.map(date => [date, "event"]));
  const date = candidates.map(([value]) => value).sort()[0];
  return { date, kinds: [...new Set(candidates.filter(([value]) => value === date).map(([, kind]) => kind))] };
}

export function advanceCalendar(calendar, eventDates = []) {
  const boundary = nextBoundary(calendar, eventDates);
  if (!boundary) return { calendar: { ...calendar }, boundary: null, completedWeek: null };
  const closesWeek = boundary.kinds.includes("week") || boundary.kinds.includes("end");
  const completedWeek = closesWeek ? {
    weekIndex: calendar.weekIndex, startDate: calendar.weekStart, endDate: boundary.date,
    partial: daysBetween(calendar.weekStart, boundary.date) < 7,
  } : null;
  return { boundary, completedWeek, calendar: {
    ...calendar, currentDate: boundary.date,
    weekStart: closesWeek ? boundary.date : calendar.weekStart,
    weekIndex: calendar.weekIndex + Number(closesWeek),
  } };
}
