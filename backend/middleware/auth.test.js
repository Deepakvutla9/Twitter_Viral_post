const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const ACCOUNTS = [
  { slug: 'shadesofirony', handle: '@shadesofirony', displayName: 'Synthetic Minds', igUserId: '17841400000000000' },
  { slug: 'second', handle: '@second', displayName: 'Second', igUserId: '17841400000000001' },
];

const acctPath = require.resolve('../services/accounts.js');
require.cache[acctPath] = {
  id: acctPath, filename: acctPath, loaded: true,
  exports: {
    getAccount: async () => ACCOUNTS[0],
    listActiveAccounts: async () => ACCOUNTS,
  },
};

const { requireApiKey, withAccount } = require('./auth');

const app = express();
app.use(express.json());
app.get('/open', (req, res) => res.json({ ok: true }));
app.post('/closed', requireApiKey, (req, res) => res.json({ ok: true }));
app.post('/act', requireApiKey, withAccount(async (req, res, account) => res.json({ acted: account.slug })));

let srv;
let base;
const ENV = ['API_KEY', 'API_ACCOUNT_ALLOWLIST'];
let snapshot = {};

test.before(async () => {
  await new Promise((r) => { srv = app.listen(0, r); });
  base = `http://127.0.0.1:${srv.address().port}`;
});
test.after(() => srv.close());

test.beforeEach(() => { snapshot = Object.fromEntries(ENV.map((k) => [k, process.env[k]])); });
test.afterEach(() => {
  for (const k of ENV) {
    if (snapshot[k] === undefined) delete process.env[k];
    else process.env[k] = snapshot[k];
  }
});

const post = (path, { key, body } = {}) => fetch(`${base}${path}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(key ? { 'x-api-key': key } : {}) },
  body: JSON.stringify(body || {}),
});

test('an unset API key closes the route rather than opening it', async () => {
  // These routes publish to Instagram and spend model credit. "Not configured"
  // must never mean "available to everyone".
  delete process.env.API_KEY;
  const res = await post('/closed');
  assert.equal(res.status, 503);
  assert.match((await res.json()).error, /not configured/);
});

test('a missing or wrong key is rejected', async () => {
  process.env.API_KEY = 'correct-horse';
  assert.equal((await post('/closed')).status, 401);
  assert.equal((await post('/closed', { key: 'wrong' })).status, 401);
  assert.equal((await post('/closed', { key: 'correct-hors' })).status, 401, 'a prefix is not enough');
});

test('the right key is accepted, by header or bearer token', async () => {
  process.env.API_KEY = 'correct-horse';
  assert.equal((await post('/closed', { key: 'correct-horse' })).status, 200);

  const res = await fetch(`${base}/closed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', authorization: 'Bearer correct-horse' },
    body: '{}',
  });
  assert.equal(res.status, 200);
});

test('an unauthenticated route is untouched', async () => {
  delete process.env.API_KEY;
  assert.equal((await fetch(`${base}/open`)).status, 200);
});

test('no account named means the default account', async () => {
  process.env.API_KEY = 'k';
  const res = await post('/act', { key: 'k' });
  assert.equal((await res.json()).acted, 'shadesofirony');
});

test('a named account is used when it is active', async () => {
  process.env.API_KEY = 'k';
  const res = await post('/act', { key: 'k', body: { account: 'second' } });
  assert.equal((await res.json()).acted, 'second');
});

test('an unknown account is refused, not silently defaulted', async () => {
  // Falling back to the default here would publish to the wrong handle.
  process.env.API_KEY = 'k';
  const res = await post('/act', { key: 'k', body: { account: 'nope' } });
  assert.equal(res.status, 404);
});

test('the allowlist limits which accounts a key may use', async () => {
  process.env.API_KEY = 'k';
  process.env.API_ACCOUNT_ALLOWLIST = 'shadesofirony';

  assert.equal((await post('/act', { key: 'k', body: { account: 'shadesofirony' } })).status, 200);
  const denied = await post('/act', { key: 'k', body: { account: 'second' } });
  assert.equal(denied.status, 403);
  assert.match((await denied.json()).error, /not permitted/);
});

test('an empty allowlist means every active account, not none', async () => {
  process.env.API_KEY = 'k';
  process.env.API_ACCOUNT_ALLOWLIST = '   ';
  assert.equal((await post('/act', { key: 'k', body: { account: 'second' } })).status, 200);
});

test('choosing an account still requires the key', async () => {
  process.env.API_KEY = 'k';
  assert.equal((await post('/act', { body: { account: 'second' } })).status, 401);
});

// ── the wiring, not just the middleware ─────────────────────────────────────

const fs = require('fs');
const path = require('path');

test('every publishing or spending router is mounted behind the key', () => {
  // The middleware is only protection if it is actually attached. A new route
  // added without it would pass every test above and still be wide open.
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const mounts = [...server.matchAll(/app\.use\('(\/api\/[^']+)'([^)]*)\)/g)]
    .map((m) => ({ route: m[1], rest: m[2] }));

  const mustBeClosed = [
    '/api/scrape', '/api/generate', '/api/generate-custom',
    '/api/instagram', '/api/trending', '/api/queue', '/api/accounts',
  ];

  for (const route of mustBeClosed) {
    const mount = mounts.find((m) => m.route === route);
    assert.ok(mount, `${route} should be mounted`);
    assert.match(mount.rest, /requireApiKey/, `${route} must be mounted behind requireApiKey`);
  }
});

test('the scheduler router is mounted open, and guards itself instead', () => {
  // /status is polled by the scheduled workflow and /trigger carries its own
  // secret, so the router cannot sit behind the API key wholesale — the routes
  // a person drives apply it individually.
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(server, /app\.use\('\/api\/scheduler', schedulerRoutes\)/);

  const routes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'scheduler.js'), 'utf8');
  for (const guarded of ['/start', '/stop', '/run']) {
    const line = routes.split('\n').find((l) => l.includes(`router.post('${guarded}'`));
    assert.ok(line, `${guarded} should exist`);
    assert.match(line, /requireApiKey/, `${guarded} must require the key`);
  }
  const triggerLine = routes.split('\n').find((l) => l.includes("router.post('/trigger'"));
  assert.ok(triggerLine, 'the trigger route should exist');
  assert.ok(
    !triggerLine.includes('requireApiKey'),
    'the trigger keeps its own secret rather than the API key',
  );
});
