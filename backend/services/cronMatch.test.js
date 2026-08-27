const test = require('node:test');
const assert = require('node:assert/strict');

const { parseCron, matchesAt, isDueWithin } = require('./cronMatch');

const at = (iso) => new Date(iso);

test('the default schedule fires on its six-hour slots and nowhere else', () => {
  const expr = '0 */6 * * *';
  for (const h of ['00', '06', '12', '18']) {
    assert.ok(matchesAt(expr, at(`2026-08-26T${h}:00:00Z`)), `should fire at ${h}:00`);
  }
  assert.ok(!matchesAt(expr, at('2026-08-26T03:00:00Z')));
  assert.ok(!matchesAt(expr, at('2026-08-26T06:01:00Z')), 'a minute late is not a match');
});

test('lists, ranges and steps parse', () => {
  assert.ok(matchesAt('0 9,18 * * *', at('2026-08-26T09:00:00Z')));
  assert.ok(matchesAt('0 9,18 * * *', at('2026-08-26T18:00:00Z')));
  assert.ok(!matchesAt('0 9,18 * * *', at('2026-08-26T12:00:00Z')));

  assert.ok(matchesAt('30 8-10 * * *', at('2026-08-26T09:30:00Z')));
  assert.ok(!matchesAt('30 8-10 * * *', at('2026-08-26T11:30:00Z')));

  assert.ok(matchesAt('*/15 * * * *', at('2026-08-26T09:45:00Z')));
  assert.ok(!matchesAt('*/15 * * * *', at('2026-08-26T09:46:00Z')));
});

test('day-of-week accepts numbers and names, and treats 7 as Sunday', () => {
  // 2026-08-26 is a Wednesday.
  assert.ok(matchesAt('0 12 * * 3', at('2026-08-26T12:00:00Z')));
  assert.ok(matchesAt('0 12 * * wed', at('2026-08-26T12:00:00Z')));
  assert.ok(!matchesAt('0 12 * * 1', at('2026-08-26T12:00:00Z')));
  assert.ok(matchesAt('0 12 * * 7', at('2026-08-30T12:00:00Z')), 'Sunday as 7');
  assert.ok(matchesAt('0 12 * * 0', at('2026-08-30T12:00:00Z')), 'Sunday as 0');
});

test('the timezone is the account own, not the server', () => {
  // 09:00 in Kolkata is 03:30 UTC.
  const expr = '30 9 * * *';
  assert.ok(matchesAt(expr, at('2026-08-26T04:00:00Z'), 'Asia/Kolkata'));
  assert.ok(!matchesAt(expr, at('2026-08-26T04:00:00Z'), 'UTC'));
  assert.ok(matchesAt('0 4 * * *', at('2026-08-26T04:00:00Z'), 'UTC'));
});

test('a late trigger inside the window still counts as due', () => {
  // Actions schedules drift and a sleeping instance adds its own delay; matching
  // only the exact minute would drop the slot and look like a broken account.
  const opts = (iso) => ({ now: at(iso), windowMinutes: 30 });
  assert.ok(isDueWithin('0 */6 * * *', opts('2026-08-26T12:07:00Z')));
  assert.ok(isDueWithin('0 */6 * * *', opts('2026-08-26T12:29:00Z')));
  assert.ok(!isDueWithin('0 */6 * * *', opts('2026-08-26T12:31:00Z')));
});

test('an unparseable expression is never due, rather than always due', () => {
  // Failing open here would post every account every slot.
  for (const bad of ['', 'every 6 hours', '0 */6 * *', '99 * * * *', '0 */0 * * *', null]) {
    assert.equal(parseCron(bad), null, `${bad} should not parse`);
    assert.equal(isDueWithin(bad, { now: at('2026-08-26T12:00:00Z') }), false);
  }
});

test('both day fields restricted means either may match', () => {
  // Standard cron behaviour: "1st of the month OR a Monday".
  assert.ok(matchesAt('0 12 1 * 1', at('2026-09-01T12:00:00Z')), '1st, a Tuesday');
  assert.ok(matchesAt('0 12 1 * 1', at('2026-08-31T12:00:00Z')), 'a Monday, not the 1st');
  assert.ok(!matchesAt('0 12 1 * 1', at('2026-08-26T12:00:00Z')), 'neither');
});

const { isReachable, searchReachability } = require('./cronMatch');

test('a schedule the trigger never wakes for is unreachable', () => {
  // Production only invokes fan-out at 00/06/12/18 UTC. An account asking for
  // 09:00 daily is not "not due yet" — it can never be due, and would look like
  // a working account that silently never posts.
  const opts = { triggerCron: '0 */6 * * *', windowMinutes: 30, now: at('2026-08-26T00:00:00Z') };
  assert.equal(isReachable('0 9 * * *', opts), false);
  assert.equal(isReachable('0 */6 * * *', opts), true);
  assert.equal(isReachable('0 12 * * *', opts), true, 'daily at a slot time is fine');
});

test('the due window widens what is reachable', () => {
  const base = { triggerCron: '0 */6 * * *', now: at('2026-08-26T00:00:00Z') };
  // 11:45 is 15 minutes before the 12:00 trigger, so a 30-minute window catches it.
  assert.equal(isReachable('45 11 * * *', { ...base, windowMinutes: 30 }), true);
  assert.equal(isReachable('45 11 * * *', { ...base, windowMinutes: 5 }), false);
});

test('reachability is judged in the account own timezone', () => {
  // 17:00 in Kolkata is 11:30 UTC, inside the window before the 12:00 trigger.
  // The same wall-clock time read as UTC is 17:00, a full hour before 18:00 and
  // so out of reach — the zone is the only thing separating the two.
  const base = { triggerCron: '0 */6 * * *', windowMinutes: 30, now: at('2026-08-26T00:00:00Z') };
  assert.equal(isReachable('0 17 * * *', { ...base, timeZone: 'Asia/Kolkata' }), true);
  assert.equal(isReachable('0 17 * * *', { ...base, timeZone: 'UTC' }), false);
});

test('a weekly schedule on a trigger hour is still reachable', () => {
  const opts = { triggerCron: '0 */6 * * *', windowMinutes: 30, now: at('2026-08-26T00:00:00Z') };
  assert.equal(isReachable('0 18 * * 1', opts), true, 'Mondays at 18:00');
});

test('an unreadable trigger schedule does not condemn the account', () => {
  assert.equal(isReachable('0 9 * * *', { triggerCron: 'nonsense', now: at('2026-08-26T00:00:00Z') }), true);
});

test('a monthly schedule is reachable from any point in the month', () => {
  // The horizon used to be seven days, so this returned false from any date
  // more than a week before the 1st — a pure artifact of the scan length.
  const opts = { triggerCron: '0 */6 * * *', windowMinutes: 30 };
  for (const day of ['2026-08-02', '2026-08-15', '2026-08-28']) {
    assert.equal(isReachable('0 0 1 * *', { ...opts, now: at(`${day}T00:00:00Z`) }), true, day);
  }
});

test('a yearly schedule on a trigger hour is reachable', () => {
  const opts = { triggerCron: '0 */6 * * *', windowMinutes: 30, now: at('2026-08-02T00:00:00Z') };
  assert.equal(isReachable('0 12 25 12 *', opts), true, 'noon on 25 December');
  assert.equal(isReachable('0 13 25 12 *', opts), false, '13:00 is never a trigger hour');
});

test('several trigger schedules are all considered', () => {
  const now = at('2026-08-02T00:00:00Z');
  assert.equal(isReachable('0 9 * * *', { triggerCron: '0 */6 * * *', now }), false);
  assert.equal(
    isReachable('0 9 * * *', { triggerCron: ['0 */6 * * *', '0 9 * * *'], now }),
    true,
    'a second workflow schedule makes it reachable',
  );
});

test('reachability finishes quickly enough to run per slot', () => {
  const { __clearReachabilityMemo } = require('./cronMatch');
  __clearReachabilityMemo();
  const started = Date.now();
  // The worst case is an unreachable schedule: it cannot exit early.
  isReachable('0 9 * * *', { triggerCron: '0 */6 * * *', now: at('2026-08-02T00:00:00Z') });
  assert.ok(Date.now() - started < 3000, `took ${Date.now() - started}ms`);
});

test('a leap-day schedule is inside the horizon', () => {
  // 29 February recurs every four years, so a one-year scan called it
  // unreachable — a fact about the scan, not about the schedule.
  const opts = { triggerCron: '0 */6 * * *', windowMinutes: 30, now: at('2026-03-15T00:00:00Z') };
  const out = searchReachability('0 0 29 2 *', opts);
  assert.deepEqual(out, { reachable: true, exhaustive: true });
});

test('an exhausted budget is not the same answer as unreachable', () => {
  // A per-minute trigger blows the instant budget long before an annual
  // schedule comes round. Reporting that as unreachable would fail slots over
  // an account that is perfectly fine.
  const out = searchReachability('0 12 25 12 *', {
    triggerCron: '* * * * *',
    now: at('2026-03-15T00:00:00Z'),
  });
  assert.equal(out.reachable, false);
  assert.equal(out.exhaustive, false, 'the search did not finish');
  assert.equal(
    isReachable('0 12 25 12 *', { triggerCron: '* * * * *', now: at('2026-03-15T00:00:00Z') }),
    true,
    'an unproven verdict must not be reported as a broken account',
  );
});

test('a genuinely unreachable schedule is still reported, exhaustively', () => {
  const out = searchReachability('0 9 * * *', {
    triggerCron: '0 */6 * * *',
    windowMinutes: 30,
    now: at('2026-03-15T00:00:00Z'),
  });
  assert.deepEqual(out, { reachable: false, exhaustive: true });
});

test('an unreadable trigger schedule proves nothing either way', () => {
  const out = searchReachability('0 9 * * *', { triggerCron: 'nonsense', now: at('2026-03-15T00:00:00Z') });
  assert.equal(out.exhaustive, false);
  assert.equal(isReachable('0 9 * * *', { triggerCron: 'nonsense', now: at('2026-03-15T00:00:00Z') }), true);
});

const { requiredHorizonDays } = require('./cronMatch');

test('a weekday trigger and a calendar account need the Gregorian cycle', () => {
  // "29 February" and "a Monday" only realign on the 400-year cycle. A four-year
  // search that finds nothing has proved nothing, so the horizon has to depend
  // on whether the two calendars interact at all.
  const leap = parseCron('0 0 29 2 *');
  const monday = parseCron('0 0 * * 1');
  const sixHourly = parseCron('0 */6 * * *');
  const daily = parseCron('0 9 * * *');

  assert.equal(requiredHorizonDays(leap, [monday]), 146097, 'weekday x calendar');
  assert.ok(requiredHorizonDays(leap, [sixHourly]) >= 366 * 9, 'calendar only, spanning the century gap');
  assert.equal(requiredHorizonDays(daily, [sixHourly]), 367, 'neither');
  assert.equal(requiredHorizonDays(daily, [monday]), 367, 'weekday only');
});

test('a leap-day account on a weekly trigger is found, not condemned', () => {
  // Monday 29 February 2044 satisfies both. A four-year horizon reported this
  // as exhaustively unreachable, which was a false claim rather than a slow one.
  const out = searchReachability('0 0 29 2 *', {
    triggerCron: '0 0 * * 1',
    windowMinutes: 30,
    now: at('2026-03-15T00:00:00Z'),
  });
  assert.deepEqual(out, { reachable: true, exhaustive: true });
});

test('a genuinely impossible weekday-and-calendar pair is still proven', () => {
  // 09:00 can never coincide with a midnight-Monday trigger, and 30 February
  // does not exist. Both are real negatives, and the search says so.
  const opts = { triggerCron: '0 0 * * 1', windowMinutes: 30, now: at('2026-03-15T00:00:00Z') };
  assert.deepEqual(searchReachability('0 9 29 2 *', opts), { reachable: false, exhaustive: true });
  assert.deepEqual(searchReachability('0 0 30 2 *', opts), { reachable: false, exhaustive: true });
});

test('a dense trigger over the long horizon reports unproven, not unreachable', () => {
  // Mondays every five minutes across four centuries exceeds the budget. That
  // is a search that did not finish, not an account that cannot post.
  const out = searchReachability('0 0 29 2 *', {
    triggerCron: '*/5 * * * 1',
    windowMinutes: 30,
    now: at('2026-03-15T00:00:00Z'),
  });
  assert.equal(out.exhaustive, false);
  assert.equal(
    isReachable('0 0 29 2 *', { triggerCron: '*/5 * * * 1', now: at('2026-03-15T00:00:00Z') }),
    true,
  );
});

test('a leap day across a non-leap century is still found', () => {
  // 2100 is not a leap year, so the gap 2096 to 2104 is eight years. A
  // four-year horizon reported the 2104 occurrence as exhaustively impossible.
  const out = searchReachability('0 0 29 2 *', {
    triggerCron: '0 */6 * * *',
    windowMinutes: 30,
    now: at('2099-03-01T00:00:00Z'),
  });
  assert.deepEqual(out, { reachable: true, exhaustive: true });
});

test('the horizon matches what the two schedules actually require', () => {
  const leap = parseCron('0 0 29 2 *');
  const daily = parseCron('0 9 * * *');
  const monday = parseCron('0 0 * * 1');
  const sixHourly = parseCron('0 */6 * * *');

  assert.equal(requiredHorizonDays(leap, [monday]), 146097, 'weekday x calendar');
  assert.ok(requiredHorizonDays(leap, [sixHourly]) >= 366 * 9, 'calendar spans the century gap');
  assert.equal(requiredHorizonDays(daily, [sixHourly]), 367, 'times of day need no wait');
});

test('a calendar negative near a century boundary is still a real negative', () => {
  // 09:00 never coincides with a six-hourly trigger, whatever the year.
  assert.deepEqual(
    searchReachability('0 9 29 2 *', {
      triggerCron: '0 */6 * * *', windowMinutes: 30, now: at('2099-03-01T00:00:00Z'),
    }),
    { reachable: false, exhaustive: true },
  );
});
