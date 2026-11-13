import test from 'node:test';
import assert from 'node:assert/strict';
import { source, cloud } from '../fixtures/synthetic.js';
import { fakeJira } from '../fixtures/fake-jira.js';
import { memoryStore, tickingClock } from '../fixtures/memory-audit-store.js';
import { appliedRepairs, makeAuditLog } from '../src/audit.js';
import { runApply, runRollback, runAnalysis } from '../src/service.js';
import { buildIntegrityReport, renderMarkdown, NOT_CHECKED } from '../src/report.js';

const snapshotText = JSON.stringify(source);
const entryOf = (audit) => audit.list();

test('audit log is append-only and returns entries oldest first', async () => {
  const store = memoryStore();
  const audit = makeAuditLog(store, { now: tickingClock() });
  const base = { runId: 'r', actor: 'u', action: 'repair', filterId: '1', name: 'f', before: 'a', after: 'b' };
  await audit.record({ ...base, outcome: 'attempting' });
  await audit.record({ ...base, outcome: 'applied' });
  assert.deepEqual((await audit.list()).map((e) => e.outcome), ['attempting', 'applied']);
  await assert.rejects(store.put([...store.data.keys()][0], base), /key exists/);
});

test('runApply refuses to run without an audit log', async () => {
  await assert.rejects(runApply({ snapshotText, filterIds: [], requestJira: fakeJira(cloud).request }), /audit log is required/);
});

test('every write is recorded before it happens and again when it succeeds, with the actor', async () => {
  const audit = makeAuditLog(memoryStore(), { now: tickingClock() });
  const jira = fakeJira(cloud);
  const result = await runApply({ snapshotText, filterIds: ['20001'], requestJira: jira.request, audit, actor: 'acct-1', runId: 'run-1' });
  assert.deepEqual(result.done, ['20001']);
  const entries = await entryOf(audit);
  assert.deepEqual(entries.map((e) => [e.outcome, e.actor, e.filterId]), [['attempting', 'acct-1', '20001'], ['applied', 'acct-1', '20001']]);
  assert.equal(entries[1].before, 'project = 10100 AND status = 3');
  assert.equal(entries[1].after, 'project = 10300 AND status = 10002');
});

test('if the audit store is down, nothing is written to Jira (fail closed)', async () => {
  const audit = makeAuditLog(memoryStore({ failPut: true }), { now: tickingClock() });
  const jira = fakeJira(cloud);
  const result = await runApply({ snapshotText, filterIds: ['20001'], requestJira: jira.request, audit });
  assert.deepEqual(result.done, []);
  assert.equal(jira.writes.length, 0);
  assert.match(result.failed[0].message, /store down/);
  assert.equal(result.auditErrors.length, 1);
});

test('a failed write is audited with its message', async () => {
  const audit = makeAuditLog(memoryStore(), { now: tickingClock() });
  const jira = fakeJira(cloud, { denyPut: ['20001'] });
  await runApply({ snapshotText, filterIds: ['20001'], requestJira: jira.request, audit, runId: 'run-2' });
  const outcomes = (await entryOf(audit)).map((e) => e.outcome);
  assert.deepEqual(outcomes, ['attempting', 'failed']);
  assert.match((await entryOf(audit))[1].message, /HTTP 403/);
});

test('rollback restores the original JQL, is idempotent, and leaves later edits alone', async () => {
  const audit = makeAuditLog(memoryStore(), { now: tickingClock() });
  const jira = fakeJira(cloud);
  await runApply({ snapshotText, filterIds: ['20001', '20002'], requestJira: jira.request, audit, runId: 'run-3' });
  assert.equal(jira.filters.get('20001').jql, 'project = 10300 AND status = 10002');

  jira.filters.get('20002').jql = 'cf[10055] = "Apollo" AND assignee = "someone-else"';
  const undone = await runRollback({ requestJira: jira.request, audit, runId: 'run-3', actor: 'acct-9' });
  assert.deepEqual(undone.done, ['20001']);
  assert.equal(undone.failed.length, 1);
  assert.match(undone.failed[0].message, /changed since analysis/);
  assert.equal(jira.filters.get('20001').jql, 'project = 10100 AND status = 3');
  assert.equal(jira.filters.get('20002').jql, 'cf[10055] = "Apollo" AND assignee = "someone-else"');

  const again = await runRollback({ requestJira: jira.request, audit, runId: 'run-3' });
  assert.deepEqual(again.skipped, ['20001']);
  assert.equal(appliedRepairs(await entryOf(audit), 'run-3').length, 2);
  assert.ok((await entryOf(audit)).some((e) => e.action === 'rollback' && e.rollbackOf === 'run-3' && e.actor === 'acct-9'));
});

test('rollback of an unknown run says so', async () => {
  const audit = makeAuditLog(memoryStore(), { now: tickingClock() });
  await assert.rejects(runRollback({ requestJira: fakeJira(cloud).request, audit, runId: 'nope' }), /No applied repairs were found for run nope/);
});

test('integrity report states coverage, counts, caveats and the audit trail', async () => {
  const audit = makeAuditLog(memoryStore(), { now: tickingClock() });
  const jira = fakeJira(cloud);
  await runApply({ snapshotText, filterIds: ['20001'], requestJira: jira.request, audit, runId: 'run-4' });
  const analysis = await runAnalysis({ snapshotText, requestJira: jira.request });
  const boards = [
    { boardId: '8', name: 'Orphan board', status: 'board-not-mapped' },
    { boardId: '7', name: 'Big board', cloudBoardId: '70', status: 'compared', sourceTruncated: true, configFindings: [{ area: 'filter', status: 'mismatch', detail: 'x' }],
      issues: { missing: [{ sourceId: '2' }], unexpected: [], unmapped: ['9'], matched: 1, complete: false } },
  ];
  const report = buildIntegrityReport({ generatedAt: '2026-11-13T12:00:00.000Z', analysis, boards, auditEntries: await audit.list() });
  assert.deepEqual(report.summary.repairs, { applied: 1, failed: 0, rolledBack: 0 });
  assert.deepEqual(report.summary.boards, { total: 2, compared: 1, withConfigFindings: 1, withMissingIssues: 1 });
  assert.equal(report.summary.filters.notMigrated, 1);
  assert.equal(report.caveats.length, 4);
  assert.ok(report.coverage.notChecked.includes('Board quick filters') && report.coverage.notChecked.includes('Advanced Roadmaps plans'));
  const md = renderMarkdown(report);
  for (const heading of ['# Afterflight migration integrity report', '## Coverage', '## Caveats', '## Audit trail']) assert.ok(md.includes(heading), heading);
  assert.ok(NOT_CHECKED.every((item) => md.includes(item)));
  assert.match(md, /truncated, so issues reported missing may be false alarms/);
  assert.match(md, /run run-4/);
});
