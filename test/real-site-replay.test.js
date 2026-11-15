import test from 'node:test';
import assert from 'node:assert/strict';
import { analyse, needsRepair, openFindings } from '../src/engine.js';

// Cloud entities below were read (read-only) from a real Jira Cloud site on 2026-11-15: one project and its 16 statuses.
// The Data Center side and the two saved filters are SYNTHETIC replays of queries run against that site:
//   "project = 10100 AND status = 3"     -> Atlassian answered HTTP 400, "A value with ID '10100' does not exist for the field 'project'."
//   "project = 10000 AND status = 10000" -> Atlassian accepted it with no error (status 10000 is "Waiting for support" there).
const REAL_STATUSES = [
  ['1', 'Open'], ['3', 'In Progress'], ['4', 'Reopened'], ['5', 'Resolved'], ['6', 'Closed'], ['10000', 'Waiting for support'],
  ['10001', 'Canceled'], ['10002', 'Added to backlog'], ['10003', 'Work in progress'], ['10004', 'Triaged'], ['10005', 'Waiting for customer'],
  ['10006', 'Done'], ['10007', 'Pending'], ['10008', 'Completed'], ['10009', 'Pending on reporter'], ['10010', 'Escalated'],
].map(([id, name]) => ({ id, name }));
const owner = 'owner@example.com';

const cloud = {
  entities: { project: [{ id: '10000', key: 'DEV', name: 'Development Requests Project' }], status: REAL_STATUSES },
  filters: [
    { id: '1', ownerEmail: owner, name: 'Dev stale project', jql: 'project = 10100 AND status = 3' },
    { id: '2', ownerEmail: owner, name: 'Dev done', jql: 'project = DEV AND status = 10000' },
  ],
};
const source = {
  entities: {
    project: [{ id: '10100', key: 'DEV', name: 'Development Requests Project' }],
    status: [{ id: '3', name: 'In Progress' }, { id: '10000', name: 'Done' }],
  },
  filters: [
    { id: '1', ownerEmail: owner, name: 'Dev stale project', jql: 'project = 10100 AND status = 3' },
    { id: '2', ownerEmail: owner, name: 'Dev done', jql: 'project = DEV AND status = 10000' },
  ],
};
const { reports } = analyse(source, cloud);
const report = (name) => reports.find((r) => r.name === name);

test('a stale project id: Atlassian only errors, Afterflight names the right id', () => {
  const r = report('Dev stale project');
  assert.equal(r.findings[0].status, 'stale');
  assert.equal(r.findings[1].status, 'ok');
  assert.equal(r.proposed, 'project = 10000 AND status = 3');
});

test('a status id that now means something else: Atlassian accepts it, Afterflight flags and fixes it', () => {
  const r = report('Dev done');
  assert.equal(r.findings[0].status, 'ok');
  assert.deepEqual([r.findings[1].status, r.findings[1].meant, r.findings[1].resolvesNowTo], ['wrong-entity', 'Done', 'Waiting for support']);
  assert.equal(r.proposed, 'project = DEV AND status = 10006');
  assert.equal(needsRepair(r), true);
  assert.deepEqual(openFindings(r), []);
});
