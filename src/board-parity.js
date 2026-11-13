/**
 * Board configuration as returned by Jira Software. Shape taken from the Forge board-configuration-changed
 * event payload; the REST response shape is UNVERIFIED against a live board.
 * @typedef {{ filter: { id: string }, columnConfig: { columns: { name: string, statuses: { id: string }[] }[] },
 *   estimation?: { field?: { fieldId: string } } }} BoardConfig
 * @typedef {{ area: string, status: 'mismatch' | 'missing' | 'unmapped', detail: string }} ConfigFinding
 * @typedef {(sourceId: string) => string | undefined} IdMapper
 */

/**
 * Compares a source board with its migrated Cloud board through authoritative ID mappings.
 * A source ID with no mapping is reported as unmapped, never guessed. Ranking is not compared yet.
 * @param {BoardConfig} source @param {BoardConfig} cloud
 * @param {{ filter: IdMapper, status: IdMapper, field: IdMapper }} map
 * @returns {ConfigFinding[]}
 */
export function compareBoardConfig(source, cloud, map) {
  const findings = [];
  const note = (area, status, detail) => findings.push({ area, status, detail });

  const wantFilter = map.filter(source.filter.id);
  if (wantFilter === undefined) note('filter', 'unmapped', `source filter ${source.filter.id} has no Cloud mapping`);
  else if (wantFilter !== cloud.filter.id) note('filter', 'mismatch', `board uses Cloud filter ${cloud.filter.id}, expected ${wantFilter}`);

  const cloudColumns = new Map(cloud.columnConfig.columns.map((c) => [c.name.toLowerCase(), new Set(c.statuses.map((s) => s.id))]));
  for (const column of source.columnConfig.columns) {
    const have = cloudColumns.get(column.name.toLowerCase());
    if (!have) {
      note(`column:${column.name}`, 'missing', 'column is absent on the Cloud board');
      continue;
    }
    for (const { id } of column.statuses) {
      const want = map.status(id);
      if (want === undefined) note(`column:${column.name}`, 'unmapped', `status ${id} has no Cloud mapping`);
      else if (!have.has(want)) note(`column:${column.name}`, 'missing', `Cloud status ${want} is not in this column`);
    }
  }

  const sourceField = source.estimation?.field?.fieldId;
  if (sourceField) {
    const want = map.field(sourceField);
    const got = cloud.estimation?.field?.fieldId;
    if (want === undefined) note('estimation', 'unmapped', `field ${sourceField} has no Cloud mapping`);
    else if (want !== got) note('estimation', 'mismatch', `board estimates with ${got ?? 'nothing'}, expected ${want}`);
  }
  return findings;
}

/**
 * Compares the issue sets a board shows on each side. Jira's board issue list holds only issues whose
 * status is mapped to a board column, so a missing issue is explained first by its status mapping.
 * `unexpected` is only trustworthy when `complete` is true (every source issue had a mapping).
 * @param {{ id: string, statusId?: string }[]} source @param {{ id: string }[]} cloud
 * @param {{ mapIssue: IdMapper, mapStatus: IdMapper, cloudBoardStatusIds: Set<string> }} ctx
 */
export function compareBoardIssues(source, cloud, { mapIssue, mapStatus, cloudBoardStatusIds }) {
  const cloudIds = new Set(cloud.map((i) => i.id));
  const expected = new Set();
  const missing = [];
  const unmapped = [];
  for (const issue of source) {
    const cloudId = mapIssue(issue.id);
    if (cloudId === undefined) {
      unmapped.push(issue.id);
      continue;
    }
    expected.add(cloudId);
    if (cloudIds.has(cloudId)) continue;
    const cloudStatus = issue.statusId === undefined ? undefined : mapStatus(issue.statusId);
    const reason = cloudStatus === undefined ? 'status-unmapped'
      : cloudBoardStatusIds.has(cloudStatus) ? 'unexplained' : 'status-not-in-any-board-column';
    missing.push({ sourceId: issue.id, cloudId, reason });
  }
  return {
    missing,
    unmapped,
    unexpected: cloud.filter((i) => !expected.has(i.id)).map((i) => i.id),
    matched: expected.size - missing.length,
    complete: unmapped.length === 0,
  };
}
