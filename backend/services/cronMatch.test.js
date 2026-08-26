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

const { isReachable } = require('./cronMatch');

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
