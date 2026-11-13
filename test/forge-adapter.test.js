import test from 'node:test';
import assert from 'node:assert/strict';
import { source, cloud } from '../fixtures/synthetic.js';
import { readCloudWorld } from '../src/cloud-reader.js';
import { parseSnapshot } from '../src/snapshot.js';
import { runAnalysis, runApply } from '../src/service.js';
import { fakeJira } from '../fixtures/fake-jira.js';
import { makeAuditLog } from '../src/audit.js';
import { memoryStore, tickingClock } from '../fixtures/memory-audit-store.js';

const newAudit = () => makeAuditLog(memoryStore(), { now: tickingClock() });

test('readCloudWorld follows pagination and maps accountId, key and filter owner', async () => {
  const world = await readCloudWorld(fakeJira(cloud, { pageSize: 1 }).request);
  assert.deepEqual(world.entities.project.map((p) => [p.id, p.key]), [['10300', 'BIL'], ['10100', 'PLT']]);
  assert.deepEqual(world.entities.user, [{ id: '557058:f58131cb', name: 'John Smith', email: 'john@example.com' }]);
  assert.equal(world.filters.length, 5);
  assert.equal(world.filters[0].ownerEmail, 'john@example.com');
});

test('a Jira error names the path, the status and the fix', async () => {
  await assert.rejects(readCloudWorld(fakeJira(cloud, { status: 403 }).request), /GET \/rest\/api\/3\/\S+ failed with HTTP 403.*scopes/);
});

test('parseSnapshot rejects bad input with the failing path', () => {
  assert.deepEqual(parseSnapshot(JSON.stringify(source)).filters.length, 6);
  assert.throws(() => parseSnapshot('{nope'), /not valid JSON/);
  const broken = { ...source, filters: [{ id: '1', name: 'x', ownerEmail: 'a@b.c' }] };
  assert.throws(() => parseSnapshot(JSON.stringify(broken)), /filters\[0\] needs a string "jql"/);
});

test('runAnalysis through fake Jira proposes the same repairs as the engine', async () => {
  const { filters, notMigrated } = await runAnalysis({ snapshotText: JSON.stringify(source), requestJira: fakeJira(cloud).request });
  assert.deepEqual(notMigrated.map((f) => f.name), ['Legacy bugs']);
  assert.equal(filters.find((f) => f.name === 'Billing open').proposed, 'project = 10300 AND status = 10002');
  assert.deepEqual(filters.filter((f) => f.canRepair).map((f) => f.name), ['Billing open', 'Team work']);
});

test('runApply writes only chosen repairable filters, keeps names, verifies on live state, and is idempotent', async () => {
  const jira = fakeJira(cloud);
  const input = { snapshotText: JSON.stringify(source), requestJira: jira.request, audit: newAudit(), runId: 'run-1' };
  const first = await runApply({ ...input, filterIds: ['20001', '20003', '99999'] });
  assert.deepEqual(first, { runId: 'run-1', done: ['20001'], skipped: [], failed: [], auditErrors: [], ignored: ['20003', '99999'], stillStale: [] });
  assert.deepEqual(jira.writes, [{ id: '20001', name: 'Billing open', jql: 'project = 10300 AND status = 10002' }]);
  assert.equal(jira.filters.get('20003').jql, 'status = "In Review"');
  const second = await runApply({ ...input, filterIds: ['20001'] });
  assert.deepEqual(second.done, []);
  assert.equal(jira.writes.length, 1);
});

test('a filter the admin cannot edit is reported, and the others still get repaired', async () => {
  const jira = fakeJira(cloud, { denyPut: ['20002'] });
  const result = await runApply({ snapshotText: JSON.stringify(source), requestJira: jira.request, filterIds: ['20001', '20002'], audit: newAudit() });
  assert.deepEqual(result.done, ['20001']);
  assert.equal(result.failed.length, 1);
  assert.match(result.failed[0].message, /HTTP 403.*owner/);
  assert.deepEqual(result.stillStale, ['Team work']);
});

test('runAnalysis pairs by the ID mapping report and demands the filter type name with it', async () => {
  const renamed = { ...cloud, filters: cloud.filters.map((f) => (f.id === '20001' ? { ...f, name: 'Billing open (migrated)' } : f)) };
  const input = { snapshotText: JSON.stringify(source), requestJira: fakeJira(renamed).request };
  assert.ok((await runAnalysis(input)).notMigrated.some((f) => f.name === 'Billing open'));
  const paired = await runAnalysis({ ...input, idMappingCsv: 'test:filter,1,20001', filterType: 'test:filter' });
  assert.ok(!paired.notMigrated.some((f) => f.name === 'Billing open'));
  assert.equal(paired.filters.find((f) => f.filterId === '20001').proposed, 'project = 10300 AND status = 10002');
  await assert.rejects(runAnalysis({ ...input, idMappingCsv: 'test:filter,1,20001' }), /needs filterType/);
});
