import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportDcSnapshot, makeDcGetJson } from '../src/dc-exporter.js';
import { main } from '../src/dc-cli.js';
import { parseSnapshot } from '../src/snapshot.js';

// SYNTHETIC: a local HTTP server standing in for Jira Data Center. Never a real DC response.
const column = (name, ...ids) => ({ name, statuses: ids.map((id) => ({ id })) });
const ROUTES = {
  '/rest/api/2/project': [{ id: '10100', key: 'BIL', name: 'Billing' }],
  '/rest/api/2/status': [{ id: '3', name: 'To Do' }, { id: '4', name: 'Done' }],
  '/rest/api/2/issuetype': [],
  '/rest/api/2/priority': [],
  '/rest/api/2/field': [{ id: 'customfield_10016', name: 'Story Points', custom: true }],
  '/rest/agile/1.0/board': { values: [{ id: 7, name: 'Billing board', type: 'scrum' }, { id: 8, name: 'Big board', type: 'kanban' }], isLast: true },
  '/rest/agile/1.0/board/7/configuration': { filter: { id: '100' }, columnConfig: { columns: [column('To Do', '3'), column('Done', '4')] } },
  '/rest/agile/1.0/board/8/configuration': { filter: { id: '101' }, columnConfig: { columns: [column('To Do', '3')] } },
  '/rest/api/2/filter/100': { id: '100', name: 'Billing open', jql: 'project = BIL AND assignee = jsmith', owner: { name: 'jsmith', emailAddress: 'john@example.com' } },
  '/rest/api/2/filter/555': { id: '555', name: 'Extra', jql: 'status = Done', owner: { name: 'x' } },
  '/rest/api/2/user?username=jsmith': { name: 'jsmith', displayName: 'John Smith', emailAddress: 'john@example.com' },
};
const BOARD_ISSUES = { 7: { total: 3, all: [1, 2, 3] }, 8: { total: 5, all: [4, 5] } };

function startFakeDc() {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push({ method: req.method, auth: req.headers.authorization, url: req.url });
    const url = new URL(req.url, 'http://x.invalid');
    const issuesFor = url.pathname.match(/^\/rest\/agile\/1\.0\/board\/(\d+)\/issue$/);
    let payload = ROUTES[req.url] ?? ROUTES[url.pathname];
    if (issuesFor) {
      const { total, all } = BOARD_ISSUES[issuesFor[1]];
      const startAt = Number(url.searchParams.get('startAt'));
      payload = { total, issues: all.slice(startAt, startAt + 2).map((id) => ({ id: String(id), fields: { status: { id: '3' } } })) };
    }
    res.writeHead(payload ? 200 : 404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload ?? {}));
  });
  return new Promise((resolve) => server.listen(0, () => resolve({ server, seen, baseUrl: `http://127.0.0.1:${server.address().port}/` })));
}

test('export is GET-only, sends the credential, validates, fetches filters by id and users from JQL', async () => {
  const dc = await startFakeDc();
  try {
    const getJson = makeDcGetJson({ baseUrl: dc.baseUrl, authorization: 'Bearer testtoken' });
    const { snapshot, warnings } = await exportDcSnapshot({ getJson, filterIds: ['100', '555'] });
    assert.ok(dc.seen.length > 10);
    assert.ok(dc.seen.every((r) => r.method === 'GET' && r.auth === 'Bearer testtoken'));
    assert.deepEqual(snapshot.filters.map((f) => f.id), ['100', '555']);
    assert.deepEqual(snapshot.entities.user, [{ id: 'jsmith', name: 'John Smith', email: 'john@example.com' }]);
    assert.equal(snapshot.filters[0].ownerEmail, 'john@example.com');
    assert.equal(snapshot.filters[1].ownerEmail, '');
    assert.deepEqual(snapshot.boards.map((b) => [b.id, b.issues.length, b.issueTotal]), [['7', 3, 3], ['8', 2, 5]]);
    assert.equal(warnings.length, 2);
    assert.match(warnings.join('\n'), /filter 101: GET \/rest\/api\/2\/filter\/101 failed with HTTP 404/);
    assert.match(warnings.join('\n'), /board 8 \("Big board"\): 2 of 5 issues returned.*false alarms/);
    assert.equal(parseSnapshot(JSON.stringify(snapshot)).boards.length, 2);
  } finally {
    dc.server.close();
  }
});

test('a required list failing aborts the export with the path in the error', async () => {
  const getJson = makeDcGetJson({ baseUrl: 'http://127.0.0.1:1/', authorization: 'x', fetchImpl: async () => ({ ok: false, status: 401 }) });
  await assert.rejects(exportDcSnapshot({ getJson }), /GET \/rest\/api\/2\/project failed with HTTP 401/);
});

test('CLI reads filter ids from the ID mapping report, takes the credential from env, and writes the snapshot', async () => {
  const dc = await startFakeDc();
  try {
    const dir = await mkdtemp(join(tmpdir(), 'afterflight-'));
    const report = join(dir, 'report.csv');
    const out = join(dir, 'snapshot.json');
    await writeFile(report, 'Entity Type,Server ID,Cloud ID\ntest:filter,555,9555\ntest:other,1,2\n');
    const lines = [];
    await main(['--base-url', dc.baseUrl, '--out', out, '--id-mapping', report, '--filter-type', 'test:filter'], { AFTERFLIGHT_DC_AUTH: 'Bearer t' }, (l) => lines.push(l));
    const written = JSON.parse(await readFile(out, 'utf8'));
    assert.deepEqual(written.filters.map((f) => f.id), ['555', '100']);
    assert.match(lines.at(-1), /Wrote .*snapshot\.json: 2 filters, 2 boards, 1 projects\./);
    assert.ok(lines.some((l) => l.startsWith('WARNING ')));
  } finally {
    dc.server.close();
  }
});

test('CLI explains missing configuration instead of guessing', async () => {
  await assert.rejects(main(['--out', 'x.json'], {}), /Usage: node bin\/export-dc\.js/);
  await assert.rejects(main(['--out', 'x', '--base-url', 'http://h', '--id-mapping', 'r.csv'], { AFTERFLIGHT_DC_AUTH: 'a' }), /--filter-type/);
});
