const test = require('node:test');
const assert = require('node:assert/strict');

// Stub the two modules maintenance drives, before requiring it.
let accounts = [];
let listError = null;
let checkBySlug = {};
let refreshBySlug = {};
const refreshed = [];

const stubs = {
  './accounts.js': {
    listActiveAccounts: async () => {
      if (listError) throw listError;
      return accounts;
    },
  },
  './instagram.js': {
    checkToken: async (a) => {
      const behaviour = checkBySlug[a.slug];
      if (typeof behaviour === 'function') return behaviour(a);
      return behaviour || { ok: true, username: a.slug };
    },
    refreshToken: async (a) => {
      const behaviour = refreshBySlug[a.slug];
      if (typeof behaviour === 'function') return behaviour(a);
      refreshed.push(a.slug);
      return behaviour || { ok: true };
    },
  },
};
for (const [rel, exports] of Object.entries(stubs)) {
  const p = require.resolve(rel);
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
}

const { keepTokensFresh } = require('./tokenMaintenance');

const acct = (slug) => ({ slug, handle: `@${slug}`, igUserId: '17841400000000000' });

test.beforeEach(() => {
  accounts = [];
  listError = null;
  checkBySlug = {};
  refreshBySlug = {};
  refreshed.length = 0;
});

test('refreshes every active account', async () => {
  accounts = [acct('one'), acct('two')];
  const summary = await keepTokensFresh();
  assert.deepEqual(refreshed, ['one', 'two']);
  assert.equal(summary.refreshed, 2);
});

test('a thrown storage error on one account does not stop the rest', async () => {
  // refreshToken throws rather than returning ok:false when the token cannot be
  // stored. Without a per-account catch that ends maintenance for everyone after it.
  accounts = [acct('one'), acct('two'), acct('three')];
  refreshBySlug.one = () => { throw new Error('could not be stored: permission denied'); };

  const summary = await keepTokensFresh();

  assert.deepEqual(refreshed, ['two', 'three'], 'later accounts must still run');
  assert.equal(summary.failed, 1);
  assert.equal(summary.refreshed, 2);
});

test('a thrown check error also stays contained', async () => {
  accounts = [acct('one'), acct('two')];
  checkBySlug.one = () => { throw new Error('network exploded'); };

  const summary = await keepTokensFresh();

  assert.deepEqual(refreshed, ['two']);
  assert.equal(summary.failed, 1);
});

test('an unhealthy token is reported without ending the sweep', async () => {
  accounts = [acct('one'), acct('two')];
  checkBySlug.one = { ok: false, error: 'expired' };

  const summary = await keepTokensFresh();

  assert.deepEqual(refreshed, ['two']);
  assert.equal(summary.failed, 1);
  assert.equal(summary.ok, 1);
});

test('a failure listing accounts is reported, not thrown', async () => {
  listError = new Error('permission denied for table accounts');
  const summary = await keepTokensFresh();
  assert.equal(summary.accounts, 0);
  assert.equal(summary.failed, 1);
});
