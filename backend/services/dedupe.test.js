const test = require('node:test');
const assert = require('node:assert/strict');

const supa = require('./supabase');
const { loadHistory, markPosted } = require('./newsScraper');

const ONE = Object.freeze({ slug: 'shadesofirony', handle: '@shadesofirony', igUserId: '17841400000000000' });
const TWO = Object.freeze({ slug: 'second', handle: '@second', igUserId: '17841400000000001' });

// Records every query so a test can assert what was actually sent, which is the
// whole point here: an unscoped read or delete is invisible in its return value.
function makeDb(cfg = {}) {
  const log = { selects: [], upserts: [], deletes: [] };

  function builder(table) {
    const q = { table, filters: {}, cols: null, ordered: null };
    q.select = (cols) => { q.cols = cols; return q; };
    q.eq = (c, v) => { q.filters[c] = v; return q; };
    q.order = (c, o) => { q.ordered = [c, o]; return q; };
    q.delete = () => q;
    q.in = (col, ids) => {
      log.deletes.push({ table, col, ids, filters: { ...q.filters } });
      return Promise.resolve({ error: null });
    };
    q.upsert = async (payload, opts) => {
      log.upserts.push({ table, payload, opts });
      return { error: cfg.upsertError || null };
    };
    // Thenable, so `await db.from(...).select(...).eq(...)` resolves.
    q.then = (resolve, reject) => {
      log.selects.push({ table, cols: q.cols, filters: { ...q.filters }, ordered: q.ordered });
      const out = cfg.resolve ? cfg.resolve(q) : { data: [], error: null };
      return Promise.resolve(out).then(resolve, reject);
    };
    return q;
  }

  return { from: (t) => builder(t), _log: log };
}

test.afterEach(() => supa.__reset());

test('history reads are scoped to the account', async () => {
  const db = makeDb({
    resolve: (q) => ({
      data: q.filters.account === 'shadesofirony'
        ? [{ url: 'https://a' }, { url: 'https://b' }]
        : [{ url: 'https://c' }],
      error: null,
    }),
  });
  supa.__setClient(db);

  const one = await loadHistory(ONE);
  const two = await loadHistory(TWO);

  assert.deepEqual([...one].sort(), ['https://a', 'https://b']);
  assert.deepEqual([...two], ['https://c']);
  assert.equal(db._log.selects[0].filters.account, 'shadesofirony');
  assert.equal(db._log.selects[1].filters.account, 'second');
});

test('a story one account posted is not hidden from another', async () => {
  // The behaviour the unique (account, url) index exists to allow.
  const db = makeDb({ resolve: (q) => ({ data: q.filters.account === 'shadesofirony' ? [{ url: 'https://shared' }] : [], error: null }) });
  supa.__setClient(db);

  assert.ok((await loadHistory(ONE)).has('https://shared'));
  assert.ok(!(await loadHistory(TWO)).has('https://shared'));
});

test('a failed history read throws instead of reading as empty', async () => {
  // An empty set here means "nothing posted yet" and invites republishing a
  // story. An Instagram post cannot be edited or quietly removed.
  supa.__setClient(makeDb({ resolve: () => ({ data: null, error: { message: 'permission denied for table posted_urls' } }) }));
  await assert.rejects(() => loadHistory(ONE), /would republish stories/);
});

test('both entry points refuse to run unscoped', async () => {
  supa.__setClient(makeDb());
  await assert.rejects(() => loadHistory(), /requires an account/);
  await assert.rejects(() => markPosted('https://x'), /requires an account/);
});

test('a posted url is written against its account, keyed on (account, url)', async () => {
  const db = makeDb({ resolve: () => ({ data: [], error: null }) });
  supa.__setClient(db);

  await markPosted('https://story', TWO);

  const [write] = db._log.upserts;
  assert.equal(write.payload.account, 'second');
  assert.equal(write.payload.url, 'https://story');
  assert.equal(write.opts.onConflict, 'account,url');
});

test('retention counts and deletes only this account rows', async () => {
  // 104 rows for this account. One busy account must not evict another's memory.
  const rows = Array.from({ length: 104 }, (_, i) => ({ id: i + 1 }));
  const db = makeDb({ resolve: (q) => (q.cols === 'id' ? { data: rows, error: null } : { data: [], error: null }) });
  supa.__setClient(db);

  await markPosted('https://story', ONE);

  const retentionRead = db._log.selects.find((s) => s.cols === 'id');
  assert.equal(retentionRead.filters.account, 'shadesofirony', 'the count must be per account');

  const [del] = db._log.deletes;
  assert.deepEqual(del.ids, [1, 2, 3, 4], 'only the four oldest beyond the cap');
  assert.equal(del.filters.account, 'shadesofirony', 'the delete carries the scope too');
});

test('retention leaves an account under the cap alone', async () => {
  const rows = Array.from({ length: 100 }, (_, i) => ({ id: i + 1 }));
  const db = makeDb({ resolve: (q) => (q.cols === 'id' ? { data: rows, error: null } : { data: [], error: null }) });
  supa.__setClient(db);

  await markPosted('https://story', ONE);
  assert.equal(db._log.deletes.length, 0);
});

test('a failed write stops before retention runs', async () => {
  // The carousel is already on Instagram but the URL is not recorded, so the
  // story can be picked again. Trimming the oldest rows on top of that discards
  // memory still doing its job and widens the window for a repost.
  const rows = Array.from({ length: 104 }, (_, i) => ({ id: i + 1 }));
  const db = makeDb({
    upsertError: { message: 'duplicate key value violates constraint' },
    resolve: (q) => (q.cols === 'id' ? { data: rows, error: null } : { data: [], error: null }),
  });
  supa.__setClient(db);

  const out = await markPosted('https://story', ONE);

  assert.equal(out.ok, false);
  assert.equal(db._log.selects.filter((s) => s.cols === 'id').length, 0, 'no retention read');
  assert.equal(db._log.deletes.length, 0, 'and nothing deleted');
});

test('a retention read failure does not take the whole write down', async () => {
  // The url is already recorded by then; failing here would lose that.
  const db = makeDb({
    resolve: (q) => (q.cols === 'id'
      ? { data: null, error: { message: 'timeout' } }
      : { data: [], error: null }),
  });
  supa.__setClient(db);

  await markPosted('https://story', ONE);
  assert.equal(db._log.upserts.length, 1);
  assert.equal(db._log.deletes.length, 0);
});

test('with no database configured marking is skipped, not fatal', async () => {
  supa.__setClient(null, false);
  await markPosted('https://story', ONE);
  assert.deepEqual([...(await loadHistory(ONE))], []);
});
