// SYNTHETIC: an in-memory stand-in for the Jira Cloud REST API, used only by tests.
export function fakeJira(world, { pageSize = 2, status = 200, denyPut = [], boards = {} } = {}) {
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
    const boardConfig = url.pathname.match(/^\/rest\/agile\/1\.0\/board\/(\d+)\/configuration$/);
    if (boardConfig) return body(boards[boardConfig[1]].config);
    const boardIssues = url.pathname.match(/^\/rest\/software\/1\.0\/board\/(\d+)\/issue$/);
    if (boardIssues) {
      const all = boards[boardIssues[1]].issues;
      const from = Number(url.searchParams.get('nextPageToken') ?? 0);
      const next = from + pageSize;
      const issues = all.slice(from, next).map((i) => ({ id: i.id, key: `K-${i.id}`, fields: { status: { id: i.statusId } } }));
      return body({ issues, ...(next < all.length ? { nextPageToken: String(next) } : {}) });
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
