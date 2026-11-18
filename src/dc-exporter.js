import { readBoardConfig, readBoards, readDcBoardIssues } from './board-readers.js';
import { extractReferences } from './jql.js';
import { parseSnapshot } from './snapshot.js';

const plain = ({ id, name }) => ({ id: String(id), name });

async function readDcResult(getJson, jql, cap) {
  const q = encodeURIComponent(jql);
  const { total } = await getJson(`/rest/api/2/search?jql=${q}&fields=id&maxResults=0`);
  if (typeof total !== 'number') throw new Error('the search response had no numeric total');
  if (total > cap) return { total };
  const ids = [];
  while (ids.length < total) {
    const page = await getJson(`/rest/api/2/search?jql=${q}&fields=id&startAt=${ids.length}&maxResults=100`);
    if (page.issues.length === 0) break;
    ids.push(...page.issues.map((i) => String(i.id)));
  }
  return ids.length === total ? { total, ids } : { total };
}

/**
 * Read-only by construction: the only thing it can do is GET. Authorization is the full header value
 * (for example "Bearer <token>" or "Basic <base64>") so no credential scheme is assumed.
 * @param {{ baseUrl: string, authorization: string, fetchImpl?: typeof fetch }} options
 * @returns {import('./board-readers.js').GetJson}
 */
export function makeDcGetJson({ baseUrl, authorization, fetchImpl = fetch }) {
  const root = baseUrl.replace(/\/+$/, '');
  return async (path) => {
    const res = await fetchImpl(`${root}${path}`, { method: 'GET', headers: { Authorization: authorization, Accept: 'application/json' } });
    if (!res.ok) {
      throw new Error(`GET ${path} failed with HTTP ${res.status}. Check the base URL and credential, and that the account can view this item.`);
    }
    return res.json();
  };
}

/**
 * Builds the snapshot Afterflight compares against Cloud. There is no list-all-filters route in the DC docs
 * reviewed, so filters come from `filterIds` (the ID Mapping Report) plus every board's filter. A missing
 * optional item becomes a warning; the required entity lists failing aborts the export.
 * Each filter's result is read with its own JQL: the count always (fields=id&maxResults=0 returns the total), the issue ids only
 * when the total is within `resultIdCap`, so a huge filter is compared by count.
 * @param {{ getJson: import('./board-readers.js').GetJson, filterIds?: string[], includeResults?: boolean, resultIdCap?: number }} input
 */
export async function exportDcSnapshot({ getJson, filterIds = [], includeResults = true, resultIdCap = 2000 }) {
  const warnings = [];
  const attempt = async (label, run) => {
    try {
      return await run();
    } catch (error) {
      warnings.push(`${label}: ${error.message}`);
      return undefined;
    }
  };

  const projects = await getJson('/rest/api/2/project');
  const statuses = await getJson('/rest/api/2/status');
  const issuetypes = await getJson('/rest/api/2/issuetype');
  const priorities = await getJson('/rest/api/2/priority');
  const fields = await getJson('/rest/api/2/field');

  const boards = [];
  for (const board of await readBoards(getJson)) {
    const config = await attempt(`board ${board.id} configuration`, () => readBoardConfig(getJson, board.id));
    const found = config && await attempt(`board ${board.id} issues`, () => readDcBoardIssues(getJson, board.id));
    if (!found) continue;
    if (found.total !== undefined && found.issues.length < found.total) {
      warnings.push(`board ${board.id} ("${board.name}"): ${found.issues.length} of ${found.total} issues returned. DC can truncate at jira.search.views.default.max, so issues reported missing in Cloud may be false alarms.`);
    }
    boards.push({ id: board.id, name: board.name, config, issues: found.issues, issueTotal: found.total });
  }

  const wanted = [...new Set([...filterIds, ...boards.map((b) => b.config.filter.id)].map(String))];
  const filters = [];
  for (const id of wanted) {
    const filter = await attempt(`filter ${id}`, () => getJson(`/rest/api/2/filter/${encodeURIComponent(id)}`));
    if (!filter) continue;
    const entry = { id: String(filter.id), name: filter.name, ownerEmail: filter.owner?.emailAddress ?? '', jql: filter.jql };
    if (includeResults) {
      entry.results = await attempt(`filter ${id} results`, () => readDcResult(getJson, filter.jql, resultIdCap));
    }
    filters.push(entry);
  }

  const usernames = [...new Set(filters.flatMap((f) => extractReferences(f.jql)).filter((r) => r.type === 'user').map((r) => r.literal))];
  const users = [];
  for (const username of usernames) {
    const user = await attempt(`user ${username}`, () => getJson(`/rest/api/2/user?username=${encodeURIComponent(username)}`));
    if (user) users.push({ id: user.name, name: user.displayName, email: user.emailAddress });
  }

  const snapshot = {
    entities: {
      project: projects.map((p) => ({ ...plain(p), key: p.key })),
      status: statuses.map(plain),
      issuetype: issuetypes.map(plain),
      priority: priorities.map(plain),
      field: fields.map(plain),
      user: users,
    },
    filters,
    boards,
  };
  parseSnapshot(JSON.stringify(snapshot));
  return { snapshot, warnings };
}
