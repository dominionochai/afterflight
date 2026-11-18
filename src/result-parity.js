/**
 * @typedef {{ total: number, ids?: string[] }} SourceResult  Data Center result of a filter (ids only when the set was small enough to export)
 * @typedef {{ ids: string[], capped: boolean }} CloudResult
 * @typedef {{ status: 'match' | 'differs' | 'unknown', basis: 'issue-ids' | 'counts', sourceTotal: number, cloudTotal: number,
 *   missing: string[], unexpected: string[], unmapped: string[], reason?: string }} ResultComparison
 */

/**
 * Compares what one filter returns in Data Center with what a Cloud query returns. With the exported issue ids and an
 * ID mapping the sets are compared issue by issue; otherwise only the counts can be compared. A capped Cloud result
 * is never called a match or a difference, because the rest of it was not read.
 * @param {SourceResult} source @param {CloudResult} cloud @param {(sourceId: string) => string | undefined} [mapIssue]
 * @returns {ResultComparison}
 */
export function compareResults(source, cloud, mapIssue) {
  const base = { sourceTotal: source.total, cloudTotal: cloud.ids.length, missing: [], unexpected: [], unmapped: [] };
  if (cloud.capped) {
    return { ...base, status: 'unknown', basis: 'counts', reason: `Cloud returned more issues than the ${cloud.ids.length} that were read, so the rest was not compared.` };
  }
  if (!source.ids || !mapIssue) {
    return { ...base, status: source.total === cloud.ids.length ? 'match' : 'differs', basis: 'counts' };
  }
  const cloudIds = new Set(cloud.ids);
  const expected = new Set();
  const missing = [];
  const unmapped = [];
  for (const id of source.ids) {
    const mapped = mapIssue(id);
    if (mapped === undefined) unmapped.push(id);
    else {
      expected.add(mapped);
      if (!cloudIds.has(mapped)) missing.push(mapped);
    }
  }
  const unexpected = cloud.ids.filter((id) => !expected.has(id));
  return {
    ...base,
    status: missing.length === 0 && unexpected.length === 0 && unmapped.length === 0 ? 'match' : 'differs',
    basis: 'issue-ids',
    missing,
    unexpected,
    unmapped,
    ...(unmapped.length ? { reason: 'Some source issues have no ID mapping, so unexpected issues may be their migrated counterparts.' } : {}),
  };
}
