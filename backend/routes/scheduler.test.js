const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

// Stub the scheduler service before the router requires it, so hitting the
// trigger endpoint can never fire a real post during tests.
const svcPath = require.resolve('../services/scheduler.js');
let calls = 0;
let nextResult = { success: true, postId: 'STUB', postedAt: new Date().toISOString() };
let lastResult = null;
require.cache[svcPath] = {
  id: svcPath, filename: svcPath, loaded: true,
  exports: {
    runPipeline: async () => { calls++; if (nextResult instanceof Error) throw nextResult; return nextResult; },
    // With no account named the trigger fans out; both paths must be stubbed or
    // the endpoint would reach the real scheduler.
    runAllAccounts: async () => { calls++; if (nextResult instanceof Error) throw nextResult; return nextResult; },
    startScheduler: () => ({}),
    stopScheduler: () => ({}),
    getStatus: () => ({ running: true, lastResult }),
    setLastResult: (r) => { lastResult = r; },
  },
};

const router = require('./scheduler');
const app = express();
app.use(express.json());
app.use('/api/scheduler', router);

let srv, base;
const settle = () => new Promise((r) => setTimeout(r, 50));
const trigger = (secret) => fetch(`${base}/trigger`, {
  method: 'POST',
  headers: secret === undefined ? {} : { 'x-trigger-secret': secret },
});

test.before(async () => {
  await new Promise((r) => { srv = app.listen(0, r); });
  base = `http://127.0.0.1:${srv.address().port}/api/scheduler`;
});
test.after(() => srv.close());

test('refuses to trigger when TRIGGER_SECRET is not configured', async () => {
  delete process.env.TRIGGER_SECRET;
  const res = await trigger('anything');
  assert.equal(res.status, 503);
  assert.equal(calls, 0);
});

test('rejects a wrong or missing secret without running the pipeline', async () => {
  process.env.TRIGGER_SECRET = 's3cret';
  assert.equal((await trigger('wrong')).status, 401);
  assert.equal((await trigger(undefined)).status, 401);
  assert.equal(calls, 0);
});

test('accepts the correct secret and acks immediately', async () => {
  process.env.TRIGGER_SECRET = 's3cret';
  const res = await trigger('s3cret');
  assert.equal(res.status, 202, 'must ack before the pipeline finishes');
  assert.equal((await res.json()).accepted, true);
  await settle();
  assert.equal(calls, 1);
});

test('a failed run is recorded with a timestamp', async () => {
  process.env.TRIGGER_SECRET = 's3cret';
  nextResult = new Error('boom');
  await trigger('s3cret');
  await settle();
  assert.equal(lastResult.error, 'boom');
  assert.ok(lastResult.failedAt);
});

test('a skipped run is recorded as skipped, not failed', async () => {
  process.env.TRIGGER_SECRET = 's3cret';
  lastResult = null;
  nextResult = { success: false, skipped: true, reason: 'debounced' };
  await trigger('s3cret');
  await settle();
  assert.ok(lastResult.skippedAt);
  assert.ok(!lastResult.failedAt);
});
