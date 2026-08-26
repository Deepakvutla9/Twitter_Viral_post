const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

// Stub the Instagram service so the health-check test never calls the real
// Graph API and can never post.
const svcPath = require.resolve('../services/instagram.js');
let tokenResult = { ok: true, id: '1', username: 'stub', account_type: 'MEDIA_CREATOR' };
require.cache[svcPath] = {
  id: svcPath, filename: svcPath, loaded: true,
  exports: {
    postCarousel: async () => { throw new Error('must not post during tests'); },
    checkToken: async () => tokenResult,
  },
};

// The route resolves an account before it can check anything, so stub that too.
const acctPath = require.resolve('../services/accounts.js');
require.cache[acctPath] = {
  id: acctPath, filename: acctPath, loaded: true,
  exports: {
    getAccount: async () => ({
      slug: 'shadesofirony', handle: '@shadesofirony', igUserId: '17841400000000000',
    }),
  },
};

const router = require('./instagram');
const app = express();
app.use(express.json());
app.use('/api/instagram', router);

let srv, base;
test.before(async () => {
  await new Promise((r) => { srv = app.listen(0, r); });
  base = `http://127.0.0.1:${srv.address().port}/api/instagram`;
});
test.after(() => srv.close());

test('reports 200 and the handle when the token is healthy', async () => {
  tokenResult = { ok: true, id: '1', username: 'shadesofirony', account_type: 'MEDIA_CREATOR' };
  const res = await fetch(`${base}/token`);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).username, 'shadesofirony');
});

test('reports 502 and the reason when the token is bad', async () => {
  tokenResult = { ok: false, error: 'Instagram access token is expired or invalid (token check)' };
  const res = await fetch(`${base}/token`);
  assert.equal(res.status, 502);
  assert.match((await res.json()).error, /expired or invalid/);
});
