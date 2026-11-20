import { analyse, applyRepairs, needsRepair, openFindings, staleFindings } from './engine.js';
import { ALL_ENTITY_TYPES, filterIo, getJson as cloudGetJson, readCloudWorld, readPlans, searchIssueIds } from './cloud-reader.js';
import { compareResults } from './result-parity.js';
import { parseSnapshot } from './snapshot.js';
import { parseIdMapping } from './idmap.js';
import { readBoardConfig, readBoardFilterUsage, readBoardQueries, readCloudBoardIssues } from './board-readers.js';
import { compareBoardConfig, compareBoardIssues } from './board-parity.js';
import { appliedRepairs } from './audit.js';
import { mapLimit } from './concurrency.js';
import { extractReferences } from './jql.js';
import { compareChecks, parseJql } from './jql-check.js';
import { explain, explainUnanalysed } from './explain.js';
import { DEFAULT_ENTITY_TYPES } from './entity-types.js';
import { randomUUID } from 'node:crypto';

/** Report-first lookups. `types` overrides DEFAULT_ENTITY_TYPES for any entity type whose Entity Type string differs. */
/** Reads from Cloud only the entity types this snapshot's queries and boards can refer to. */
function loadCloud(requestJira, source) {
  const referenced = new Set(source.filters.flatMap((f) => extractReferences(f.jql).map((r) => r.type)));
  if (source.boards?.length) ['status', 'field'].forEach((t) => referenced.add(t));
  return readCloudWorld(requestJira, ALL_ENTITY_TYPES.filter((t) => referenced.has(t)));
}

/** Atlassian's parser on each report's original and proposed JQL. @returns {Promise<Map<string, ReturnType<typeof compareChecks>>>} */
async function checkReports(requestJira, reports) {
  if (reports.length === 0) return new Map();
  const parsed = await parseJql(requestJira, [...new Set(reports.flatMap((r) => [r.original, r.proposed]))]);
  return new Map(reports.map((r) => [r.filterId, compareChecks(parsed.get(r.original), parsed.get(r.proposed))]));
}

/** Names of applied filters whose live JQL is not what we wrote, or that Atlassian's parser now objects to. */
async function verifyLive(requestJira, io, applied) {
  if (applied.length === 0) return [];
  const live = await mapLimit(applied, 5, (r) => io.readJql(r.filterId));
  const parsed = await parseJql(requestJira, [...new Set([...applied.map((r) => r.original), ...live])]);
  return applied
    .filter((r, i) => live[i] !== r.proposed || compareChecks(parsed.get(r.original), parsed.get(live[i])).introduced.length > 0)
    .map((r) => r.name);
}

function pairing(idMappingCsv, types) {
  if (!idMappingCsv) return {};
  const ids = parseIdMapping(idMappingCsv);
  const names = { ...DEFAULT_ENTITY_TYPES, ...types };
  return {
    pairById: (sourceId) => ids.get(names.filter, sourceId),
    mapId: (type, serverId) => (names[type] ? ids.get(names[type], serverId) : undefined),
  };
}

async function planContext(requestJira) {
  try {
    return { plans: await readPlans(requestJira) };
  } catch (error) {
    return { plansNote: `Plans were not checked (${error.message}). Reading plans needs a Jira Premium site and the Administer Jira permission.` };
  }
}

async function boardContext(requestJira) {
  try {
    const { usage, skipped } = await readBoardFilterUsage((path) => cloudGetJson(requestJira, path));
    return skipped.length
      ? { usage, boardsNote: `Could not read the configuration of ${skipped.length} board(s) (${skipped.map((s) => s.id).join(', ')}), so boards using a filter may be missing from this list.` }
      : { usage };
  } catch (error) {
    return { boardsNote: `Boards were not checked (${error.message}).` };
  }
}

/** @param {{ snapshotText: string, requestJira: import('./cloud-reader.js').RequestJira, idMappingCsv?: string, types?: Partial<Record<string, string>> }} input */
export async function runAnalysis({ snapshotText, requestJira, idMappingCsv, types }) {
  const source = parseSnapshot(snapshotText);
  const { reports, notMigrated, ambiguousPairs } = analyse(source, await loadCloud(requestJira, source), pairing(idMappingCsv, types));
  const { plans, plansNote } = await planContext(requestJira);
  const { usage, boardsNote } = await boardContext(requestJira);
  let checks;
  let checkNote;
  try {
    checks = await checkReports(requestJira, reports.filter(needsRepair));
  } catch (error) {
    checkNote = `Atlassian's JQL check did not run (${error.message}), so proposed repairs are not independently checked yet.`;
  }
  return {
    notMigrated,
    ambiguousPairs,
    plansNote,
    boardsNote,
    checkNote,
    filters: reports.map((r) => ({
      filterId: r.filterId,
      name: r.name,
      original: r.original,
      proposed: r.proposed,
      canRepair: needsRepair(r),
      check: checks?.get(r.filterId),
      why: [...r.findings.map(explain).filter(Boolean), ...r.notAnalysed.map(explainUnanalysed)],
      notAnalysed: r.notAnalysed,
      boards: (usage?.get(r.filterId) ?? []).map(({ id, name }) => ({ id, name })),
      plans: (plans ?? [])
        .filter((p) => p.issueSources.some((s) => s.type === 'Filter' && s.value === r.filterId))
        .map(({ id, name, status }) => ({ id, name, status })),
      open: openFindings(r).map(({ type, was, status, meant, resolvesNowTo }) => ({ type, was, status, meant, resolvesNowTo })),
    })),
  };
}

const requireAudit = (audit) => {
  if (!audit) throw new Error('An audit log is required: Afterflight does not change filters without recording who changed what.');
};

/** Wraps filter writes so each one is recorded before it happens (fail closed) and after it succeeds. */
function auditedIo(io, audit, ctx, reports) {
  const byId = new Map(reports.map((r) => [r.filterId, r]));
  return {
    readJql: io.readJql,
    writeJql: async (id, jql) => {
      const r = byId.get(id);
      const base = { ...ctx, filterId: id, name: r.name, before: r.original, after: jql };
      await audit.record({ ...base, outcome: 'attempting' });
      await io.writeJql(id, jql);
      try {
        await audit.record({ ...base, outcome: 'applied' });
      } catch (error) {
        throw new Error(`Filter ${id} was updated, but recording it in the audit log failed (${error.message}). Check the filter and the audit log before running again.`);
      }
    },
  };
}

async function recordLeftovers(audit, ctx, reports, { skipped, failed }) {
  const byId = new Map(reports.map((r) => [r.filterId, r]));
  const errors = [];
  const entries = [
    ...skipped.map((id) => ({ id, outcome: 'skipped' })),
    ...failed.map((f) => ({ id: f.filterId, outcome: 'failed', message: f.message })),
  ];
  for (const { id, outcome, message } of entries) {
    const r = byId.get(id);
    try {
      await audit.record({ ...ctx, filterId: id, name: r.name, before: r.original, after: r.proposed, outcome, ...(message ? { message } : {}) });
    } catch (error) {
      errors.push(`could not record ${outcome} for filter ${id}: ${error.message}`);
    }
  }
  return errors;
}

/**
 * Re-analyses server-side and applies only what this run proposes; JQL from the client is never trusted.
 * @param {{ snapshotText: string, filterIds: string[], requestJira: import('./cloud-reader.js').RequestJira,
 *   audit: ReturnType<typeof import('./audit.js').makeAuditLog>, actor?: string, runId?: string,
 *   idMappingCsv?: string, types?: Partial<Record<string, string>> }} input
 */
export async function runApply({ snapshotText, filterIds, requestJira, audit, actor = 'unknown', runId = randomUUID(), idMappingCsv, types }) {
  requireAudit(audit);
  const source = parseSnapshot(snapshotText);
  const options = pairing(idMappingCsv, types);
  const { reports } = analyse(source, await loadCloud(requestJira, source), options);
  const chosen = reports.filter((r) => needsRepair(r) && filterIds.includes(r.filterId));
  const ctx = { runId, actor, action: 'repair' };

  let checks;
  let checkError;
  try {
    checks = await checkReports(requestJira, chosen);
  } catch (error) {
    checkError = error.message;
  }
  const allowed = [];
  const blocked = [];
  for (const r of chosen) {
    const check = checks?.get(r.filterId);
    const message = !check ? `Atlassian's JQL check could not run (${checkError}), so nothing was written.`
      : check.introduced.length ? `Atlassian's JQL check found new problems in the proposed query, so nothing was written: ${check.introduced.join(' | ')}`
        : undefined;
    if (message) blocked.push({ filterId: r.filterId, name: r.name, message });
    else allowed.push(r);
  }

  const io = filterIo(requestJira);
  const result = await applyRepairs(allowed, auditedIo(io, audit, ctx, allowed));
  const failed = [...result.failed, ...blocked];
  const auditErrors = await recordLeftovers(audit, ctx, chosen, { skipped: result.skipped, failed });

  let unverified = [];
  let verifyNote;
  try {
    unverified = await verifyLive(requestJira, io, allowed.filter((r) => result.done.includes(r.filterId)));
  } catch (error) {
    verifyNote = `Live verification did not run (${error.message}).`;
  }
  const chosenIds = new Set(chosen.map((r) => r.filterId));
  const after = analyse(source, await loadCloud(requestJira, source), options).reports;
  return {
    runId,
    done: result.done,
    skipped: result.skipped,
    failed,
    auditErrors,
    unverified,
    verifyNote,
    ignored: filterIds.filter((id) => !chosenIds.has(id)),
    stillStale: after.filter((r) => chosenIds.has(r.filterId) && staleFindings(r).length > 0).map((r) => r.name),
  };
}

/**
 * Restores the JQL a repair run replaced, filter by filter. A filter edited since the repair is left alone and reported.
 * @param {{ requestJira: import('./cloud-reader.js').RequestJira, audit: ReturnType<typeof import('./audit.js').makeAuditLog>,
 *   runId: string, actor?: string, rollbackRunId?: string }} input
 */
export async function runRollback({ requestJira, audit, runId, actor = 'unknown', rollbackRunId = randomUUID() }) {
  requireAudit(audit);
  const reports = appliedRepairs(await audit.list(), runId);
  if (reports.length === 0) throw new Error(`No applied repairs were found for run ${runId}. Check the run ID in the audit log.`);
  const ctx = { runId: rollbackRunId, actor, action: 'rollback', rollbackOf: runId };
  const result = await applyRepairs(reports, auditedIo(filterIo(requestJira), audit, ctx, reports));
  const auditErrors = await recordLeftovers(audit, ctx, reports, result);
  return { runId: rollbackRunId, rollbackOf: runId, ...result, auditErrors };
}

const customFieldId = (value) => (value !== undefined && /^\d+$/.test(value) ? `customfield_${value}` : value);

function nameMapper(source, cloud, type) {
  return (sourceId) => {
    const named = (source.entities[type] ?? []).find((e) => e.id === sourceId);
    if (!named) return undefined;
    const matches = (cloud.entities[type] ?? []).filter((e) => e.name.toLowerCase() === named.name.toLowerCase());
    return matches.length === 1 ? matches[0].id : undefined;
  };
}

/**
 * Compares each exported DC board with its Cloud counterpart. Boards, filters, fields, statuses and issues are
 * mapped through the JCMA ID Mapping Report; a status without a report row falls back to a unique name match.
 * `types` optionally overrides DEFAULT_ENTITY_TYPES when a report names an entity type differently.
 * @param {{ snapshotText: string, idMappingCsv: string, types?: Partial<Record<string, string>>,
 *   requestJira: import('./cloud-reader.js').RequestJira }} input
 */
export async function runBoardParity({ snapshotText, idMappingCsv, types, requestJira }) {
  if (!idMappingCsv) {
    throw new Error('Board comparison needs the JCMA ID Mapping Report (CSV). Download it from the Logs and Reports tab of your migration in JCMA.');
  }
  const names = { ...DEFAULT_ENTITY_TYPES, ...types };
  const source = parseSnapshot(snapshotText);
  const ids = parseIdMapping(idMappingCsv);
  const cloud = await loadCloud(requestJira, source);
  const getJson = (path) => cloudGetJson(requestJira, path);
  const statusByName = nameMapper(source, cloud, 'status');
  const fieldByName = nameMapper(source, cloud, 'field');
  const statusMap = (id) => ids.get(names.status, id) ?? statusByName(id);
  const map = {
    filter: (id) => ids.get(names.filter, id),
    status: statusMap,
    field: (id) => customFieldId(ids.get(names.field, id) ?? ids.get(names.field, id.replace(/^customfield_/, ''))) ?? fieldByName(id),
  };
  const results = [];
  for (const board of source.boards) {
    const cloudBoardId = ids.get(names.board, board.id);
    if (cloudBoardId === undefined) {
      results.push({ boardId: board.id, name: board.name, status: 'board-not-mapped' });
      continue;
    }
    const [config, { issues }] = await Promise.all([readBoardConfig(getJson, cloudBoardId), readCloudBoardIssues(getJson, cloudBoardId)]);
    results.push({
      boardId: board.id,
      name: board.name,
      cloudBoardId,
      status: 'compared',
      sourceTruncated: board.issueTotal !== undefined && board.issues.length < board.issueTotal,
      configFindings: compareBoardConfig(board.config, config, map),
      issues: compareBoardIssues(board.issues, issues, {
        mapIssue: (id) => ids.get(names.issue, id),
        mapStatus: statusMap,
        cloudBoardStatusIds: new Set(config.columnConfig.columns.flatMap((c) => c.statuses.map((s) => s.id))),
      }),
    });
  }
  return results;
}

/**
 * Read-only: runs every Cloud quick filter and Kanban sub-query through Atlassian's JQL parser and lists the ones with
 * problems. With no Data Center source for these, it can only see references that no longer resolve, not ones that
 * now mean something else. Cloud has no documented write route for quick filters, so every fix is manual.
 * @param {{ requestJira: import('./cloud-reader.js').RequestJira }} input
 */
export async function runBoardQueryCheck({ requestJira }) {
  const { boards, skipped } = await readBoardQueries((path) => cloudGetJson(requestJira, path));
  const items = boards.flatMap((b) => [
    ...(b.subQuery ? [{ kind: 'sub-query', boardId: b.id, boardName: b.name, name: 'Kanban sub-query', jql: b.subQuery }] : []),
    ...b.quickFilters.filter((q) => q.jql).map((q) => ({ kind: 'quick-filter', boardId: b.id, boardName: b.name, name: q.name, jql: q.jql })),
  ]);
  const parsed = items.length ? await parseJql(requestJira, [...new Set(items.map((i) => i.jql))]) : new Map();
  const findings = items
    .map((i) => ({ ...i, problems: [...parsed.get(i.jql).errors, ...parsed.get(i.jql).warnings] }))
    .filter((i) => i.problems.length > 0);
  return {
    checked: items.length,
    findings,
    note: skipped.length ? `Could not read ${skipped.length} board(s) (${skipped.map((s) => s.id).join(', ')}), so their quick filters were not checked.` : undefined,
  };
}

/**
 * For every paired filter that has an exported Data Center result: what Cloud returns for the filter as migrated, and what it
 * would return after the proposed repair. The repaired query is searched as text, so nothing is written to preview it.
 * Both sides only see what their signed-in user may browse, so run the export and the app as administrators.
 * @param {{ snapshotText: string, requestJira: import('./cloud-reader.js').RequestJira, idMappingCsv?: string, types?: Partial<Record<string, string>> }} input
 */
export async function runResultParity({ snapshotText, requestJira, idMappingCsv, types }) {
  const source = parseSnapshot(snapshotText);
  const options = pairing(idMappingCsv, types);
  const names = { ...DEFAULT_ENTITY_TYPES, ...types };
  const ids = idMappingCsv ? parseIdMapping(idMappingCsv) : undefined;
  const mapIssue = ids ? (id) => ids.get(names.issue, id) : undefined;
  const { reports } = analyse(source, await loadCloud(requestJira, source), options);
  const resultsOf = new Map(source.filters.map((f) => [f.jql, f.results]));
  const out = [];
  for (const r of reports) {
    const sourceResult = resultsOf.get(r.sourceJql);
    if (!sourceResult) continue;
    const check = async (jql) => {
      try {
        return compareResults(sourceResult, await searchIssueIds(requestJira, jql), mapIssue);
      } catch (error) {
        return { status: 'unknown', basis: 'counts', sourceTotal: sourceResult.total, reason: error.message };
      }
    };
    out.push({
      filterId: r.filterId,
      name: r.name,
      sourceTotal: sourceResult.total,
      asMigrated: await check(r.original),
      ...(needsRepair(r) ? { afterRepair: await check(r.proposed) } : {}),
    });
  }
  return out;
}
