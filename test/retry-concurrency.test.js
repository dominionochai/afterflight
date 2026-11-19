import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeJira } from '../fixtures/fake-jira.js';
import { cloud } from '../fixtures/synthetic.js';
import { readCloudWorld } from '../src/cloud-reader.js';
import { mapLimit } from '../src/concurrency.js';
import { withRetry } from '../src/retry.js';

// MOCKED: every response and clock below is scripted. These prove the retry rules, not Jira's real rate-limit behaviour.
const res = (status, retryAfter) => ({ ok: status < 400, status, headers: { get: (h) => (h === 'retry-after' ? retryAfter ?? null : null) }, json: async () => ({}), text: async () => '' });
const scripted = (...steps) => {
  const calls = [];
  const request = async (path, init) => {
    calls.push({ path, init });
    const step = steps[Math.min(calls.length - 1, steps.length - 1)];
    if (step instanceof Error) throw step;
    return step;
  };
  return { request, calls };
};
const sleeps = () => { const log = []; return { log, sleep: async (ms) => void log.push(ms) }; };

test('429 and gateway errors are retried, Retry-After wins over backoff, and success ends the loop', async () => {
  const { request, calls } = scripted(res(429, '2'), res(503), res(200));
  const { log, sleep } = sleeps();
  const out = await withRetry(request, { sleep, random: () => 1 })('/x');
  assert.equal(out.status, 200);
  assert.equal(calls.length, 3);
  assert.deepEqual(log, [2000, 1000]);
});

test('retries are bounded, and the last failing response is returned for the caller to report', async () => {
  const { request, calls } = scripted(res(429));
  const out = await withRetry(request, { retries: 2, sleep: sleeps().sleep, random: () => 0 })('/x');
  assert.equal(out.status, 429);
  assert.equal(calls.length, 3);
});

test('a 500 is retried for reads but never for a write; client errors are never retried', async () => {
  const read = scripted(res(500), res(200));
  assert.equal((await withRetry(read.request, { sleep: sleeps().sleep })('/x')).status, 200);
  const write = scripted(res(500), res(200));
  assert.equal((await withRetry(write.request, { sleep: sleeps().sleep })('/x', { method: 'PUT' })).status, 500);
  assert.equal(write.calls.length, 1);
  const client = scripted(res(404), res(200));
  assert.equal((await withRetry(client.request, { sleep: sleeps().sleep })('/x')).status, 404);
});

test('network errors are retried, then rethrown once the budget is spent', async () => {
  const flaky = scripted(new Error('socket hang up'), res(200));
  assert.equal((await withRetry(flaky.request, { sleep: sleeps().sleep })('/x')).status, 200);
  const dead = scripted(new Error('offline'));
  await assert.rejects(withRetry(dead.request, { retries: 1, sleep: sleeps().sleep })('/x'), /offline/);
  assert.equal(dead.calls.length, 2);
});

test('a retry that cannot finish before the deadline is not attempted', async () => {
  const { request, calls } = scripted(res(429, '30'), res(200));
  const { log, sleep } = sleeps();
  const out = await withRetry(request, { sleep, now: () => 1000, deadline: 5000, maxMs: 60000 })('/x');
  assert.equal(out.status, 429);
  assert.equal(calls.length, 1);
  assert.deepEqual(log, []);
});

test('mapLimit never exceeds its limit, keeps order, and stops starting work after a failure', async () => {
  let inFlight = 0;
  let peak = 0;
  const out = await mapLimit([5, 1, 4, 2, 3, 6], 2, async (n) => {
    peak = Math.max(peak, ++inFlight);
    await new Promise((r) => setTimeout(r, n));
    inFlight--;
    return n * 10;
  });
  assert.deepEqual(out, [50, 10, 40, 20, 30, 60]);
  assert.equal(peak, 2);
  const started = [];
  await assert.rejects(mapLimit([1, 2, 3, 4, 5], 1, async (n) => { started.push(n); if (n === 2) throw new Error('boom'); }), /boom/);
  assert.deepEqual(started, [1, 2]);
});

test('readCloudWorld reads only the entity types asked for, and versions only when asked', async () => {
  const jira = fakeJira(cloud);
  const paths = [];
  const request = (path, init) => { paths.push(path.split('?')[0]); return jira.request(path, init); };
  const world = await readCloudWorld(request, ['status']);
  assert.deepEqual(Object.keys(world.entities), ['status']);
  assert.deepEqual([...new Set(paths)].sort(), ['/rest/api/3/filter/search', '/rest/api/3/status']);
  paths.length = 0;
  await readCloudWorld(request, ['project']);
  assert.ok(!paths.some((p) => p.includes('/versions') || p.includes('/components')));
  paths.length = 0;
  await readCloudWorld(request, ['version']);
  assert.ok(paths.some((p) => p.endsWith('/versions')));
});
