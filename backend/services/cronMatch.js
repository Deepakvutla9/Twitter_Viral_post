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

// Wall-clock fields for an instant, as the account's own timezone sees them.
function zonedParts(date, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    weekday: 'short',
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  return {
    minute: Number(parts.minute),
    hour: Number(parts.hour),
    dayOfMonth: Number(parts.day),
    month: Number(parts.month),
    dayOfWeek: DAYS.indexOf(String(parts.weekday).slice(0, 3).toLowerCase()),
  };
}

function matchesAt(expr, date, timeZone = 'UTC') {
  const sets = parseCron(expr);
  if (!sets) return false;
  const p = zonedParts(date, timeZone);

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

/**
 * Did this expression fire at any point in the last `windowMinutes`?
 *
 * A trigger rarely arrives exactly on the minute — GitHub Actions schedules
 * drift by several minutes under load, and a sleeping instance adds its own
 * wake-up delay. Matching only the current minute would drop those slots
 * silently, which looks exactly like the account being broken.
 */
function isDueWithin(expr, { timeZone = 'UTC', now = new Date(), windowMinutes = 30 } = {}) {
  if (!parseCron(expr)) return false;
  for (let back = 0; back <= windowMinutes; back += 1) {
    if (matchesAt(expr, new Date(now.getTime() - back * 60000), timeZone)) return true;
  }
  return false;
}

module.exports = { parseCron, matchesAt, isDueWithin, zonedParts };
