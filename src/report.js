/** What a run covers is stated, not implied: anything not listed as checked was not examined. */
export const CHECKED = [
  'Saved filters: references to projects, statuses, issue types, priorities, users, filters and custom fields',
  'Boards: filter reference, column-to-status mapping, estimation field, and the set of issues each board shows',
];
export const CHECKED_WITH_GAPS = [
  'Saved filters: versions and components are not exported from Data Center yet, so references to them are not judged',
];
export const NOT_CHECKED = [
  'Board quick filters', 'Advanced Roadmaps plans', 'Board ranking field', 'Sprints',
  'Permissions and issue security', 'Automation rules', 'Workflows', 'Dashboards and gadgets', 'Custom field contexts',
];

const count = (items, test) => items.filter(test).length;

/**
 * @param {{ generatedAt: string, analysis: Awaited<ReturnType<typeof import('./service.js').runAnalysis>>,
 *   boards?: Awaited<ReturnType<typeof import('./service.js').runBoardParity>>, auditEntries?: import('./audit.js').AuditEntry[] }} input
 */
export function buildIntegrityReport({ generatedAt, analysis, boards = [], auditEntries = [] }) {
  const compared = boards.filter((b) => b.status === 'compared');
  const repairsDone = auditEntries.filter((e) => e.action === 'repair' && e.outcome === 'applied');
  const caveats = [];
  for (const b of boards) {
    if (b.status === 'board-not-mapped') caveats.push(`Board "${b.name}" has no entry in the ID Mapping Report, so it was not compared.`);
    if (b.sourceTruncated) caveats.push(`Board "${b.name}": the Data Center export was truncated, so issues reported missing may be false alarms.`);
    if (b.issues && !b.issues.complete) caveats.push(`Board "${b.name}": some source issues have no ID mapping, so its unexpected-issue list is not reliable.`);
  }
  if (analysis.notMigrated.length) caveats.push(`${analysis.notMigrated.length} filter(s) were not found in Cloud: ${analysis.notMigrated.map((f) => f.name).join(', ')}.`);

  return {
    generatedAt,
    summary: {
      filters: {
        total: analysis.filters.length,
        repairable: count(analysis.filters, (f) => f.canRepair),
        needAttention: count(analysis.filters, (f) => f.open.length > 0),
        notMigrated: analysis.notMigrated.length,
      },
      boards: {
        total: boards.length,
        compared: compared.length,
        withConfigFindings: count(compared, (b) => b.configFindings.length > 0),
        withMissingIssues: count(compared, (b) => b.issues.missing.length > 0),
      },
      repairs: {
        applied: repairsDone.length,
        failed: count(auditEntries, (e) => e.action === 'repair' && e.outcome === 'failed'),
        rolledBack: count(auditEntries, (e) => e.action === 'rollback' && e.outcome === 'applied'),
      },
    },
    coverage: { checked: CHECKED, checkedWithGaps: CHECKED_WITH_GAPS, notChecked: NOT_CHECKED },
    caveats,
    filters: analysis.filters,
    notMigrated: analysis.notMigrated,
    boards,
    audit: auditEntries,
  };
}

const bullets = (items) => (items.length ? items.map((i) => `- ${i}`).join('\n') : '- none');

/** @param {ReturnType<typeof buildIntegrityReport>} r */
export function renderMarkdown(r) {
  const { filters: f, boards: b, repairs: p } = r.summary;
  const filterLines = r.filters.map((x) => `- **${x.name}** (${x.filterId}): ${x.canRepair ? `repairable, proposed \`${x.proposed}\`` : 'no repair proposed'}${x.open.length ? `; needs attention: ${x.open.map((o) => `${o.type} "${o.was}" ${o.status}`).join(', ')}` : ''}`);
  const boardLines = r.boards.map((x) => (x.status === 'compared'
    ? `- **${x.name}** (${x.boardId} -> ${x.cloudBoardId}): ${x.configFindings.length} config finding(s), ${x.issues.missing.length} missing, ${x.issues.unexpected.length} unexpected, ${x.issues.unmapped.length} unmapped issue(s)`
    : `- **${x.name}** (${x.boardId}): ${x.status}`));
  const auditLines = r.audit.map((e) => `- ${e.at} ${e.actor} ${e.action} ${e.outcome} filter ${e.filterId} "${e.name}" (run ${e.runId})${e.message ? `: ${e.message}` : ''}`);
  return [
    '# Afterflight migration integrity report',
    `Generated ${r.generatedAt}`,
    '## Summary',
    `- Filters: ${f.total} analysed, ${f.repairable} repairable, ${f.needAttention} need attention, ${f.notMigrated} not migrated`,
    `- Boards: ${b.total} listed, ${b.compared} compared, ${b.withConfigFindings} with config findings, ${b.withMissingIssues} with missing issues`,
    `- Repairs: ${p.applied} applied, ${p.failed} failed, ${p.rolledBack} rolled back`,
    '## Coverage',
    'Checked:', bullets(r.coverage.checked),
    'Checked with gaps:', bullets(r.coverage.checkedWithGaps),
    'Not checked:', bullets(r.coverage.notChecked),
    '## Caveats', bullets(r.caveats),
    '## Filters', bullets(filterLines),
    '## Boards', bullets(boardLines),
    '## Audit trail', bullets(auditLines),
  ].join('\n\n');
}
