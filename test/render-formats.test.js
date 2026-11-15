import test from 'node:test';
import assert from 'node:assert/strict';
import { analyse } from '../src/engine.js';

// Formats below were checked against a real Jira Cloud site on 2026-11-15 through its own JQL validation. Every one was accepted:
//   project = 10000 | status = 10006 | issuetype = 10001 | filter = 10000 | cf[10010] is EMPTY | assignee = "<accountId>"
// Negative controls: a nonexistent project, filter or cf[...] id was rejected with HTTP 400. A nonexistent accountId and a leftover
// Data Center username were BOTH accepted with no error, so Atlassian's validation cannot catch a stale user reference.
// IDs here are made up but keep the verified shapes.
const owner = 'o@example.com';
const JQL = 'assignee = jsmith AND cf[10042] = x AND filter = 6 AND issuetype = 1 AND project = 10100 AND status = 3';
const filters = (mainJql, legacyId) => [
  { id: '1', ownerEmail: owner, name: 'Main', jql: mainJql },
  { id: legacyId, ownerEmail: owner, name: 'Legacy', jql: 'project = 10100' },
];
const source = {
  entities: {
    user: [{ id: 'jsmith', name: 'John Smith', email: 'john@example.com' }],
    field: [{ id: 'customfield_10042', name: 'Team' }],
    issuetype: [{ id: '1', name: 'Bug' }],
    project: [{ id: '10100', key: 'DEV', name: 'Development' }],
    status: [{ id: '3', name: 'Done' }],
  },
  filters: filters(JQL, '6'),
};
const cloud = {
  entities: {
    user: [{ id: '557058:f58131cb-0000-0000-0000-000000000000', name: 'John Smith', email: 'john@example.com' }],
    field: [{ id: 'customfield_10010', name: 'Team' }],
    issuetype: [{ id: '10001', name: 'Bug' }],
    project: [{ id: '10000', key: 'DEV', name: 'Development' }],
    status: [{ id: '10006', name: 'Done' }],
  },
  filters: filters(JQL, '10000'),
};

test('every literal Afterflight writes uses a format real Jira Cloud accepted', () => {
  const main = analyse(source, cloud).reports.find((r) => r.name === 'Main');
  assert.equal(
    main.proposed,
    'assignee = "557058:f58131cb-0000-0000-0000-000000000000" AND cf[10010] = x AND filter = 10000 AND issuetype = 10001 AND project = 10000 AND status = 10006',
  );
});
