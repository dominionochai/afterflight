const CHUNK = 50;

/**
 * Atlassian's own JQL parse and validation (POST /rest/api/3/jql/parse, validation=strict), run as the signed-in user.
 * A value that does not exist comes back as a warning, not an error, so callers must read both. The chunk size is a
 * conservative choice: no limit on queries per call is documented. Results are matched to queries by position.
 * @param {import('./cloud-reader.js').RequestJira} requestJira @param {string[]} queries
 * @returns {Promise<Map<string, { errors: string[], warnings: string[] }>>}
 */
export async function parseJql(requestJira, queries) {
  const out = new Map();
  for (let i = 0; i < queries.length; i += CHUNK) {
    const chunk = queries.slice(i, i + CHUNK);
    const res = await requestJira('/rest/api/3/jql/parse?validation=strict', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ queries: chunk }),
    });
    if (!res.ok) throw new Error(`POST /rest/api/3/jql/parse failed with HTTP ${res.status}: ${await res.text()}`);
    const { queries: parsed } = await res.json();
    if (parsed.length !== chunk.length) throw new Error(`Atlassian's JQL parser returned ${parsed.length} results for ${chunk.length} queries.`);
    chunk.forEach((query, j) => out.set(query, { errors: parsed[j].errors ?? [], warnings: parsed[j].warnings ?? [] }));
  }
  return out;
}

/**
 * What a rewrite changed in Atlassian's eyes. Only messages that are new count against a repair, so a
 * problem the original query already had (and we cannot fix) does not block the part we can.
 */
export function compareChecks(before, after) {
  const prior = new Set([...before.errors, ...before.warnings]);
  const now = new Set([...after.errors, ...after.warnings]);
  return { introduced: [...now].filter((m) => !prior.has(m)), resolved: [...prior].filter((m) => !now.has(m)) };
}
