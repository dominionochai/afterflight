import test from 'node:test';
import assert from 'node:assert/strict';
import { source, cloud } from '../fixtures/synthetic.js';
import { fakeJira } from '../fixtures/fake-jira.js';
import { readPlans } from '../src/cloud-reader.js';
import { runAnalysis } from '../src/service.js';
import { buildIntegrityReport } from '../src/report.js';

// SYNTHETIC plans: shapes follow the documented Cloud list-plans response, ids are made up.
const PLANS = [
  { id: 'p1', name: 'Billing roadmap', status: 'Active', scenarioId: 's1', issueSources: [{ type: 'Filter', value: 20001 }, { type: 'Project', value: 10300 }] },
  { id: 'p2', name: 'Board plan', status: 'Active', scenarioId: 's2', issueSources: [{ type: 'Board', value: 20001 }] },
  { id: 'p3', name: 'Team plan', status: 'Active', scenarioId: 's3', issueSources: [{ type: 'Filter', value: 20002 }] },
];
const snapshotText = JSON.stringify(source);

test('readPlans follows the cursor and normalises ids to strings', async () => {
  const jira = fakeJira(cloud, { pageSize: 2, plans: PLANS });
  const plans = await readPlans(jira.request);
  assert.deepEqual(plans.map((p) => p.id), ['p1', 'p2', 'p3']);
  assert.deepEqual(plans[0].issueSources, [{ type: 'Filter', value: '20001' }, { type: 'Project', value: '10300' }]);
});

test('each filter lists the plans that use it as an issue source; a board with the same number is not a match', async () => {
  const jira = fakeJira(cloud, { plans: PLANS });
  const { filters, plansNote } = await runAnalysis({ snapshotText, requestJira: jira.request });
  const plansOf = (name) => filters.find((f) => f.name === name).plans.map((p) => p.name);
  assert.deepEqual(plansOf('Billing open'), ['Billing roadmap']);
  assert.deepEqual(plansOf('Team work'), ['Team plan']);
  assert.deepEqual(plansOf('Points'), []);
  assert.equal(plansNote, undefined);
});

test('a site without plans access still gets its analysis, with the reason stated', async () => {
  const { filters, plansNote } = await runAnalysis({ snapshotText, requestJira: fakeJira(cloud).request });
  assert.match(plansNote, /Plans were not checked.*HTTP 403.*Jira Premium.*Administer Jira/);
  assert.ok(filters.every((f) => f.plans.length === 0));
  assert.equal(filters.find((f) => f.name === 'Billing open').canRepair, true);
});

test('the report carries the plans note as a caveat', async () => {
  const analysis = await runAnalysis({ snapshotText, requestJira: fakeJira(cloud).request });
  const report = buildIntegrityReport({ generatedAt: 'x', analysis });
  assert.ok(report.caveats.some((c) => c.startsWith('Plans were not checked')));
});
