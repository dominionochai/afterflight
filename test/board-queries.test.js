import test from 'node:test';
import assert from 'node:assert/strict';
import { cloud } from '../fixtures/synthetic.js';
import { fakeJira } from '../fixtures/fake-jira.js';
import { readQuickFilters } from '../src/board-readers.js';
import { buildIntegrityReport, renderMarkdown } from '../src/report.js';
import { runAnalysis, runBoardQueryCheck } from '../src/service.js';

// SYNTHETIC boards and quick filters; shapes follow the documented Cloud responses.
const config = (filterId, subQuery) => ({ filter: { id: filterId }, columnConfig: { columns: [] }, ...(subQuery ? { subQuery: { query: subQuery } } : {}) });
const BOARDS = {
  70: { name: 'Billing board', config: config('20001'), issues: [], quickFilters: [{ name: 'Mine', jql: 'assignee = currentUser()' }, { name: 'Old status', jql: 'status = 99999' }, { name: 'Fine', jql: 'status = 10002' }] },
  71: { name: 'Team kanban', config: config('20002', 'project = 424242'), issues: [], quickFilters: [] },
  72: { name: 'Locked', config: config('20003'), issues: [], quickFilters: [] },
};
const getJsonOver = (request) => async (path) => (await request(path)).json();

test('readQuickFilters follows paging and keeps id, name and jql', async () => {
  const jira = fakeJira(cloud, { pageSize: 2, boards: BOARDS });
  const filters = await readQuickFilters(getJsonOver(jira.request), '70');
  assert.deepEqual(filters.map((q) => [q.id, q.name, q.jql]), [['1', 'Mine', 'assignee = currentUser()'], ['2', 'Old status', 'status = 99999'], ['3', 'Fine', 'status = 10002']]);
});

test('quick filters and Kanban sub-queries with references Atlassian cannot resolve are listed, the rest are not', async () => {
  const jira = fakeJira(cloud, { boards: BOARDS, brokenBoards: ['72'] });
  const result = await runBoardQueryCheck({ requestJira: jira.request });
  assert.equal(result.checked, 4);
  assert.deepEqual(result.findings.map((f) => [f.boardName, f.kind, f.name]), [['Billing board', 'quick-filter', 'Old status'], ['Team kanban', 'sub-query', 'Kanban sub-query']]);
  assert.match(result.findings[0].problems[0], /'99999' does not exist for the field 'status'/);
  assert.match(result.note, /Could not read 1 board\(s\) \(72\)/);
});

test('nothing to check gives an empty result, not an error', async () => {
  const result = await runBoardQueryCheck({ requestJira: fakeJira(cloud).request });
  assert.deepEqual(result, { checked: 0, findings: [], note: undefined });
});

test('the report lists problem quick filters, says fixes are manual, and no longer claims they were not checked', async () => {
  const jira = fakeJira(cloud, { boards: BOARDS });
  const queryCheck = await runBoardQueryCheck({ requestJira: jira.request });
  const analysis = await runAnalysis({ snapshotText: JSON.stringify({ entities: {}, filters: [] }), requestJira: jira.request });
  const report = buildIntegrityReport({ generatedAt: 'x', analysis, queryCheck });
  assert.deepEqual(report.summary.boardQueries, { checked: 4, withProblems: 2 });
  assert.ok(!report.coverage.notChecked.some((item) => item.startsWith('Board quick filters')));
  assert.ok(report.coverage.checkedWithGaps.some((item) => item.startsWith('Board quick filters and Kanban sub-queries')));
  const md = renderMarkdown(report);
  assert.match(md, /## Board quick filters and sub-queries/);
  assert.match(md, /Old status.*status = 99999/s);
  assert.match(md, /Fix by hand: Cloud has no write route for this/);
});
