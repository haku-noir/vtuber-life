import test from "node:test";
import assert from "node:assert/strict";
import { dayNumber, addDays, addMonths, daysBetween, createCalendar, nextBoundary, advanceCalendar, validateCalendar } from "../src/calendar.js";

test("AT23 foundation: Gregorian leap dates and month-end clamping", () => {
  assert.equal(addDays("2020-02-28", 1), "2020-02-29");
  assert.equal(addDays("2020-02-28", 2), "2020-03-01");
  assert.equal(addDays("2100-02-28", 1), "2100-03-01");
  assert.equal(addDays("2000-02-28", 1), "2000-02-29");
  assert.equal(addMonths("2020-01-31", 1), "2020-02-29");
  assert.equal(addMonths("2020-02-29", 12), "2021-02-28");
  assert.equal(addMonths("2020-01-31", 2), "2020-03-31");
  assert.equal(addDays("2020-12-31", 1), "2021-01-01");
  let upper = createCalendar("9999-11-30", 1);
  while (upper.currentDate < upper.endDate) upper = advanceCalendar(upper).calendar;
  assert.equal(upper.currentDate, "9999-12-30");
  for (const date of ["2021-02-29", "2020-04-31", "2020-00-01", "0000-01-01", "2020-1-01", "2020-01-01T00:00:00Z"])
    assert.throws(() => dayNumber(date));
});

test("AT06/AT23 foundation: month and event boundaries split a continuous seven-day week", () => {
  let calendar = createCalendar("2020-01-29", 180);
  const original = { ...calendar };
  let result = advanceCalendar(calendar, ["2020-01-31"]);
  assert.deepEqual(result.boundary, { date: "2020-01-31", kinds: ["event"] });
  assert.equal(result.completedWeek, null);
  assert.deepEqual(calendar, original);
  calendar = result.calendar;
  result = advanceCalendar(calendar);
  assert.deepEqual(result.boundary, { date: "2020-02-01", kinds: ["month"] });
  assert.equal(result.calendar.weekStart, "2020-01-29");
  result = advanceCalendar(result.calendar);
  assert.deepEqual(result.completedWeek, { weekIndex: 0, startDate: "2020-01-29", endDate: "2020-02-05", partial: false });
  assert.throws(() => nextBoundary(calendar, [calendar.currentDate]));
  assert.throws(() => validateCalendar({ ...calendar, weekIndex: 1 }));
});

test("AT23 foundation: simultaneous boundaries are emitted together", () => {
  const calendar = createCalendar("2020-01-25", 1);
  assert.deepEqual(nextBoundary(calendar, ["2020-02-01"]), { date: "2020-02-01", kinds: ["week", "month", "event"] });
});

test("AT06/AT23 foundation: 180 calendar months cover every day once including the final short week", () => {
  let calendar = createCalendar("2020-02-29", 180);
  assert.equal(calendar.endDate, "2035-02-28");
  const weeks = [], months = [];
  let segments = 0;
  while (calendar.currentDate < calendar.endDate) {
    const result = advanceCalendar(JSON.parse(JSON.stringify(calendar)));
    assert.ok(++segments < 1100);
    assert.ok(result.boundary.date > calendar.currentDate);
    validateCalendar(result.calendar);
    if (result.completedWeek) weeks.push(result.completedWeek);
    if (result.boundary.kinds.includes("month")) months.push(result.boundary.date);
    calendar = result.calendar;
  }
  assert.equal(months.length, 180);
  assert.equal(weeks[0].startDate, calendar.startDate);
  assert.equal(weeks.at(-1).endDate, calendar.endDate);
  assert.equal(weeks.at(-1).partial, true);
  assert.equal(weeks.reduce((sum, week) => sum + daysBetween(week.startDate, week.endDate), 0), daysBetween(calendar.startDate, calendar.endDate));
  for (let i = 1; i < weeks.length; i++) assert.equal(weeks[i - 1].endDate, weeks[i].startDate);
  assert.notEqual(weeks.length, 52 * 15);
  assert.equal(nextBoundary(calendar), null);
});
