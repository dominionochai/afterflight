import test from 'node:test';
import assert from 'node:assert/strict';
import { source, cloud } from '../fixtures/synthetic.js';
import { fakeJira } from '../fixtures/fake-jira.js';
import { searchIssueIds } from '../src/cloud-reader.js';
import { compareResults } from '../src/result-parity.js';
import { buildIntegrityReport, renderMarkdown } from '../src/report.js';
import { parseSnapshot } from '../src/snapshot.js';
import { runAnalysis, runResultParity } from '../src/service.js';

const mapIssue = (id) => ({ 1: '501', 2: '502', 3: '503' })[id];

test('compareResults: issue by issue when ids are known, by count otherwise, never a verdict on a capped result', () => {
  assert.equal(compareResults({ total: 3, ids: ['1', '2', '3'] }, { ids: ['503', '502', '501'], capped: false }, mapIssue).status, 'match');
  const differs = compareResults({ total: 3, ids: ['1', '2', '3'] }, { ids: ['501', '999'], capped: false }, mapIssue);
  assert.deepEqual([differs.status, differs.missing, differs.unexpected], ['differs', ['502', '503'], ['999']]);
  const unmapped = compareResults({ total: 2, ids: ['1', '9'] }, { ids: ['501'], capped: false }, mapIssue);
  assert.deepEqual([unmapped.status, unmapped.unmapped], ['differs', ['9']]);
  assert.match(unmapped.reason, /no ID mapping/);
  assert.deepEqual(compareResults({ total: 4 }, { ids: ['a', 'b', 'c', 'd'], capped: false }), { sourceTotal: 4, cloudTotal: 4, missing: [], unexpected: [], unmapped: [], status: 'match', basis: 'counts' });
  assert.equal(compareResults({ total: 4 }, { ids: ['a'], capped: false }).status, 'differs');
  const capped = compareResults({ total: 4 }, { ids: ['a', 'b'], capped: true });
  assert.equal(capped.status, 'unknown');
  assert.match(capped.reason, /rest was not compared/);
});

test('searchIssueIds pages by token, stops at the cap, and names the status on failure', async () => {
  const jira = fakeJira(cloud, { pageSize: 2, searches: { q: [1, 2, 3, 4, 5], bad: [] }, unbounded: ['bad'] });
  assert.deepEqual(await searchIssueIds(jira.request, 'q'), { ids: ['1', '2', '3', '4', '5'], capped: false });
  assert.deepEqual(await searchIssueIds(jira.request, 'q', 2), { ids: ['1', '2'], capped: true });
  await assert.rejects(searchIssueIds(jira.request, 'bad'), /POST \/rest\/api\/3\/search\/jql failed with HTTP 400: Unbounded/);
});

const withResults = (filters) => ({ ...source, filters: source.filters.map((f) => ({ ...f, ...(filters[f.id] ? { results: filters[f.id] } : {}) })) });
const CSV = 'Entity Type,Server ID,Cloud ID\njira:issue,1,501\njira:issue,2,502\njira:issue,3,503\n';
const BILLING = { original: 'project = 10100 AND status = 3', proposed: 'project = 10300 AND status = 10002' };
const TEAM = { original: 'cf[10042] = "Apollo" AND assignee = jsmith', proposed: 'cf[10055] = "Apollo" AND assignee = "557058:f58131cb"' };

test('the repair preview: Cloud as migrated differs, Cloud after repair matches, nothing is written to see it', async () => {
  const jira = fakeJira(cloud, {
    searches: { [BILLING.original]: [], [BILLING.proposed]: ['501', '502', '503'], [TEAM.original]: [], [TEAM.proposed]: ['a', 'b', 'c', 'd', 'e'] },
  });
  const snapshotText = JSON.stringify(withResults({ 1: { total: 3, ids: ['1', '2', '3'] }, 2: { total: 5 } }));
  const result = await runResultParity({ snapshotText, requestJira: jira.request, idMappingCsv: CSV });
  assert.deepEqual(result.map((p) => p.name), ['Billing open', 'Team work']);
  const [billing, team] = result;
  assert.deepEqual([billing.asMigrated.status, billing.asMigrated.basis, billing.asMigrated.missing], ['differs', 'issue-ids', ['501', '502', '503']]);
  assert.deepEqual([billing.afterRepair.status, billing.afterRepair.basis], ['match', 'issue-ids']);
  assert.deepEqual([team.asMigrated.status, team.asMigrated.basis, team.afterRepair.status], ['differs', 'counts', 'match']);
  assert.equal(jira.writes.length, 0);
});

test('a filter Cloud cannot search is reported as unknown with the reason, and the rest still run', async () => {
  const jira = fakeJira(cloud, { searches: { 'status = "In Review"': [] }, unbounded: ['status = "In Review"'] });
  const snapshotText = JSON.stringify(withResults({ 3: { total: 1 } }));
  const [needsReview] = await runResultParity({ snapshotText, requestJira: jira.request });
  assert.equal(needsReview.asMigrated.status, 'unknown');
  assert.match(needsReview.asMigrated.reason, /HTTP 400/);
  assert.equal(needsReview.afterRepair, undefined);
});

test('snapshot validation checks exported results, and a snapshot without them gives an empty comparison', async () => {
  assert.throws(() => parseSnapshot(JSON.stringify(withResults({ 1: { total: 'many' } }))), /filters\[0\]\.results needs a numeric "total"/);
  assert.deepEqual(await runResultParity({ snapshotText: JSON.stringify(source), requestJira: fakeJira(cloud).request }), []);
});

test('the report summarises result parity and states its limits', async () => {
  const jira = fakeJira(cloud, { searches: { [BILLING.original]: [], [BILLING.proposed]: ['501', '502', '503'] } });
  const snapshotText = JSON.stringify(withResults({ 1: { total: 3, ids: ['1', '2', '3'] } }));
  const parity = await runResultParity({ snapshotText, requestJira: jira.request, idMappingCsv: CSV });
  const analysis = await runAnalysis({ snapshotText, requestJira: jira.request });
  const report = buildIntegrityReport({ generatedAt: 'x', analysis, parity });
  assert.deepEqual(report.summary.results, { compared: 1, matchAsMigrated: 0, matchAfterRepair: 1 });
  const md = renderMarkdown(report);
  assert.match(md, /## Filter results, Data Center versus Cloud/);
  assert.match(md, /Billing open.*3 in Data Center; as migrated differs, 0 in Cloud \(issue-ids\); after repair match, 3 in Cloud/s);
  assert.ok(report.coverage.checked.some((c) => c.includes('both sides see only what their user may browse')));
});
