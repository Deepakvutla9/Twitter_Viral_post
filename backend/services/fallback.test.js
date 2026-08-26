const test = require('node:test');
const assert = require('node:assert/strict');

// Every outbound call returns nothing, which is what drives the trending path
// into its RSS fallback — the branch where the account used to be dropped.
const axiosPath = require.resolve('axios');
require.cache[axiosPath] = {
  id: axiosPath, filename: axiosPath, loaded: true,
  exports: {
    get: async () => ({ data: [] }),
    post: async () => ({ data: {} }),
  },
};

const supa = require('./supabase');
const { fetchTrendingArticle } = require('./newsScraper');

// This test is about the account surviving the fallback, not overlap policy.
process.env.CROSS_ACCOUNT_COOLDOWN_HOURS = '0';

const ONE = Object.freeze({ slug: 'shadesofirony', handle: '@shadesofirony', igUserId: '17841400000000000' });

function makeDb() {
  const selects = [];
  function builder() {
    const q = { filters: {}, cols: null };
    q.select = (cols) => { q.cols = cols; return q; };
    q.eq = (c, v) => { q.filters[c] = v; return q; };
    q.neq = (c, v) => { q.filters[`neq:${c}`] = v; return q; };
    q.gte = (c, v) => { q.filters[`gte:${c}`] = v; return q; };
    q.order = () => q;
    q.then = (resolve, reject) => {
      selects.push({ cols: q.cols, filters: { ...q.filters } });
      return Promise.resolve({ data: [], error: null }).then(resolve, reject);
    };
    return q;
  }
  return { from: () => builder(), _selects: selects };
}

test.afterEach(() => supa.__reset());

test('the trending fallback keeps the account instead of losing it', async () => {
  // Hacker News yields nothing usable, so fetchTrendingArticle hands off to the
  // RSS fallback. That path calls loadHistory again; without the account it
  // threw "requires an account" and the run died rather than falling back.
  const db = makeDb();
  supa.__setClient(db);

  // No feeds resolve either, so the fallback ends in its own "no article"
  // error. That is the expected ending -- what matters is which error.
  await assert.rejects(
    () => fetchTrendingArticle(ONE),
    (e) => {
      assert.doesNotMatch(e.message, /requires an account/, 'the account must survive the fallback');
      return true;
    },
  );

  // Proof the fallback actually reached a scoped history read.
  assert.ok(db._selects.length >= 2, 'history is read on the trending path and again in the fallback');
  for (const s of db._selects) {
    assert.equal(s.filters.account, 'shadesofirony');
  }
});

test('the trending path still refuses to run with no account at all', async () => {
  supa.__setClient(makeDb());
  await assert.rejects(() => fetchTrendingArticle(), /requires an account/);
});
