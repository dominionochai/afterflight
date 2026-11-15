import { analyse, applyRepairs, needsRepair, openFindings, staleFindings } from './engine.js';
import { filterIo, getJson as cloudGetJson, readCloudWorld, readPlans } from './cloud-reader.js';
import { parseSnapshot } from './snapshot.js';
import { parseIdMapping } from './idmap.js';
import { readBoardConfig, readBoardFilterUsage, readCloudBoardIssues } from './board-readers.js';
import { compareBoardConfig, compareBoardIssues } from './board-parity.js';
import { appliedRepairs } from './audit.js';
import { DEFAULT_ENTITY_TYPES } from './entity-types.js';
import { randomUUID } from 'node:crypto';

/** Report-first lookups. `types` overrides DEFAULT_ENTITY_TYPES for any entity type whose Entity Type string differs. */
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
  const { reports, notMigrated } = analyse(source, await readCloudWorld(requestJira), pairing(idMappingCsv, types));
  const { plans, plansNote } = await planContext(requestJira);
  const { usage, boardsNote } = await boardContext(requestJira);
  return {
    notMigrated,
    plansNote,
    boardsNote,
    filters: reports.map((r) => ({
      filterId: r.filterId,
      name: r.name,
      original: r.original,
      proposed: r.proposed,
      canRepair: needsRepair(r),
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
  const { reports } = analyse(source, await readCloudWorld(requestJira), options);
  const chosen = reports.filter((r) => needsRepair(r) && filterIds.includes(r.filterId));
  const ctx = { runId, actor, action: 'repair' };
  const result = await applyRepairs(chosen, auditedIo(filterIo(requestJira), audit, ctx, chosen));
  const auditErrors = await recordLeftovers(audit, ctx, chosen, result);
  const chosenIds = new Set(chosen.map((r) => r.filterId));
  const after = analyse(source, await readCloudWorld(requestJira), options).reports;
  return {
    runId,
    done: result.done,
    skipped: result.skipped,
    failed: result.failed,
    auditErrors,
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
  const cloud = await readCloudWorld(requestJira);
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
