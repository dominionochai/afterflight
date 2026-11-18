/**
 * Forge's api.asUser().requestJira, with the route already trusted. Payloads are Atlassian JSON;
 * the readers below pick only the fields they need.
 * @typedef {(path: string, init?: { method?: string, headers?: Record<string, string>, body?: string }) =>
 *   Promise<{ ok: boolean, status: number, json: () => Promise<any>, text: () => Promise<string> }>} RequestJira
 */

export async function getJson(requestJira, path) {
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
        throw new Error(`PUT /rest/api/3/filter/${id} failed with HTTP ${res.status}: ${await res.text()}. Jira only lets a filter's owner update it, so sign in as the owner or ask them to apply this repair.`);
      }
    },
  };
}

/**
 * Advanced Roadmaps plans on Cloud. The list route already carries each plan's issue sources. The route is
 * experimental, needs a Jira Premium site and the Administer Jira permission, and returns active plans only.
 * @param {RequestJira} requestJira
 * @returns {Promise<{ id: string, name: string, status: string, issueSources: { type: string, value: string }[] }[]>}
 */
export async function readPlans(requestJira) {
  const plans = [];
  for (let cursor = ''; ; ) {
    const page = await getJson(requestJira, `/rest/api/3/plans/plan?maxResults=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    for (const p of page.values) {
      plans.push({
        id: String(p.id),
        name: p.name,
        status: p.status,
        issueSources: (p.issueSources ?? []).map((s) => ({ type: s.type, value: String(s.value) })),
      });
    }
    cursor = page.nextPageCursor;
    if (!cursor || page.isLast === true || page.last === true || page.values.length === 0) return plans;
  }
}

/**
 * Issue ids a JQL string returns on Cloud (enhanced search, ids only, token paging). Cloud requires a bounded query,
 * so a filter with no restriction fails here and is reported by the caller. Results are limited to what the signed-in
 * user may browse, and very recent changes may not be visible yet. The `cap` stops a huge result from being read whole.
 * @param {RequestJira} requestJira @param {string} jql @param {number} [cap]
 * @returns {Promise<{ ids: string[], capped: boolean }>}
 */
export async function searchIssueIds(requestJira, jql, cap = 5000) {
  const ids = [];
  for (let token; ; ) {
    const res = await requestJira('/rest/api/3/search/jql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ jql, fields: ['id'], maxResults: Math.min(5000, cap - ids.length), ...(token ? { nextPageToken: token } : {}) }),
    });
    if (!res.ok) throw new Error(`POST /rest/api/3/search/jql failed with HTTP ${res.status}: ${await res.text()}`);
    const page = await res.json();
    ids.push(...page.issues.map((i) => String(i.id)));
    token = page.nextPageToken;
    if (!token || page.isLast === true) return { ids, capped: false };
    if (ids.length >= cap) return { ids, capped: true };
  }
}
