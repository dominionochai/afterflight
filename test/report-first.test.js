import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeJira } from '../fixtures/fake-jira.js';
import { analyse, openFindings } from '../src/engine.js';
import { DEFAULT_ENTITY_TYPES } from '../src/entity-types.js';
import { runAnalysis } from '../src/service.js';

const owner = 'o@example.com';
const world = (entities, jql) => ({ entities, filters: [{ id: '1', ownerEmail: owner, name: 'f', jql }] });
const rows = (table) => (type, id) => table[`${type}:${id}`];
const run = (src, cloud, jql, mapId) => analyse(world(src, jql), world(cloud, jql), { mapId }).reports[0];

test('published entity types match Atlassian\'s namespace list and cannot be mutated', () => {
  assert.deepEqual({ ...DEFAULT_ENTITY_TYPES }, {
    board: 'jira/classic/software:rapidView', component: 'jira:projectComponent', field: 'jira/classic:customField', filter: 'jira:filter',
    issue: 'jira:issue', issuetype: 'jira/classic:issueType', priority: 'jira:priority', project: 'jira/classic:project',
    status: 'jira/classic:issueStatus', version: 'jira:projectVersion',
  });
  assert.throws(() => { 'use strict'; DEFAULT_ENTITY_TYPES.board = 'x'; }, TypeError);
});

test('a status renamed in Cloud is found through the report, where name matching alone flags it', () => {
  const src = { status: [{ id: '3', name: 'Done' }] };
  const cloud = { status: [{ id: '10006', name: 'Completed' }] };
  assert.deepEqual(openFindings(run(src, cloud, 'status = 3')).map((f) => f.status), ['missing']);
  const r = run(src, cloud, 'status = 3', rows({ 'status:3': '10006' }));
  assert.equal(r.proposed, 'status = 10006');
  assert.deepEqual(openFindings(r), []);
});

test('two Cloud entities with the same name are no longer ambiguous when the report names the right one', () => {
  const src = { status: [{ id: '3', name: 'Done' }] };
  const cloud = { status: [{ id: '10006', name: 'Done' }, { id: '10099', name: 'done' }] };
  assert.deepEqual(openFindings(run(src, cloud, 'status = 3')).map((f) => f.status), ['ambiguous']);
  assert.equal(run(src, cloud, 'status = 3', rows({ 'status:3': '10099' })).proposed, 'status = 10099');
});

test('a report row pointing at something that no longer exists is flagged, never replaced by a name guess', () => {
  const src = { status: [{ id: '3', name: 'Done' }] };
  const cloud = { status: [{ id: '10006', name: 'Done' }] };
  const r = run(src, cloud, 'status = 3', rows({ 'status:3': '99999' }));
  assert.equal(r.proposed, 'status = 3');
  const [finding] = openFindings(r);
  assert.deepEqual([finding.status, finding.mappedCloudId], ['missing', '99999']);
});

test('custom fields map whether the report writes the id with or without the customfield_ prefix', () => {
  const src = { field: [{ id: 'customfield_10042', name: 'Team' }] };
  const cloud = { field: [{ id: 'customfield_10010', name: 'Squad' }] };
  for (const table of [{ 'field:10042': '10010' }, { 'field:customfield_10042': 'customfield_10010' }, { 'field:10042': 'customfield_10010' }]) {
    assert.equal(run(src, cloud, 'cf[10042] = x', rows(table)).proposed, 'cf[10010] = x', JSON.stringify(table));
  }
});

test('runAnalysis reads the report with Atlassian\'s published names and fixes a renamed status end to end', async () => {
  const entities = { project: [], user: [], status: [{ id: '10006', name: 'Completed' }] };
  const source = { entities: { status: [{ id: '3', name: 'Done' }] }, filters: [{ id: '1', ownerEmail: owner, name: 'f', jql: 'status = 3' }] };
  const cloud = { entities, filters: [{ id: '20001', ownerEmail: owner, name: 'f', jql: 'status = 3' }] };
  const result = await runAnalysis({
    snapshotText: JSON.stringify(source),
    requestJira: fakeJira(cloud).request,
    idMappingCsv: 'Entity Type,Server ID,Cloud ID\njira:filter,1,20001\njira/classic:issueStatus,3,10006\n',
  });
  assert.equal(result.filters[0].proposed, 'status = 10006');
  assert.deepEqual(result.filters[0].open, []);
});
