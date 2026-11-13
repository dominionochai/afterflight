import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeJira } from '../fixtures/fake-jira.js';
import { readBoardConfig, readBoards, readCloudBoardIssues, readDcBoardIssues } from '../src/board-readers.js';
import { parseSnapshot } from '../src/snapshot.js';
import { runBoardParity } from '../src/service.js';

// SYNTHETIC: entity type strings are placeholders, not real JCMA names.
const TYPES = { board: 'test:board', filter: 'test:filter', field: 'test:field', issue: 'test:issue' };
const CSV = [
  'Entity Type,Server ID,Cloud ID',
  'test:board,7,70', 'test:filter,100,9100', 'test:field,customfield_10016,customfield_10020',
  'test:issue,1,501', 'test:issue,2,502', 'test:issue,3,503',
].join('\n');

const sourceConfig = {
  filter: { id: '100' },
  columnConfig: { columns: [{ name: 'To Do', statuses: [{ id: '3' }] }, { name: 'Done', statuses: [{ id: '4' }] }] },
  estimation: { field: { fieldId: 'customfield_10016' } },
};
const source = {
  entities: {
    status: [{ id: '3', name: 'To Do' }, { id: '4', name: 'Done' }],
    field: [{ id: 'customfield_10016', name: 'Story Points' }],
  },
  filters: [],
  boards: [
    { id: '7', name: 'Billing board', config: sourceConfig, issues: [{ id: '1', statusId: '3' }, { id: '2', statusId: '3' }, { id: '3', statusId: '4' }] },
    { id: '8', name: 'Orphan board', config: sourceConfig, issues: [] },
  ],
};
const cloudWorld = {
  entities: {
    project: [], user: [],
    status: [{ id: '10002', name: 'To Do' }, { id: '10003', name: 'Done' }],
    field: [{ id: 'customfield_10020', name: 'Story point estimate' }],
  },
  filters: [],
};
const cloudBoard = {
  config: {
    filter: { id: '9100' },
    columnConfig: { columns: [{ name: 'To Do', statuses: [{ id: '10002' }] }, { name: 'Done', statuses: [{ id: '10003' }] }] },
    estimation: { field: { fieldId: 'customfield_10020' } },
  },
  issues: [{ id: '501', statusId: '10002' }, { id: '503', statusId: '10003' }, { id: '999', statusId: '10002' }],
};

const getJsonOver = (request) => async (path) => (await request(path)).json();

test('readCloudBoardIssues follows nextPageToken and reads status ids', async () => {
  const jira = fakeJira(cloudWorld, { pageSize: 2, boards: { 70: cloudBoard } });
  const { issues } = await readCloudBoardIssues(getJsonOver(jira.request), '70');
  assert.deepEqual(issues, [
    { id: '501', statusId: '10002' }, { id: '503', statusId: '10003' }, { id: '999', statusId: '10002' },
  ]);
});

test('readDcBoardIssues pages by startAt and exposes total so truncation is visible', async () => {
  const all = [1, 2, 3].map((n) => ({ id: n, fields: { status: { id: '3' } } }));
  const getJson = async (path) => {
    const startAt = Number(new URL(path, 'https://dc.invalid').searchParams.get('startAt'));
    return { total: 5, issues: all.slice(startAt, startAt + 2) };
  };
  const { issues, total } = await readDcBoardIssues(getJson, '7');
  assert.equal(issues.length, 3);
  assert.equal(total, 5);
  assert.deepEqual(issues[0], { id: '1', statusId: '3' });
});

test('readBoards and readBoardConfig use the shared agile routes', async () => {
  const seen = [];
  const getJson = async (path) => {
    seen.push(path);
    return path.includes('configuration') ? { filter: { id: '1' } } : { values: [{ id: 84, name: 'b', type: 'scrum' }], isLast: true };
  };
  assert.deepEqual(await readBoards(getJson), [{ id: '84', name: 'b', type: 'scrum' }]);
  await readBoardConfig(getJson, '84');
  assert.deepEqual(seen, ['/rest/agile/1.0/board?startAt=0&maxResults=50', '/rest/agile/1.0/board/84/configuration']);
});

test('parseSnapshot validates boards and names the failing one', () => {
  assert.equal(parseSnapshot(JSON.stringify(source)).boards.length, 2);
  const broken = { ...source, boards: [{ id: '7', name: 'x', config: {}, issues: [] }] };
  assert.throws(() => parseSnapshot(JSON.stringify(broken)), /boards\[0\]\.config needs filter\.id and columnConfig\.columns/);
});

test('runBoardParity compares a mapped board and reports an unmapped one', async () => {
  const jira = fakeJira(cloudWorld, { boards: { 70: cloudBoard } });
  const results = await runBoardParity({ snapshotText: JSON.stringify(source), idMappingCsv: CSV, types: TYPES, requestJira: jira.request });
  const [billing, orphan] = results;
  assert.equal(billing.status, 'compared');
  assert.equal(billing.sourceTruncated, false);
  assert.deepEqual(billing.configFindings, []);
  assert.deepEqual(billing.issues.missing, [{ sourceId: '2', cloudId: '502', reason: 'unexplained' }]);
  assert.deepEqual(billing.issues.unexpected, ['999']);
  assert.equal(billing.issues.matched, 2);
  assert.equal(billing.issues.complete, true);
  assert.deepEqual(orphan, { boardId: '8', name: 'Orphan board', status: 'board-not-mapped' });
});

test('runBoardParity refuses to run without the report entity type names', async () => {
  const jira = fakeJira(cloudWorld);
  await assert.rejects(
    runBoardParity({ snapshotText: JSON.stringify(source), idMappingCsv: CSV, types: { board: 'test:board' }, requestJira: jira.request }),
    /Entity type names for filter, field, issue are required/,
  );
});

test('runBoardParity flags a board whose Data Center export was truncated', async () => {
  const truncated = { ...source, boards: [{ ...source.boards[0], issueTotal: 10 }] };
  const jira = fakeJira(cloudWorld, { boards: { 70: cloudBoard } });
  const [board] = await runBoardParity({ snapshotText: JSON.stringify(truncated), idMappingCsv: CSV, types: TYPES, requestJira: jira.request });
  assert.equal(board.sourceTruncated, true);
});
