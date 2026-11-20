import test from 'node:test';
import assert from 'node:assert/strict';
import { source, cloud } from '../fixtures/synthetic.js';
import { fakeJira } from '../fixtures/fake-jira.js';
import { analyse } from '../src/engine.js';
import { extractReferences, unsupportedConstructs } from '../src/jql.js';
import { buildIntegrityReport, renderMarkdown } from '../src/report.js';
import { runAnalysis } from '../src/service.js';

const lits = (jql) => extractReferences(jql).map((r) => `${r.type}:${r.literal}`);

test('history clauses: was, was not in, changed from/to, by, and date predicates that are skipped', () => {
  assert.deepEqual(lits('status was "In Review" BY jsmith AFTER "2024-01-01"'), ['status:In Review', 'user:jsmith']);
  assert.deepEqual(lits('status changed FROM "To Do" TO Done BY (a, b) DURING (startOfDay(), now())'), ['status:To Do', 'status:Done', 'user:a', 'user:b']);
  assert.deepEqual(lits('status was not in (Done, Open)'), ['status:Done', 'status:Open']);
  assert.deepEqual(lits('assignee was jsmith ON "2024-02-02"'), ['user:jsmith']);
  assert.deepEqual(lits('"Story Points" changed BY jsmith'), ['field:Story Points', 'user:jsmith']);
  assert.deepEqual(lits('status changed AFTER -1w AND project = DEV'), ['project:DEV']);
});

test('history keywords are never read as field names', () => {
  assert.deepEqual(lits('status changed from Done to Open'), ['status:Done', 'status:Open']);
});

test('constructs Afterflight cannot read are listed, harmless ones are not', () => {
  assert.deepEqual(unsupportedConstructs('assignee in membersOf("devs")'), ['membersOf("devs")']);
  assert.deepEqual(unsupportedConstructs('issueFunction in linkedIssuesOf("project = X") AND fixVersion in releasedVersions(DEV)'), ['linkedIssuesOf("project = X")', 'releasedVersions(DEV)']);
  assert.deepEqual(unsupportedConstructs('created > startOfDay(-1d) AND assignee = currentUser() AND status in (Done, Open) AND updated < now()'), []);
  assert.deepEqual(unsupportedConstructs('a in membersOf("g") OR b in membersOf("g")'), ['membersOf("g")']);
  assert.deepEqual(unsupportedConstructs('status = "Done AND project = X'), ['an unterminated quoted string']);
  assert.deepEqual(unsupportedConstructs(''), []);
});

const SRC = { status: [{ id: '3', name: 'Done' }, { id: '4', name: 'Open' }] };
const CLOUD = { status: [{ id: '10006', name: 'Done' }, { id: '10007', name: 'Open' }] };
const world = (entities, jql) => ({ entities, filters: [{ id: '1', ownerEmail: 'o@example.com', name: 'f', jql }] });

test('references inside a history clause are repaired like any other', () => {
  const jql = 'status changed FROM 3 TO 4 AND status was 3';
  const [r] = analyse(world(SRC, jql), world(CLOUD, jql)).reports;
  assert.equal(r.proposed, 'status changed FROM 10006 TO 10007 AND status was 10006');
});

test('a filter with an unread function is analysed where possible, and the rest is stated', async () => {
  const withGroup = { ...source, filters: source.filters.map((f) => (f.id === '1' ? { ...f, jql: `${f.jql} AND assignee in membersOf("devs")` } : f)) };
  const cld = { ...cloud, filters: cloud.filters.map((f) => (f.id === '20001' ? { ...f, jql: `${f.jql} AND assignee in membersOf("devs")` } : f)) };
  const analysis = await runAnalysis({ snapshotText: JSON.stringify(withGroup), requestJira: fakeJira(cld).request });
  const billing = analysis.filters.find((f) => f.name === 'Billing open');
  assert.equal(billing.proposed, 'project = 10300 AND status = 10002 AND assignee in membersOf("devs")');
  assert.deepEqual(billing.notAnalysed, ['membersOf("devs")']);
  assert.ok(billing.why.some((w) => w.includes('does not analyse')));
  const report = buildIntegrityReport({ generatedAt: 'x', analysis });
  assert.equal(report.summary.filters.partlyAnalysed, 1);
  assert.ok(report.caveats.some((c) => c.startsWith('1 filter(s) contain query parts that are not analysed') && c.includes('Billing open')));
  assert.match(renderMarkdown(report), /partly analysed/);
});
