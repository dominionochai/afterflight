import test from 'node:test';
import assert from 'node:assert/strict';
import { source, cloud } from '../fixtures/synthetic.js';
import { fakeJira } from '../fixtures/fake-jira.js';
import { readBoardFilterUsage } from '../src/board-readers.js';
import { runAnalysis } from '../src/service.js';
import { buildIntegrityReport } from '../src/report.js';

// SYNTHETIC boards: shapes follow the documented board configuration response, ids are made up.
const config = (filterId) => ({ filter: { id: filterId }, columnConfig: { columns: [] } });
const BOARDS = {
  70: { name: 'Billing board', config: config('20001'), issues: [] },
  71: { name: 'Team board', config: config('20002'), issues: [] },
  72: { name: 'Billing kanban', config: config('20001'), issues: [] },
  73: { name: 'Locked board', config: config('20003'), issues: [] },
};
const snapshotText = JSON.stringify(source);
const getJsonOver = (request) => async (path) => (await request(path)).json();

test('readBoardFilterUsage groups boards by filter across pages and reports unreadable boards', async () => {
  const jira = fakeJira(cloud, { pageSize: 2, boards: BOARDS, brokenBoards: ['73'] });
  const { usage, skipped } = await readBoardFilterUsage(getJsonOver(jira.request));
  assert.deepEqual(usage.get('20001').map((b) => b.name), ['Billing board', 'Billing kanban']);
  assert.deepEqual(usage.get('20002').map((b) => b.name), ['Team board']);
  assert.equal(usage.has('20003'), false);
  assert.deepEqual(skipped.map((s) => s.id), ['73']);
});

test('each filter in the analysis lists the boards that use it', async () => {
  const jira = fakeJira(cloud, { boards: BOARDS });
  const { filters, boardsNote } = await runAnalysis({ snapshotText, requestJira: jira.request });
  const boardsOf = (name) => filters.find((f) => f.name === name).boards.map((b) => b.name);
  assert.deepEqual(boardsOf('Billing open'), ['Billing board', 'Billing kanban']);
  assert.deepEqual(boardsOf('Team work'), ['Team board']);
  assert.deepEqual(boardsOf('Points'), []);
  assert.equal(boardsNote, undefined);
});

test('an unreadable board is named in a note instead of being dropped silently', async () => {
  const jira = fakeJira(cloud, { boards: BOARDS, brokenBoards: ['73'] });
  const analysis = await runAnalysis({ snapshotText, requestJira: jira.request });
  assert.match(analysis.boardsNote, /Could not read the configuration of 1 board\(s\) \(73\)/);
  assert.ok(buildIntegrityReport({ generatedAt: 'x', analysis }).caveats.some((c) => c.startsWith('Could not read the configuration')));
});

test('a site with no boards gives empty lists and no note', async () => {
  const { filters, boardsNote } = await runAnalysis({ snapshotText, requestJira: fakeJira(cloud).request });
  assert.equal(boardsNote, undefined);
  assert.ok(filters.every((f) => f.boards.length === 0));
});
