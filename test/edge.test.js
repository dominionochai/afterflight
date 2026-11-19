import test from 'node:test';
import assert from 'node:assert/strict';
import { analyse, needsRepair, openFindings } from '../src/engine.js';
import { extractReferences } from '../src/jql.js';
import { parseIdMapping } from '../src/idmap.js';

const lits = (jql) => extractReferences(jql).map((r) => `${r.type}:${r.literal}`);
const owner = 'o@example.com';
const world = (entities, jql) => ({ entities, filters: [{ id: '1', ownerEmail: owner, name: 'f', jql }] });

test('parsing: nesting, lists, functions, no-space operators, case, negations', () => {
  assert.deepEqual(lits('(project = A OR project = B) AND status in (Done, "In Review")'), ['project:A', 'project:B', 'status:Done', 'status:In Review']);
  assert.deepEqual(lits('assignee in (currentUser(), jsmith) AND reporter = EMPTY'), ['user:jsmith', 'user:EMPTY']);
  assert.deepEqual(lits('project=DEV AND status IN(Done,Open)'), ['project:DEV', 'status:Done', 'status:Open']);
  assert.deepEqual(lits('PROJECT = A AND Status != Done'), ['project:A', 'status:Done']);
  assert.deepEqual(lits('status not in (Done) AND status is not EMPTY'), ['status:Done', 'status:EMPTY']);
  assert.deepEqual(lits('created > -1d AND summary ~ "a \\"b\\""'), ['field:created', 'field:summary']);
});

test('parsing: empty input and an unterminated quote do not throw', () => {
  assert.deepEqual(lits(''), []);
  assert.doesNotThrow(() => extractReferences('status = "In Review AND project = X'));
});

test('parsing: a 2000-clause query is read quickly', () => {
  const jql = Array.from({ length: 2000 }, (_, i) => `project = P${i}`).join(' AND ');
  const started = performance.now();
  assert.equal(extractReferences(jql).length, 2000);
  assert.ok(performance.now() - started < 500);
});

const SRC = {
  project: [{ id: '10100', key: 'BIL', name: 'Billing' }],
  status: [{ id: '3', name: 'DONE' }, { id: '4', name: 'Open' }],
};
const CLOUD = {
  project: [{ id: '10300', key: 'BILL', name: 'Billing' }],
  status: [{ id: '10006', name: 'Done' }, { id: '10007', name: 'Open' }],
};
const run = (srcJql, cloudJql, cloudEntities = CLOUD) => analyse(world(SRC, srcJql), world(cloudEntities, cloudJql)).reports[0];

test('rewrite: repeated literals, lists, trailing ORDER BY and case-insensitive names', () => {
  const r = run('status = 3 OR status in (3, 4) ORDER BY created DESC', 'status = 3 OR status in (3, 4) ORDER BY created DESC');
  assert.equal(r.proposed, 'status = 10006 OR status in (10006, 10007) ORDER BY created DESC');
});

test('rewrite is a fixed point: repairing the repaired query changes nothing', () => {
  const r = run('project = 10100 AND status = 3', 'project = 10100 AND status = 3');
  assert.equal(r.proposed, 'project = 10300 AND status = 10006');
  const again = run('project = 10100 AND status = 3', r.proposed);
  assert.equal(needsRepair(again), false);
  assert.deepEqual(openFindings(again), []);
});

test('a project whose key changed is repaired by identity, not by key', () => {
  assert.equal(run('project = BIL', 'project = BIL').proposed, 'project = 10300');
});

test('two Cloud entities with the same name are ambiguous: flagged, never guessed', () => {
  const twins = { ...CLOUD, status: [...CLOUD.status, { id: '10099', name: 'done' }] };
  const r = run('status = 3', 'status = 3', twins);
  assert.equal(r.proposed, 'status = 3');
  assert.deepEqual(openFindings(r).map((f) => f.status), ['ambiguous']);
});

test('a query JCMA restructured is flagged and left untouched', () => {
  const r = run('project = 10100 AND status = 3', 'project = 10300');
  assert.equal(r.proposed, 'project = 10300');
  assert.deepEqual(r.findings.map((f) => f.status), ['structure-changed']);
});

test('an ID mapping report with a byte-order mark still has its header skipped', () => {
  const ids = parseIdMapping('\uFEFFEntity Type,Server ID,Cloud ID\nt:i,1,2\n');
  assert.equal(ids.size, 1);
  assert.equal(ids.get('t:i', '1'), '2');
});

test('filters sharing an owner and name are never paired by guessing', () => {
  const twin = (id, jql) => ({ id, ownerEmail: owner, name: 'Dup', jql });
  const src = { entities: SRC, filters: [twin('1', 'status = 3'), twin('2', 'status = 4')] };
  const cld = { entities: CLOUD, filters: [twin('a', 'status = 3'), twin('b', 'status = 4')] };
  const { reports, ambiguousPairs, notMigrated } = analyse(src, cld);
  assert.equal(reports.length, 0);
  assert.equal(notMigrated.length, 0);
  assert.deepEqual(ambiguousPairs.map((a) => [a.id, a.candidates]), [['1', ['a', 'b']], ['2', ['a', 'b']]]);
  assert.match(ambiguousPairs[0].reason, /supply the ID Mapping Report/);
});

test('the ID Mapping Report resolves duplicates, and one Cloud filter is never claimed twice', () => {
  const twin = (id, jql) => ({ id, ownerEmail: owner, name: 'Dup', jql });
  const src = { entities: SRC, filters: [twin('1', 'status = 3'), twin('2', 'status = 4')] };
  const cld = { entities: CLOUD, filters: [twin('a', 'status = 3'), twin('b', 'status = 4')] };
  const paired = analyse(src, cld, { pairById: (id) => ({ 1: 'a', 2: 'b' })[id] });
  assert.deepEqual(paired.reports.map((r) => [r.filterId, r.proposed]), [['a', 'status = 10006'], ['b', 'status = 10007']]);
  const clash = analyse(src, cld, { pairById: () => 'a' });
  assert.deepEqual(clash.reports.map((r) => r.filterId), ['a']);
  assert.match(clash.ambiguousPairs[0].reason, /already paired with another source filter/);
});

test('a report row pointing at a missing Cloud filter is not-migrated, never a name-based guess', () => {
  const f = { id: '1', ownerEmail: owner, name: 'Same', jql: 'status = 3' };
  const { reports, notMigrated } = analyse({ entities: SRC, filters: [f] }, { entities: CLOUD, filters: [{ ...f, id: 'z' }] }, { pairById: () => 'gone' });
  assert.equal(reports.length, 0);
  assert.deepEqual(notMigrated.map((n) => n.id), ['1']);
});
