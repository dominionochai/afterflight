import test from 'node:test';
import assert from 'node:assert/strict';
import { source, cloud } from '../fixtures/synthetic.js';
import { analyse, applyRepairs, needsRepair, openFindings, verify } from '../src/engine.js';
import { extractReferences } from '../src/jql.js';

const { reports, notMigrated } = analyse(source, cloud);
const report = (name) => reports.find((r) => r.name === name);

test('extractReferences reads lists, skips functions and ORDER BY, keeps quote-inclusive spans', () => {
  const jql = 'status in ("In Review", Done) AND assignee = currentUser() ORDER BY created DESC';
  const refs = extractReferences(jql);
  assert.deepEqual(refs.map((r) => [r.type, r.literal]), [['status', 'In Review'], ['status', 'Done']]);
  assert.equal(jql.slice(refs[0].start, refs[0].end), '"In Review"');
});

test('project id reused by another project is caught and repaired (valid-but-wrong JQL)', () => {
  const r = report('Billing open');
  const project = r.findings[0];
  assert.equal(project.status, 'wrong-entity');
  assert.equal(project.resolvesNowTo, 'Platform');
  assert.equal(r.proposed, 'project = 10300 AND status = 10002');
});

test('repair keeps the original and passes re-verification', () => {
  const r = report('Billing open');
  assert.equal(r.original, 'project = 10100 AND status = 3');
  assert.deepEqual(verify(r, source, cloud), { hasStaleReferences: false, remaining: [] });
});

test('DC username becomes a quoted Cloud accountId via email; custom field id is remapped', () => {
  assert.equal(report('Team work').proposed, 'cf[10055] = "Apollo" AND assignee = "557058:f58131cb"');
});

test('missing status is detected and not guessed', () => {
  const r = report('Needs review');
  assert.equal(r.proposed, r.original);
  assert.deepEqual(openFindings(r).map((f) => [f.type, f.status, f.meant]), [['status', 'missing', 'In Review']]);
});

test('renamed custom field is flagged for every filter using it, query untouched', () => {
  const affected = reports.filter((r) => openFindings(r).some((f) => f.type === 'field' && f.status === 'missing'));
  assert.deepEqual(affected.map((r) => r.name), ['Points']);
  assert.equal(report('Points').proposed, report('Points').original);
});

test('filter that depends on an unmigrated filter is flagged, and the filter itself is listed', () => {
  assert.deepEqual(notMigrated.map((f) => f.name), ['Legacy bugs']);
  assert.deepEqual(openFindings(report('Combined')).map((f) => [f.type, f.status, f.meant]), [['filter', 'missing', 'Legacy bugs']]);
  assert.equal(report('Combined').findings.find((f) => f.type === 'project').status, 'ok');
});

test('interrupted apply resumes without rewriting finished filters', async () => {
  const repairs = reports.filter(needsRepair);
  assert.equal(repairs.length, 2);
  const store = new Map(cloud.filters.map((f) => [f.id, f.jql]));
  const readJql = async (id) => store.get(id);
  let writes = 0;
  const flaky = async (id, jql) => {
    if (++writes === 2) throw new Error('network down');
    store.set(id, jql);
  };
  await assert.rejects(applyRepairs(repairs, { readJql, writeJql: flaky }), /network down/);
  const resumed = await applyRepairs(repairs, { readJql, writeJql: async (id, jql) => void store.set(id, jql) });
  assert.deepEqual(resumed, { done: ['20002'], skipped: ['20001'] });
  for (const r of repairs) assert.equal(store.get(r.filterId), r.proposed);
});

test('apply refuses to overwrite a filter edited after analysis', async () => {
  const [first] = reports.filter(needsRepair);
  const io = { readJql: async () => 'project = 1', writeJql: async () => assert.fail('must not write') };
  await assert.rejects(applyRepairs([first], io), /changed since analysis/);
});
