import test from 'node:test';
import assert from 'node:assert/strict';
import { parseIdMapping } from '../src/idmap.js';
import { compareBoardConfig, compareBoardIssues } from '../src/board-parity.js';

// SYNTHETIC: type strings below are placeholders for a real JCMA report, not confirmed names.
const CSV = [
  'Entity Type,Server ID,Cloud ID',
  'test:filter,100,9100',
  'test:status,3,10002',
  'test:status,4,10003',
  'test:field,customfield_10016,customfield_10020',
  'Entity Type,Server ID,Cloud ID',
  'test:issue,1,501',
  'test:issue,2,502',
  'test:issue,3,503',
  '',
].join('\r\n');

const ids = parseIdMapping(CSV);
const map = {
  filter: (id) => ids.get('test:filter', id),
  status: (id) => ids.get('test:status', id),
  field: (id) => ids.get('test:field', id),
};

test('parseIdMapping skips repeated headers, blank lines and CRLF', () => {
  assert.equal(ids.size, 7);
  assert.equal(ids.get('test:issue', '2'), '502');
  assert.equal(ids.get('test:issue', '99'), undefined);
});

test('parseIdMapping rejects short rows and conflicting duplicates with the line number', () => {
  assert.throws(() => parseIdMapping('test:issue,1'), /line 1 needs Entity Type, Server ID and Cloud ID/);
  assert.throws(() => parseIdMapping('t:i,1,5\nt:i,1,6'), /line 2.*maps to both 5 and 6/);
  assert.equal(parseIdMapping('t:i,1,5\nt:i,1,5').size, 1);
  assert.equal(parseIdMapping('t:i,"1","a,b"').get('t:i', '1'), 'a,b');
});

const sourceBoard = {
  filter: { id: '100' },
  columnConfig: { columns: [
    { name: 'To Do', statuses: [{ id: '3' }] },
    { name: 'Done', statuses: [{ id: '4' }, { id: '7' }] },
  ] },
  estimation: { field: { fieldId: 'customfield_10016' } },
};

test('a faithful Cloud board produces no findings except the unmapped status', () => {
  const cloud = {
    filter: { id: '9100' },
    columnConfig: { columns: [{ name: 'To Do', statuses: [{ id: '10002' }] }, { name: 'Done', statuses: [{ id: '10003' }] }] },
    estimation: { field: { fieldId: 'customfield_10020' } },
  };
  assert.deepEqual(compareBoardConfig(sourceBoard, cloud, map), [
    { area: 'column:Done', status: 'unmapped', detail: 'status 7 has no Cloud mapping' },
  ]);
});

test('wrong filter, dropped column and wrong estimation field are each reported', () => {
  const cloud = {
    filter: { id: '9999' },
    columnConfig: { columns: [{ name: 'To Do', statuses: [{ id: '10003' }] }] },
    estimation: { field: { fieldId: 'customfield_10099' } },
  };
  assert.deepEqual(compareBoardConfig(sourceBoard, cloud, map).map((f) => [f.area, f.status]), [
    ['filter', 'mismatch'],
    ['column:To Do', 'missing'],
    ['column:Done', 'missing'],
    ['estimation', 'mismatch'],
  ]);
});

test('missing board issue is explained by its status, and unmapped issues make unexpected untrustworthy', () => {
  const source = [{ id: '1', statusId: '3' }, { id: '2', statusId: '7' }, { id: '3', statusId: '4' }, { id: '8', statusId: '3' }];
  const cloud = [{ id: '501' }, { id: '777' }];
  const result = compareBoardIssues(source, cloud, { mapIssue: (id) => ids.get('test:issue', id), mapStatus: map.status, cloudBoardStatusIds: new Set(['10002']) });
  assert.deepEqual(result.missing, [
    { sourceId: '2', cloudId: '502', reason: 'status-unmapped' },
    { sourceId: '3', cloudId: '503', reason: 'status-not-in-any-board-column' },
  ]);
  assert.deepEqual(result.unmapped, ['8']);
  assert.deepEqual(result.unexpected, ['777']);
  assert.equal(result.matched, 1);
  assert.equal(result.complete, false);
});
