// SYNTHETIC: an in-memory stand-in for the Jira Cloud REST API, used only by tests. Its JQL parse route reads references with
// Afterflight's own extractor and mimics what Atlassian showed on a real site: unknown ids are warnings, unknown cf[] ids are errors,
// and user values are never checked.
import { extractReferences } from '../src/jql.js';

export function fakeJira(world, { pageSize = 2, status = 200, denyPut = [], boards = {}, plans, brokenBoards = [], parseExtra = {}, parseStatus = 200, searches = {}, unbounded = [] } = {}) {
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
    if (filterId && init.method === 'PUT' && denyPut.includes(filterId)) {
      return { ok: false, status: 403, json: async () => ({}), text: async () => 'Only the owner can edit this filter' };
    }
    if (filterId && init.method === 'PUT') {
      const { name, jql } = JSON.parse(init.body);
      writes.push({ id: filterId, name, jql });
      filters.get(filterId).jql = jql;
      return body({});
    }
    if (filterId) return body(asFilter(filters.get(filterId)));
    if (url.pathname === '/rest/api/3/jql/parse' && init.method === 'POST') {
      if (parseStatus >= 400) return { ok: false, status: parseStatus, json: async () => ({}), text: async () => 'parse unavailable' };
      const exists = (type, literal) => {
        const list = type === 'filter' ? [...filters.values()] : (world.entities[type] ?? []);
        const wanted = literal.toLowerCase();
        return list.some((e) => e.id.toLowerCase() === wanted || e.key?.toLowerCase() === wanted || e.name.toLowerCase() === wanted);
      };
      const queries = JSON.parse(init.body).queries.map((query) => {
        const refs = extractReferences(query);
        const warnings = refs
          .filter((r) => ['project', 'status', 'issuetype', 'priority', 'version', 'component', 'filter'].includes(r.type) && !exists(r.type, r.literal))
          .map((r) => `The value '${r.literal}' does not exist for the field '${r.type}'.`);
        const errors = refs
          .filter((r) => r.type === 'field' && /^cf\[\d+\]$/.test(r.literal) && !(world.entities.field ?? []).some((f) => f.id === r.literal.replace(/^cf\[(\d+)\]$/, 'customfield_$1')))
          .map((r) => `Field '${r.literal}' does not exist or you do not have permission to view it.`);
        return { query, ...(errors.length ? { errors } : {}), warnings: [...warnings, ...(parseExtra[query] ?? [])] };
      });
      return body({ queries });
    }
    if (url.pathname === '/rest/api/3/search/jql' && init.method === 'POST') {
      const request = JSON.parse(init.body);
      if (unbounded.includes(request.jql)) return { ok: false, status: 400, json: async () => ({}), text: async () => 'Unbounded JQL queries are not allowed here.' };
      const all = searches[request.jql] ?? [];
      const from = Number(request.nextPageToken ?? 0);
      const size = Math.min(pageSize, request.maxResults ?? pageSize);
      const next = from + size;
      return body({ issues: all.slice(from, next).map((id) => ({ id: String(id) })), isLast: next >= all.length, ...(next < all.length ? { nextPageToken: String(next) } : {}) });
    }
    const quick = url.pathname.match(/^\/rest\/agile\/1\.0\/board\/(\d+)\/quickfilter$/);
    if (quick && brokenBoards.includes(quick[1])) return { ok: false, status: 403, json: async () => ({}), text: async () => 'no access to this board' };
    if (quick) {
      const all = (boards[quick[1]].quickFilters ?? []).map((q, i) => ({ boardId: Number(quick[1]), id: i + 1, ...q }));
      return body(page(all, startAt));
    }
    const boardConfig = url.pathname.match(/^\/rest\/agile\/1\.0\/board\/(\d+)\/configuration$/);
    if (boardConfig && brokenBoards.includes(boardConfig[1])) return { ok: false, status: 403, json: async () => ({}), text: async () => 'no access to this board' };
    if (boardConfig) return body(boards[boardConfig[1]].config);
    if (url.pathname === '/rest/agile/1.0/board') {
      const all = Object.keys(boards).map((id) => ({ id: Number(id), name: boards[id].name ?? `Board ${id}`, type: 'scrum' }));
      return body(page(all, startAt));
    }
    const boardIssues = url.pathname.match(/^\/rest\/software\/1\.0\/board\/(\d+)\/issue$/);
    if (boardIssues) {
      const all = boards[boardIssues[1]].issues;
      const from = Number(url.searchParams.get('nextPageToken') ?? 0);
      const next = from + pageSize;
      const issues = all.slice(from, next).map((i) => ({ id: i.id, key: `K-${i.id}`, fields: { status: { id: i.statusId } } }));
      return body({ issues, ...(next < all.length ? { nextPageToken: String(next) } : {}) });
    }
    if (url.pathname === '/rest/api/3/plans/plan') {
      if (!plans) return { ok: false, status: 403, json: async () => ({}), text: async () => 'Premium edition required' };
      const from = Number(url.searchParams.get('cursor') || 0);
      const next = from + pageSize;
      return body({ values: plans.slice(from, next), ...(next < plans.length ? { nextPageCursor: String(next) } : { isLast: true }) });
    }
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
