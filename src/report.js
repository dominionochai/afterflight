/** What a run covers is stated, not implied: anything not listed as checked was not examined. */
export const CHECKED = [
  'Saved filters: references to projects, statuses, issue types, priorities, users, filters and custom fields',
  'Filter results: each filter\'s Data Center result compared with Cloud as migrated and as it would be after repair (issue by issue where ids were exported, otherwise by count; both sides see only what their user may browse)',
  'Proposed repairs: checked with Atlassian\'s own JQL parser before writing and again on the live filter afterwards',
  'Boards: filter reference, column-to-status mapping, estimation field, and the set of issues each board shows',
];
export const CHECKED_WITH_GAPS = [
  'Saved filters: versions and components are not exported from Data Center yet, so references to them are not judged',
  'Board quick filters and Kanban sub-queries: read on Cloud and run through Atlassian\'s parser (references that no longer resolve only; not compared with Data Center, and fixes are manual because no write route was found)',
  'Boards that sit on a filter are listed beside it, read from each board configuration on Cloud',
  'Advanced Roadmaps: Cloud plans that use a filter are listed beside it (Jira Premium only); plan contents are not compared with Data Center',
];
export const NOT_CHECKED = [
  'Advanced Roadmaps plan issue sources versus Data Center (no supported Data Center route found)', 'Board ranking field', 'Sprints',
  'Permissions and issue security', 'Automation rules', 'Workflows', 'Dashboards and gadgets', 'Custom field contexts',
];

const count = (items, test) => items.filter(test).length;

/**
 * @param {{ generatedAt: string, analysis: Awaited<ReturnType<typeof import('./service.js').runAnalysis>>,
 *   boards?: Awaited<ReturnType<typeof import('./service.js').runBoardParity>>, auditEntries?: import('./audit.js').AuditEntry[],
 *   queryCheck?: Awaited<ReturnType<typeof import('./service.js').runBoardQueryCheck>>,
 *   parity?: Awaited<ReturnType<typeof import('./service.js').runResultParity>> }} input
 */
export function buildIntegrityReport({ generatedAt, analysis, boards = [], auditEntries = [], queryCheck, parity = [] }) {
  const compared = boards.filter((b) => b.status === 'compared');
  const repairsDone = auditEntries.filter((e) => e.action === 'repair' && e.outcome === 'applied');
  const caveats = [];
  for (const b of boards) {
    if (b.status === 'board-not-mapped') caveats.push(`Board "${b.name}" has no entry in the ID Mapping Report, so it was not compared.`);
    if (b.sourceTruncated) caveats.push(`Board "${b.name}": the Data Center export was truncated, so issues reported missing may be false alarms.`);
    if (b.issues && !b.issues.complete) caveats.push(`Board "${b.name}": some source issues have no ID mapping, so its unexpected-issue list is not reliable.`);
  }
  if (analysis.checkNote) caveats.push(analysis.checkNote);
  if (analysis.plansNote) caveats.push(analysis.plansNote);
  if (analysis.boardsNote) caveats.push(analysis.boardsNote);
  if (queryCheck?.note) caveats.push(queryCheck.note);
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
      results: { compared: parity.length, matchAsMigrated: count(parity, (p) => p.asMigrated.status === 'match'), matchAfterRepair: count(parity, (p) => (p.afterRepair ?? p.asMigrated).status === 'match') },
      boardQueries: { checked: queryCheck?.checked ?? 0, withProblems: queryCheck?.findings.length ?? 0 },
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
    queryCheck,
    parity,
    audit: auditEntries,
  };
}

const bullets = (items) => (items.length ? items.map((i) => `- ${i}`).join('\n') : '- none');

/** @param {ReturnType<typeof buildIntegrityReport>} r */
export function renderMarkdown(r) {
  const { filters: f, boards: b, repairs: p } = r.summary;
  const filterLines = r.filters.map((x) => `- **${x.name}** (${x.filterId}): ${x.canRepair ? `repairable, proposed \`${x.proposed}\`` : 'no repair proposed'}${x.open.length ? `; needs attention: ${x.open.map((o) => `${o.type} "${o.was}" ${o.status}`).join(', ')}` : ''}${(x.why ?? []).map((w) => `\n  - ${w}`).join('')}`);
  const boardLines = r.boards.map((x) => (x.status === 'compared'
    ? `- **${x.name}** (${x.boardId} -> ${x.cloudBoardId}): ${x.configFindings.length} config finding(s), ${x.issues.missing.length} missing, ${x.issues.unexpected.length} unexpected, ${x.issues.unmapped.length} unmapped issue(s)`
    : `- **${x.name}** (${x.boardId}): ${x.status}`));
  const queryLines = (r.queryCheck?.findings ?? []).map((q) => `- **${q.boardName}** (${q.boardId}) ${q.kind} "${q.name}": \`${q.jql}\`\n  - ${q.problems.join('\n  - ')}\n  - Fix by hand: Cloud has no write route for this.`);
  const describe = (c) => (c.status === 'unknown' ? `unknown (${c.reason})` : `${c.status}, ${c.cloudTotal} in Cloud (${c.basis})`);
  const parityLines = r.parity.map((p) => `- **${p.name}**: ${p.sourceTotal} in Data Center; as migrated ${describe(p.asMigrated)}${p.afterRepair ? `; after repair ${describe(p.afterRepair)}` : ''}`);
  const auditLines = r.audit.map((e) => `- ${e.at} ${e.actor} ${e.action} ${e.outcome} filter ${e.filterId} "${e.name}" (run ${e.runId})${e.message ? `: ${e.message}` : ''}`);
  return [
    '# Afterflight migration integrity report',
    `Generated ${r.generatedAt}`,
    '## Summary',
    `- Filters: ${f.total} analysed, ${f.repairable} repairable, ${f.needAttention} need attention, ${f.notMigrated} not migrated`,
    `- Boards: ${b.total} listed, ${b.compared} compared, ${b.withConfigFindings} with config findings, ${b.withMissingIssues} with missing issues`,
    `- Filter results: ${r.summary.results.compared} compared, ${r.summary.results.matchAsMigrated} match as migrated, ${r.summary.results.matchAfterRepair} match after repair`,
    `- Board quick filters and sub-queries: ${r.summary.boardQueries.checked} checked, ${r.summary.boardQueries.withProblems} with problems`,
    `- Repairs: ${p.applied} applied, ${p.failed} failed, ${p.rolledBack} rolled back`,
    '## Coverage',
    'Checked:', bullets(r.coverage.checked),
    'Checked with gaps:', bullets(r.coverage.checkedWithGaps),
    'Not checked:', bullets(r.coverage.notChecked),
    '## Caveats', bullets(r.caveats),
    '## Filters', bullets(filterLines),
    '## Boards', bullets(boardLines),
    '## Filter results, Data Center versus Cloud', bullets(parityLines),
    '## Board quick filters and sub-queries', bullets(queryLines),
    '## Audit trail', bullets(auditLines),
  ].join('\n\n');
}
