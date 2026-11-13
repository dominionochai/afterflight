/** @typedef {(path: string) => Promise<any>} GetJson Resolves parsed JSON or throws. Payloads are Atlassian JSON. */

async function startAtPages(getJson, path) {
  const joiner = path.includes('?') ? '&' : '?';
  const out = [];
  for (let startAt = 0; ; ) {
    const page = await getJson(`${path}${joiner}startAt=${startAt}&maxResults=50`);
    out.push(...page.values);
    if (page.isLast || page.values.length === 0) return out;
    startAt += page.values.length;
  }
}

const toIssue = (issue) => {
  const statusId = issue.fields?.status?.id;
  return { id: String(issue.id), statusId: statusId === undefined ? undefined : String(statusId) };
};

/** Boards visible to the caller. Same route and paging on Data Center 9 and Cloud. @param {GetJson} getJson */
export async function readBoards(getJson) {
  const boards = await startAtPages(getJson, '/rest/agile/1.0/board');
  return boards.map(({ id, name, type }) => ({ id: String(id), name, type }));
}

/** @param {GetJson} getJson @param {string} boardId @returns {Promise<import('./board-parity.js').BoardConfig>} */
export const readBoardConfig = (getJson, boardId) => getJson(`/rest/agile/1.0/board/${boardId}/configuration`);

/**
 * Data Center board issues (startAt paging). DC truncates results at jira.search.views.default.max, and what
 * `total` reports then is UNVERIFIED, so `total` is returned: the caller must treat issues.length < total as truncated.
 * @param {GetJson} getJson @param {string} boardId
 */
export async function readDcBoardIssues(getJson, boardId) {
  const issues = [];
  let total;
  for (let startAt = 0; ; ) {
    const page = await getJson(`/rest/agile/1.0/board/${boardId}/issue?fields=status&startAt=${startAt}&maxResults=100`);
    total = page.total ?? total;
    issues.push(...page.issues.map(toIssue));
    if (page.issues.length === 0 || (total !== undefined && issues.length >= total)) return { issues, total };
    startAt += page.issues.length;
  }
}

/**
 * Cloud board issues via the enhanced endpoint (token paging). `fields` is left out because its query format is
 * UNVERIFIED, so every field comes back; pages are kept small for that reason.
 * @param {GetJson} getJson @param {string} boardId
 */
export async function readCloudBoardIssues(getJson, boardId) {
  const issues = [];
  for (let token; ; ) {
    const tokenQuery = token ? `&nextPageToken=${encodeURIComponent(token)}` : '';
    const page = await getJson(`/rest/software/1.0/board/${boardId}/issue?maxResults=100${tokenQuery}`);
    issues.push(...page.issues.map(toIssue));
    token = page.nextPageToken;
    if (!token || page.issues.length === 0) return { issues };
  }
}
