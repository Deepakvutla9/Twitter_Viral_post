const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const { requireApiKey } = require('../middleware/auth');

// The account manager can switch publishing off for a handle, which is the one
// write this API exposes. These cover the shape of that contract — auth, body
// validation, and the promise that a disabled account leaves the publishing
// list — without reaching the database.

function appWith(stub) {
  const path = require.resolve('../services/accounts');
  const real = require.cache[path];
  require.cache[path] = { id: path, filename: path, loaded: true, exports: stub };
  delete require.cache[require.resolve('./accounts')];
  const router = require('./accounts');
  if (real) require.cache[path] = real; else delete require.cache[path];
  delete require.cache[require.resolve('./accounts')];

  const app = express();
  app.use(express.json());
  app.use('/api/accounts', requireApiKey, router);
  return app;
}

async function call(app, path, opts = {}) {
  const srv = app.listen(0);
  try {
    const { port } = srv.address();
    const res = await fetch(`http://127.0.0.1:${port}${path}`, opts);
    return { status: res.status, body: await res.json() };
  } finally {
    srv.close();
  }
}

const KEY = 'test-key';
const headers = { 'x-api-key': KEY, 'content-type': 'application/json' };
const account = (slug, active) => ({
  slug, displayName: slug, handle: `@${slug}`, accent: '#00e5ff',
  cron: '0 */6 * * *', timezone: 'UTC', active, source: 'database',
});

test.beforeEach(() => { process.env.API_KEY = KEY; });

test('the manager listing includes accounts the selector hides', async () => {
  const app = appWith({
    listActiveAccounts: async () => [account('on', true)],
    listAllAccounts: async () => [account('on', true), account('off', false)],
    setAccountActive: async () => {},
  });

  const selector = await call(app, '/api/accounts', { headers });
  assert.deepStrictEqual(selector.body.accounts.map((a) => a.slug), ['on']);

  const manager = await call(app, '/api/accounts?all=1', { headers });
  assert.deepStrictEqual(manager.body.accounts.map((a) => a.slug), ['on', 'off']);
  assert.strictEqual(manager.body.accounts[1].active, false);
});

test('an env-fallback account is reported as unmanaged so no toggle is offered', async () => {
  const app = appWith({
    listActiveAccounts: async () => [],
    listAllAccounts: async () => [{ ...account('legacy', true), source: 'env-fallback' }],
    setAccountActive: async () => {},
  });
  const res = await call(app, '/api/accounts?all=1', { headers });
  assert.strictEqual(res.body.accounts[0].managed, false);
});

test('the toggle writes the requested state', async () => {
  const seen = [];
  const app = appWith({
    listActiveAccounts: async () => [],
    listAllAccounts: async () => [],
    setAccountActive: async (slug, active) => { seen.push([slug, active]); return { slug, active }; },
  });
  const res = await call(app, '/api/accounts/yichi_padesta', {
    method: 'PATCH', headers, body: JSON.stringify({ active: false }),
  });
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(seen, [['yichi_padesta', false]]);
});

test('a non-boolean active is rejected rather than coerced', async () => {
  let called = false;
  const app = appWith({
    listActiveAccounts: async () => [],
    listAllAccounts: async () => [],
    setAccountActive: async () => { called = true; },
  });
  for (const body of ['{"active":"false"}', '{"active":0}', '{}']) {
    const res = await call(app, '/api/accounts/x', { method: 'PATCH', headers, body });
    assert.strictEqual(res.status, 400, `expected 400 for ${body}`);
  }
  assert.strictEqual(called, false, 'a rejected body must never reach the database');
});

test('the toggle is behind the API key', async () => {
  let called = false;
  const app = appWith({
    listActiveAccounts: async () => [],
    listAllAccounts: async () => [],
    setAccountActive: async () => { called = true; },
  });
  const res = await call(app, '/api/accounts/x', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ active: false }),
  });
  assert.strictEqual(res.status, 401);
  assert.strictEqual(called, false);
});

test('a status carried on the error becomes the response status', async () => {
  const app = appWith({
    listActiveAccounts: async () => [],
    listAllAccounts: async () => [],
    setAccountActive: async () => {
      const err = new Error('No account row for "ghost"');
      err.status = 404;
      throw err;
    },
  });
  const res = await call(app, '/api/accounts/ghost', {
    method: 'PATCH', headers, body: JSON.stringify({ active: true }),
  });
  assert.strictEqual(res.status, 404);
});
