import test from 'node:test';
import assert from 'node:assert/strict';
import { source, cloud } from '../fixtures/synthetic.js';
import { fakeJira } from '../fixtures/fake-jira.js';
import { memoryStore, tickingClock } from '../fixtures/memory-audit-store.js';
import { makeAuditLog } from '../src/audit.js';
import { compareChecks, parseJql } from '../src/jql-check.js';
import { explain } from '../src/explain.js';
import { runAnalysis, runApply } from '../src/service.js';

const snapshotText = JSON.stringify(source);
const newAudit = () => makeAuditLog(memoryStore(), { now: tickingClock() });
const BILLING_PROPOSED = 'project = 10300 AND status = 10002';

test('parseJql sends queries in chunks and matches results by position', async () => {
  const jira = fakeJira(cloud);
  const sizes = [];
  const request = (path, init) => {
    if (path.startsWith('/rest/api/3/jql/parse')) sizes.push(JSON.parse(init.body).queries.length);
    return jira.request(path, init);
  };
  const queries = Array.from({ length: 60 }, (_, i) => (i === 7 ? 'status = 3' : `project = 1030${i % 2}`));
  const parsed = await parseJql(request, [...new Set(queries)]);
  assert.deepEqual(sizes, [3]);
  assert.deepEqual(parsed.get('status = 3'), { errors: [], warnings: ["The value '3' does not exist for the field 'status'."] });
  const many = Array.from({ length: 120 }, (_, i) => `status = ${i}`);
  sizes.length = 0;
  await parseJql(request, many);
  assert.deepEqual(sizes, [50, 50, 20]);
});

test('parseJql names the status when the route fails, and rejects a result count mismatch', async () => {
  await assert.rejects(parseJql(fakeJira(cloud, { parseStatus: 500 }).request, ['status = 3']), /POST \/rest\/api\/3\/jql\/parse failed with HTTP 500/);
  const short = async () => ({ ok: true, status: 200, json: async () => ({ queries: [] }), text: async () => '' });
  await assert.rejects(parseJql(short, ['a = 1']), /returned 0 results for 1 queries/);
});

test('compareChecks counts only new messages against a repair', () => {
  const before = { errors: [], warnings: ['old problem', 'fixed problem'] };
  const after = { errors: ['new error'], warnings: ['old problem'] };
  assert.deepEqual(compareChecks(before, after), { introduced: ['new error'], resolved: ['fixed problem'] });
});

test('analysis shows Atlassian\'s view next to each repair, and the parser cannot see a project id that was reused', async () => {
  const { filters } = await runAnalysis({ snapshotText, requestJira: fakeJira(cloud).request });
  const billing = filters.find((f) => f.name === 'Billing open');
  assert.equal(billing.proposed, BILLING_PROPOSED);
  assert.deepEqual(billing.check, { introduced: [], resolved: ["The value '3' does not exist for the field 'status'."] });
  assert.ok(billing.why[0].includes('still valid in Cloud but now means "Platform"'));
  assert.equal(filters.find((f) => f.name === 'Points').check, undefined);
});

test('analysis still works, with a stated note, when Atlassian\'s check is unavailable', async () => {
  const result = await runAnalysis({ snapshotText, requestJira: fakeJira(cloud, { parseStatus: 500 }).request });
  assert.match(result.checkNote, /Atlassian's JQL check did not run.*HTTP 500.*not independently checked/);
  assert.equal(result.filters.find((f) => f.name === 'Billing open').canRepair, true);
});

test('a repair that introduces a new Atlassian problem is not written, and the block is audited', async () => {
  const jira = fakeJira(cloud, { parseExtra: { [BILLING_PROPOSED]: ["The value 'boom' does not exist for the field 'project'."] } });
  const audit = newAudit();
  const result = await runApply({ snapshotText, filterIds: ['20001'], requestJira: jira.request, audit });
  assert.deepEqual(result.done, []);
  assert.match(result.failed[0].message, /found new problems in the proposed query, so nothing was written: .*boom/);
  assert.equal(jira.writes.length, 0);
  assert.equal(jira.filters.get('20001').jql, 'project = 10100 AND status = 3');
  assert.deepEqual((await audit.list()).map((e) => e.outcome), ['failed']);
});

test('if Atlassian\'s check cannot run, apply fails closed', async () => {
  const jira = fakeJira(cloud, { parseStatus: 500 });
  const result = await runApply({ snapshotText, filterIds: ['20001', '20002'], requestJira: jira.request, audit: newAudit() });
  assert.deepEqual(result.done, []);
  assert.equal(result.failed.length, 2);
  assert.match(result.failed[0].message, /JQL check could not run.*nothing was written/);
  assert.equal(jira.writes.length, 0);
});

test('a filter whose live JQL is not what we wrote is reported as not verified', async () => {
  const jira = fakeJira(cloud);
  const tamper = async (path, init) => {
    const res = await jira.request(path, init);
    if (init?.method === 'PUT') jira.filters.get(path.split('/').pop()).jql = 'project = 1';
    return res;
  };
  const result = await runApply({ snapshotText, filterIds: ['20001'], requestJira: tamper, audit: newAudit() });
  assert.deepEqual(result.done, ['20001']);
  assert.deepEqual(result.unverified, ['Billing open']);
});

test('explanations say what happened in plain words, and stay silent when there is nothing to say', () => {
  const base = { type: 'status', was: '10000', now: '10000' };
  assert.equal(
    explain({ ...base, status: 'wrong-entity', meant: 'Done', resolvesNowTo: 'Waiting for support', targetName: 'Done' }),
    'status "10000" is still valid in Cloud but now means "Waiting for support". In Data Center it meant "Done", so this query would silently return the wrong results. Proposed: "Done".',
  );
  assert.equal(explain({ ...base, status: 'stale', meant: 'Done', targetName: 'Done' }), 'status "10000" no longer exists in Cloud. In Data Center it meant "Done". Proposed: "Done".');
  assert.match(explain({ ...base, status: 'missing', meant: 'In Review', mappedCloudId: '9' }), /no counterpart in Cloud \(the ID Mapping Report points at 9, which does not exist\)\. Repair this by hand\./);
  assert.match(explain({ ...base, status: 'missing', meant: 'In Review', resolvesNowTo: 'Open' }), /still resolves to "Open", so the query may silently match the wrong thing/);
  assert.match(explain({ ...base, status: 'ambiguous', meant: 'Done' }), /matches more than one Cloud entity by name/);
  assert.match(explain({ status: 'structure-changed' }), /JCMA changed the shape of this query/);
  assert.equal(explain({ ...base, status: 'ok' }), undefined);
  assert.equal(explain({ ...base, status: 'unknown-in-source' }), undefined);
});
