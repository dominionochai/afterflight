/**
 * Forge's api.asUser().requestJira, with the route already trusted. Payloads are Atlassian JSON;
 * the readers below pick only the fields they need.
 * @typedef {(path: string, init?: { method?: string, headers?: Record<string, string>, body?: string }) =>
 *   Promise<{ ok: boolean, status: number, json: () => Promise<any>, text: () => Promise<string> }>} RequestJira
 */

async function getJson(requestJira, path) {
  const res = await requestJira(path);
  if (!res.ok) {
    throw new Error(`GET ${path} failed with HTTP ${res.status}: ${await res.text()}. Check the app's scopes and the admin's permissions.`);
  }
  return res.json();
}

async function boundedPages(requestJira, path) {
  const joiner = path.includes('?') ? '&' : '?';
  const out = [];
  for (let startAt = 0; ; ) {
    const page = await getJson(requestJira, `${path}${joiner}startAt=${startAt}&maxResults=100`);
    out.push(...page.values);
    if (page.isLast || page.values.length === 0) return out;
    startAt += page.values.length;
  }
}

async function userPages(requestJira) {
  const out = [];
  for (let startAt = 0; ; startAt += 100) {
    const page = await getJson(requestJira, `/rest/api/3/users/search?startAt=${startAt}&maxResults=100`);
    out.push(...page);
    if (page.length < 100) return out;
  }
}

const nameOnly = ({ id, name }) => ({ id: String(id), name });

/**
 * @param {RequestJira} requestJira
 * @returns {Promise<import('./engine.js').World>}
 */
export async function readCloudWorld(requestJira) {
  const [projects, statuses, issuetypes, priorities, fields, users, filters] = await Promise.all([
    boundedPages(requestJira, '/rest/api/3/project/search'),
    getJson(requestJira, '/rest/api/3/status'),
    getJson(requestJira, '/rest/api/3/issuetype'),
    boundedPages(requestJira, '/rest/api/3/priority/search'),
    getJson(requestJira, '/rest/api/3/field'),
    userPages(requestJira),
    boundedPages(requestJira, '/rest/api/3/filter/search?expand=jql,owner'),
  ]);
  const perProject = (suffix) => Promise.all(projects.map((p) => getJson(requestJira, `/rest/api/3/project/${p.id}/${suffix}`)));
  const [versions, components] = await Promise.all([perProject('versions'), perProject('components')]);
  return {
    entities: {
      project: projects.map((p) => ({ ...nameOnly(p), key: p.key })),
      status: statuses.map(nameOnly),
      issuetype: issuetypes.map(nameOnly),
      priority: priorities.map(nameOnly),
      field: fields.map(nameOnly),
      user: users
        .filter((u) => u.accountType === 'atlassian')
        .map((u) => ({ id: u.accountId, name: u.displayName, email: u.emailAddress })),
      version: versions.flat().map(nameOnly),
      component: components.flat().map(nameOnly),
    },
    filters: filters.map((f) => ({
      id: String(f.id),
      name: f.name,
      ownerEmail: f.owner?.emailAddress ?? '',
      jql: f.jql,
    })),
  };
}

/** @param {RequestJira} requestJira */
export function filterIo(requestJira) {
  return {
    readJql: async (id) => (await getJson(requestJira, `/rest/api/3/filter/${id}`)).jql,
    writeJql: async (id, jql) => {
      const { name } = await getJson(requestJira, `/rest/api/3/filter/${id}`);
      const res = await requestJira(`/rest/api/3/filter/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ name, jql }),
      });
      if (!res.ok) {
        throw new Error(`PUT /rest/api/3/filter/${id} failed with HTTP ${res.status}: ${await res.text()}. The signed-in admin may not be allowed to edit this filter.`);
      }
    },
  };
}
