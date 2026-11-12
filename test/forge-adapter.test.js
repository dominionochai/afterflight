import test from 'node:test';
import assert from 'node:assert/strict';
import { source, cloud } from '../fixtures/synthetic.js';
import { readCloudWorld } from '../src/cloud-reader.js';
import { parseSnapshot } from '../src/snapshot.js';
import { runAnalysis, runApply } from '../src/service.js';

function fakeJira(world, { pageSize = 2, status = 200 } = {}) {
  const filters = new Map(world.filters.map((f) => [f.id, { ...f }]));
  const writes = [];
  const body = (obj) => ({ ok: status < 400, status, json: async () => obj, text: async () => JSON.stringify(obj) });
  const page = (values, startAt) => ({ values: values.slice(startAt, startAt + pageSize), isLast: startAt + pageSize >= values.length });
  const asFilter = (f) => ({ id: f.id, name: f.name, jql: f.jql, owner: { emailAddress: f.ownerEmail } });

  const request = async (path, init = {}) => {
    const url = new URL(path, 'https://x.invalid');
    const startAt = Number(url.searchParams.get('startAt') ?? 0);
    const e = world.entities;
    const plain = (list = []) => list.map(({ id, name }) => ({ id, name }));
    const filterId = url.pathname.match(/^\/rest\/api\/3\/filter\/(\d+)$/)?.[1];
    if (filterId && init.method === 'PUT') {
      const { name, jql } = JSON.parse(init.body);
      writes.push({ id: filterId, name, jql });
      filters.get(filterId).jql = jql;
      return body({});
    }
    if (filterId) return body(asFilter(filters.get(filterId)));
    switch (url.pathname) {
      case '/rest/api/3/project/search': return body(page(e.project, startAt));
      case '/rest/api/3/status': return body(plain(e.status));
      case '/rest/api/3/issuetype': return body(plain(e.issuetype));
      case '/rest/api/3/priority/search': return body(page(plain(e.priority), startAt));
      case '/rest/api/3/field': return body(plain(e.field));
      case '/rest/api/3/users/search': return body(e.user.map((u) => ({ accountId: u.id, displayName: u.name, emailAddress: u.email, accountType: 'atlassian' })));
      case '/rest/api/3/filter/search': return body(page([...filters.values()].map(asFilter), startAt));
      default:
        if (/\/project\/\d+\/(versions|components)$/.test(url.pathname)) return body([]);
        return body({ errorMessages: [`fake Jira has no route ${url.pathname}`] });
    }
  };
  return { request, writes, filters };
}

test('readCloudWorld follows pagination and maps accountId, key and filter owner', async () => {
  const world = await readCloudWorld(fakeJira(cloud, { pageSize: 1 }).request);
  assert.deepEqual(world.entities.project.map((p) => [p.id, p.key]), [['10300', 'BIL'], ['10100', 'PLT']]);
  assert.deepEqual(world.entities.user, [{ id: '557058:f58131cb', name: 'John Smith', email: 'john@example.com' }]);
  assert.equal(world.filters.length, 5);
  assert.equal(world.filters[0].ownerEmail, 'john@example.com');
});

test('a Jira error names the path, the status and the fix', async () => {
  await assert.rejects(readCloudWorld(fakeJira(cloud, { status: 403 }).request), /GET \/rest\/api\/3\/\S+ failed with HTTP 403.*scopes/);
});

test('parseSnapshot rejects bad input with the failing path', () => {
  assert.deepEqual(parseSnapshot(JSON.stringify(source)).filters.length, 6);
  assert.throws(() => parseSnapshot('{nope'), /not valid JSON/);
  const broken = { ...source, filters: [{ id: '1', name: 'x', ownerEmail: 'a@b.c' }] };
  assert.throws(() => parseSnapshot(JSON.stringify(broken)), /filters\[0\] needs a string "jql"/);
});

test('runAnalysis through fake Jira proposes the same repairs as the engine', async () => {
  const { filters, notMigrated } = await runAnalysis({ snapshotText: JSON.stringify(source), requestJira: fakeJira(cloud).request });
  assert.deepEqual(notMigrated.map((f) => f.name), ['Legacy bugs']);
  assert.equal(filters.find((f) => f.name === 'Billing open').proposed, 'project = 10300 AND status = 10002');
  assert.deepEqual(filters.filter((f) => f.canRepair).map((f) => f.name), ['Billing open', 'Team work']);
});

test('runApply writes only chosen repairable filters, keeps names, verifies on live state, and is idempotent', async () => {
  const jira = fakeJira(cloud);
  const input = { snapshotText: JSON.stringify(source), requestJira: jira.request };
  const first = await runApply({ ...input, filterIds: ['20001', '20003', '99999'] });
  assert.deepEqual(first, { done: ['20001'], skipped: [], ignored: ['20003', '99999'], stillStale: [] });
  assert.deepEqual(jira.writes, [{ id: '20001', name: 'Billing open', jql: 'project = 10300 AND status = 10002' }]);
  assert.equal(jira.filters.get('20003').jql, 'status = "In Review"');
  const second = await runApply({ ...input, filterIds: ['20001'] });
  assert.deepEqual(second.done, []);
  assert.equal(jira.writes.length, 1);
});
