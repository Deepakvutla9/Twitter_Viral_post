// Does a cron expression fire at a given moment, in a given timezone?
//
// node-cron schedules jobs but cannot answer that question, and fan-out needs
// it: without it every active account posts in every slot regardless of the
// schedule it was configured with, which makes accounts.cron and
// accounts.timezone decorative.
//
// Supports the ordinary five fields — minute hour day-of-month month day-of-week
// — with *, */n, a-b, a-b/n, comma lists and plain numbers. That is the whole
// syntax node-cron accepts for these fields apart from names, which are handled
// for day-of-week and month.

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

const FIELDS = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'dayOfMonth', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12, names: MONTHS, nameOffset: 1 },
  // max 7 because cron accepts both 0 and 7 for Sunday; 7 is normalized to 0
  // after parsing. Rejecting it at parse time would make "* * * * 7" unparseable,
  // and an unparseable schedule is never due.
  { name: 'dayOfWeek', min: 0, max: 7, names: DAYS, nameOffset: 0 },
];

function toNumber(token, field) {
  const raw = String(token).trim().toLowerCase();
  if (field.names) {
    const idx = field.names.indexOf(raw.slice(0, 3));
    if (idx !== -1) return idx + field.nameOffset;
  }
  if (!/^\d+$/.test(raw)) return NaN;
  return Number(raw);
}

// Returns a Set of matching values, or null if the field cannot be parsed.
function parseField(spec, field) {
  const out = new Set();

  for (const part of String(spec).split(',')) {
    const piece = part.trim();
    if (!piece) return null;

    const [rangePart, stepPart] = piece.split('/');
    let step = 1;
    if (stepPart !== undefined) {
      if (!/^\d+$/.test(stepPart) || Number(stepPart) === 0) return null;
      step = Number(stepPart);
    }

    let start;
    let end;
    if (rangePart === '*') {
      start = field.min;
      end = field.max;
    } else if (rangePart.includes('-')) {
      const [a, b] = rangePart.split('-');
      start = toNumber(a, field);
      end = toNumber(b, field);
    } else {
      start = toNumber(rangePart, field);
      end = stepPart === undefined ? start : field.max;
    }

    if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
    if (start < field.min || end > field.max || start > end) return null;

    for (let v = start; v <= end; v += step) out.add(v);
  }

  return out.size ? out : null;
}

function parseCron(expr) {
  const parts = String(expr || '').trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const sets = [];
  for (let i = 0; i < 5; i += 1) {
    const set = parseField(parts[i], FIELDS[i]);
    if (!set) return null;
    // Cron treats both 0 and 7 as Sunday. Normalized to 0 so the set holds seven
    // distinct days and the "is this field restricted" check below stays honest.
    if (FIELDS[i].name === 'dayOfWeek' && set.has(7)) { set.add(0); set.delete(7); }
    sets.push(set);
  }
  return sets;
}

const formatters = new Map();
function formatterFor(timeZone) {
  let fmt = formatters.get(timeZone);
  if (!fmt) { fmt = buildFormatter(timeZone); formatters.set(timeZone, fmt); }
  return fmt;
}

// Wall-clock fields for an instant, as the account's own timezone sees them.
function buildFormatter(timeZone) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    weekday: 'short',
  });
}

function zonedParts(date, timeZone) {
  const parts = Object.fromEntries(formatterFor(timeZone).formatToParts(date).map((p) => [p.type, p.value]));
  return {
    minute: Number(parts.minute),
    hour: Number(parts.hour),
    dayOfMonth: Number(parts.day),
    month: Number(parts.month),
    dayOfWeek: DAYS.indexOf(String(parts.weekday).slice(0, 3).toLowerCase()),
  };
}

function matchesSets(sets, p) {
  const [minute, hour, dom, month, dow] = sets;
  if (!minute.has(p.minute) || !hour.has(p.hour) || !month.has(p.month)) return false;

  // Standard cron quirk: when both day fields are restricted, either matching is
  // enough. When only one is restricted, that one must match.
  const domRestricted = dom.size !== 31;
  const dowRestricted = dow.size < 7;
  if (domRestricted && dowRestricted) return dom.has(p.dayOfMonth) || dow.has(p.dayOfWeek);
  if (domRestricted) return dom.has(p.dayOfMonth);
  if (dowRestricted) return dow.has(p.dayOfWeek);
  return true;
}

function matchesAt(expr, date, timeZone = 'UTC') {
  const sets = parseCron(expr);
  if (!sets) return false;
  return matchesSets(sets, zonedParts(date, timeZone));
}

/**
 * Did this expression fire at any point in the last `windowMinutes`?
 *
 * A trigger rarely arrives exactly on the minute — GitHub Actions schedules
 * drift by several minutes under load, and a sleeping instance adds its own
 * wake-up delay. Matching only the current minute would drop those slots
 * silently, which looks exactly like the account being broken.
 */
function isDueWithin(expr, { timeZone = 'UTC', now = new Date(), windowMinutes = 30 } = {}) {
  const sets = parseCron(expr);
  if (!sets) return false;
  const window = Number.isFinite(windowMinutes) ? Math.max(0, Math.min(windowMinutes, 24 * 60)) : 0;
  for (let back = 0; back <= window; back += 1) {
    if (matchesSets(sets, zonedParts(new Date(now.getTime() - back * 60000), timeZone))) return true;
  }
  return false;
}

/**
 * The most recent moment a trigger schedule fired, at or before `now`.
 *
 * This is what a late trigger needs to know. GitHub Actions delivers a schedule
 * anywhere from half an hour to nearly five hours after the minute it names, and
 * a run that only asks "is anything due right now" answers no every time — the
 * slot it was sent for is long past. Asking instead "which slot was this sent
 * for" turns lateness into a detail rather than a silent skip.
 *
 * Trigger schedules are evaluated in UTC because that is what GitHub uses.
 * Returns null when nothing fired inside the lookback, which for a schedule
 * rarer than the window is a real answer: there is no slot to attribute this
 * run to.
 */
function latestFiring(exprs, now = new Date(), { maxLookbackMinutes = 48 * 60, timeZone = 'UTC' } = {}) {
  const list = (Array.isArray(exprs) ? exprs : [exprs]).map(parseCron).filter(Boolean);
  if (!list.length) return null;

  for (let back = 0; back <= maxLookbackMinutes; back += 1) {
    const at = new Date(now.getTime() - back * 60000);
    const parts = zonedParts(at, timeZone);
    if (list.some((sets) => matchesSets(sets, parts))) {
      // Truncated to the minute: the firing is the minute, not the instant
      // inside it that this search happened to land on.
      return new Date(Math.floor(at.getTime() / 60000) * 60000);
    }
  }
  return null;
}

/**
 * The longest gap between consecutive firings of a trigger schedule.
 *
 * Reachability asks whether an account's own schedule can ever coincide with a
 * trigger. Once a trigger covers everything that came due since the previous
 * one, "coincide" means "falls in the gap", so the gap is the window that
 * question has to be asked over. Scanning a fortnight covers daily and weekly
 * shapes; anything rarer falls back to a day, which only ever understates the
 * window and so never invents an unreachable account.
 */
function maxFiringGapMinutes(exprs, { now = new Date(), days = 14 } = {}) {
  const list = (Array.isArray(exprs) ? exprs : [exprs]).map(parseCron).filter(Boolean);
  if (!list.length) return 24 * 60;

  let previous = null;
  let widest = 0;
  const minutes = days * 24 * 60;
  const start = new Date(Math.floor(now.getTime() / 60000) * 60000);

  for (let ahead = 0; ahead <= minutes; ahead += 1) {
    const at = new Date(start.getTime() + ahead * 60000);
    const parts = zonedParts(at, 'UTC');
    if (!list.some((sets) => matchesSets(sets, parts))) continue;
    if (previous !== null) widest = Math.max(widest, ahead - previous);
    previous = ahead;
  }

  return widest > 0 ? Math.min(widest, 24 * 60) : 24 * 60;
}

// Reachability is stable for a given configuration, so it is computed once a
// day per (schedule, zone, trigger) rather than on every fan-out.
const reachabilityMemo = new Map();

// Days in the Gregorian cycle, after which weekdays and calendar dates repeat
// their alignment exactly.
const GREGORIAN_CYCLE_DAYS = 146097;
// Every calendar date recurs annually except 29 February, and the longest gap
// between two of those is eight years across a non-leap century — 2096 to 2104.
// Four years looks sufficient and is not: from March 2099 it misses 2104.
const CALENDAR_CYCLE_DAYS = 366 * 9;
// Nothing calendar-bound left to wait for; a year is generous.
const PLAIN_CYCLE_DAYS = 366 + 1;

const restrictsDayOfWeek = (sets) => sets[4].size < 7;
const restrictsCalendar = (sets) => sets[2].size !== 31 || sets[3].size !== 12;

/**
 * How far ahead a negative result has to look before it means anything.
 *
 * Three cases, each with a different answer:
 *
 *   - "29 February" and "a Monday" only realign on the 400-year Gregorian
 *     cycle. 29 February 2044 is a Monday and the next is decades further on.
 *   - Calendar dates alone recur annually, except 29 February, which can be
 *     eight years away across a non-leap century.
 *   - Times of day recur daily, so there is nothing to wait for.
 *
 * The instant budget still bounds the actual work; this only decides how long a
 * search has to run before its silence counts as an answer.
 */
function requiredHorizonDays(accountSets, triggerSetsList) {
  const dow = restrictsDayOfWeek(accountSets) || triggerSetsList.some(restrictsDayOfWeek);
  const cal = restrictsCalendar(accountSets) || triggerSetsList.some(restrictsCalendar);
  if (dow && cal) return GREGORIAN_CYCLE_DAYS;
  if (cal) return CALENDAR_CYCLE_DAYS;
  return PLAIN_CYCLE_DAYS;
}

// Enumerated rather than scanned minute by minute: a year holds 525,600 minutes
// but only a few thousand trigger instants, and a monthly schedule needs the
// year. GitHub Actions cron is UTC, so these are built in UTC directly.
function* triggerInstants(sets, startMs, days, budget) {
  const [minutes, hours, dom, month, dow] = sets;
  const start = new Date(startMs);

  for (let d = 0; d <= days; d += 1) {
    const day = new Date(Date.UTC(
      start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + d,
    ));
    const M = day.getUTCMonth() + 1;
    if (!month.has(M)) continue;

    const domRestricted = dom.size !== 31;
    const dowRestricted = dow.size < 7;
    const dayOk = domRestricted && dowRestricted
      ? dom.has(day.getUTCDate()) || dow.has(day.getUTCDay())
      : domRestricted ? dom.has(day.getUTCDate())
        : dowRestricted ? dow.has(day.getUTCDay())
          : true;
    if (!dayOk) continue;

    for (const h of hours) {
      for (const mi of minutes) {
        const t = new Date(Date.UTC(
          day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), h, mi,
        ));
        if (t.getTime() < startMs) continue;
        if (budget.left <= 0) { budget.exhausted = true; return; }
        budget.left -= 1;
        yield t;
      }
    }
  }
}

/**
 * Could this schedule ever actually run?
 *
 * Fan-out only happens when something invokes it, and in production that is the
 * external trigger on its own fixed schedule. An account asking for 09:00 daily
 * on a deployment that only wakes at 00/06/12/18 is not "not due yet" — it can
 * never be due, and would look like a working account that silently never posts.
 *
 * Scans a year of trigger instants, which covers every daily, weekly and monthly
 * pattern the parser accepts. A schedule rarer than annual (29 February, say)
 * can still be reported unreachable; that is a known limit of the horizon rather
 * than a claim about the schedule.
 *
 * triggerCron may be a list, because a workflow can declare several schedules.
 */
function searchReachability(expr, {
  timeZone = 'UTC', triggerCron = '0 */6 * * *',
  windowMinutes = 30, now = new Date(),
  days = null,
  maxInstants = 200000,
} = {}) {
  const accountSets = parseCron(expr);
  // An expression the parser rejects never runs, and that is a complete answer:
  // accounts.js refuses it at configuration time for the same reason.
  if (!accountSets) return { reachable: false, exhaustive: true };

  const triggers = (Array.isArray(triggerCron) ? triggerCron : [triggerCron])
    .map(parseCron)
    .filter(Boolean);
  // Nothing readable to compare against, so nothing is proven either way.
  if (!triggers.length) return { reachable: false, exhaustive: false };

  const horizon = days ?? requiredHorizonDays(accountSets, triggers);
  const window = Math.max(0, Math.min(windowMinutes, 24 * 60));
  const key = [expr, timeZone, JSON.stringify(triggerCron), window, horizon, maxInstants,
    Math.floor(now.getTime() / 86400000)].join('|');
  if (reachabilityMemo.has(key)) return reachabilityMemo.get(key);

  const accountMinutes = accountSets[0];
  const budget = { left: maxInstants, exhausted: false };
  let found = false;

  outer:
  for (const sets of triggers) {
    for (const t of triggerInstants(sets, now.getTime(), horizon, budget)) {
      // One zoned lookup per instant. Whole-minute offsets mean the local minute
      // at t-back is simply (localMinute - back) mod 60, so only the offsets
      // that could match the account's minute field are worth resolving.
      const localMinute = zonedParts(t, timeZone).minute;
      for (let back = 0; back <= window; back += 1) {
        const m = (((localMinute - back) % 60) + 60) % 60;
        if (!accountMinutes.has(m)) continue;
        if (matchesSets(accountSets, zonedParts(new Date(t.getTime() - back * 60000), timeZone))) {
          found = true;
          break outer;
        }
      }
    }
  }

  // Finding it is always conclusive. Not finding it is only conclusive if the
  // whole horizon was actually searched -- an exhausted budget means "did not
  // find it in the time available", which is not the same claim at all.
  const out = { reachable: found, exhaustive: found || !budget.exhausted };
  reachabilityMemo.set(key, out);
  return out;
}

/**
 * Could this schedule ever actually run?
 *
 * Fan-out only happens when something invokes it, and in production that is the
 * external trigger on its own fixed schedule. An account asking for 09:00 daily
 * on a deployment that only wakes at 00/06/12/18 is not "not due yet" — it can
 * never be due, and would look like a working account that silently never posts.
 *
 * Returns false ONLY when the search completed and found nothing. An exhausted
 * budget reports true, because an unproven verdict must not be reported as a
 * broken account; callers wanting to tell the two apart use searchReachability.
 */
function isReachable(expr, opts = {}) {
  const { reachable, exhaustive } = searchReachability(expr, opts);
  return reachable || !exhaustive;
}

module.exports = { parseCron, matchesAt, isDueWithin, latestFiring, maxFiringGapMinutes, isReachable, searchReachability, requiredHorizonDays, zonedParts, __clearReachabilityMemo: () => reachabilityMemo.clear() };
