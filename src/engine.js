import { extractReferences, rewrite } from './jql.js';

/** @typedef {import('./jql.js').EntityType} EntityType */
/** @typedef {{ id: string, name: string, key?: string, email?: string }} Entity */
/** @typedef {{ id: string, name: string, ownerEmail: string, jql: string }} SavedFilter */
/** @typedef {{ id: string, name: string, config: import('./board-parity.js').BoardConfig, issues: { id: string, statusId?: string }[] }} SourceBoard */
/** @typedef {{ entities: Partial<Record<EntityType, Entity[]>>, filters: SavedFilter[], boards?: SourceBoard[] }} World */
/** @typedef {'ok'|'stale'|'wrong-entity'|'missing'|'ambiguous'|'unknown-in-source'|'structure-changed'} Status */
/** @typedef {{ type?: EntityType, was: string, now: string, status: Status, meant?: string, resolvesNowTo?: string, targetName?: string, mappedCloudId?: string, fix?: { start: number, end: number, text: string } }} Finding */
/** @typedef {{ filterId: string, name: string, sourceJql: string, original: string, proposed: string, findings: Finding[] }} FilterReport */

const OPEN_STATUSES = new Set(['missing', 'ambiguous', 'structure-changed']);
const STALE_STATUSES = new Set(['stale', 'wrong-entity']);

const entitiesOf = (world, type) => (type === 'filter' ? world.filters : world.entities[type] ?? []);
const identity = (entity) => (entity.email ?? entity.name).toLowerCase();
const customFieldId = (literal) => literal.replace(/^cf\[(\d+)\]$/, 'customfield_$1');

/**
 * What a JQL literal means in one world: by id, then key, then name.
 * @param {World} world @param {EntityType} type @param {string} literal @returns {Entity | undefined}
 */
function resolve(world, type, literal) {
  const wanted = (type === 'field' ? customFieldId(literal) : literal).toLowerCase();
  const all = entitiesOf(world, type);
  return all.find((e) => e.id.toLowerCase() === wanted)
    ?? all.find((e) => e.key?.toLowerCase() === wanted)
    ?? all.find((e) => e.name.toLowerCase() === wanted);
}

function cloudEntity(cloud, type, id) {
  return entitiesOf(cloud, type).find((e) => e.id === id || (type === 'field' && e.id === `customfield_${id}`));
}
const serverKeys = (type, id) => (type === 'field' ? [id, id.replace(/^customfield_/, '')] : [id]);

function render(type, entity) {
  if (type === 'field') return `cf[${entity.id.replace('customfield_', '')}]`;
  return /^\w+$/.test(entity.id) ? entity.id : `"${entity.id}"`;
}

/**
 * Compare one reference as written at the source with the same slot in the migrated query.
 * The ID Mapping Report (`mapId`) decides first. Without a report row, a unique same-identity entity in Cloud is
 * used. A report row pointing at an entity that no longer exists is flagged, never replaced by a name guess.
 */
function judge(was, now, source, cloud, mapId) {
  const base = { type: was.type, was: was.literal, now: now.literal };
  const meant = resolve(source, was.type, was.literal);
  if (!meant) return { ...base, status: 'unknown-in-source' };
  const current = resolve(cloud, now.type, now.literal);
  const reported = serverKeys(was.type, meant.id).map((key) => mapId?.(was.type, key)).find((value) => value !== undefined);
  if (reported !== undefined && !cloudEntity(cloud, was.type, reported)) {
    return { ...base, status: 'missing', meant: meant.name, resolvesNowTo: current?.name, mappedCloudId: reported };
  }
  const targets = reported !== undefined
    ? [cloudEntity(cloud, was.type, reported)]
    : entitiesOf(cloud, was.type).filter((e) => identity(e) === identity(meant));
  if (targets.length !== 1) {
    return { ...base, status: targets.length ? 'ambiguous' : 'missing', meant: meant.name, resolvesNowTo: current?.name };
  }
  const [target] = targets;
  if (current?.id === target.id) return { ...base, status: 'ok' };
  return {
    ...base,
    status: current ? 'wrong-entity' : 'stale',
    meant: meant.name,
    resolvesNowTo: current?.name,
    targetName: target.name,
    fix: { start: now.start, end: now.end, text: render(was.type, target) },
  };
}

/** @returns {{ findings: Finding[], proposed: string }} */
export function diagnoseQuery(sourceJql, cloudJql, source, cloud, mapId) {
  const was = extractReferences(sourceJql);
  const now = extractReferences(cloudJql);
  if (was.length !== now.length || was.some((w, i) => w.type !== now[i].type)) {
    return { findings: [{ status: 'structure-changed', was: sourceJql, now: cloudJql }], proposed: cloudJql };
  }
  const findings = was.map((w, i) => judge(w, now[i], source, cloud, mapId));
  return { findings, proposed: rewrite(cloudJql, findings.flatMap((f) => f.fix ?? [])) };
}

/**
 * Filters are paired by `pairById` (the ID Mapping Report) first, then by owner email plus name.
 * `mapId(type, serverId)` gives the report's Cloud ID for any entity type.
 * @param {World} source @param {World} cloud
 * @param {{ pairById?: (sourceId: string) => string | undefined, mapId?: (type: string, serverId: string) => string | undefined }} [options]
 * @returns {{ reports: FilterReport[], notMigrated: { id: string, name: string }[] }}
 */
export function analyse(source, cloud, { pairById, mapId } = {}) {
  const slot = (f) => `${f.ownerEmail}|${f.name}`.toLowerCase();
  const migrated = new Map(cloud.filters.map((f) => [slot(f), f]));
  const byCloudId = new Map(cloud.filters.map((f) => [f.id, f]));
  const reports = [];
  const notMigrated = [];
  for (const src of source.filters) {
    const dst = byCloudId.get(pairById?.(src.id)) ?? migrated.get(slot(src));
    if (!dst) {
      notMigrated.push({ id: src.id, name: src.name });
      continue;
    }
    const { findings, proposed } = diagnoseQuery(src.jql, dst.jql, source, cloud, mapId);
    reports.push({ filterId: dst.id, name: dst.name, sourceJql: src.jql, original: dst.jql, proposed, findings });
  }
  return { reports, notMigrated };
}

export const needsRepair = (report) => report.proposed !== report.original;
export const openFindings = (report) => report.findings.filter((f) => OPEN_STATUSES.has(f.status));
export const staleFindings = (report) => report.findings.filter((f) => STALE_STATUSES.has(f.status));

/** Re-diagnose the proposed JQL against the same worlds. */
export function verify(report, source, cloud, mapId) {
  const rediagnosed = { findings: diagnoseQuery(report.sourceJql, report.proposed, source, cloud, mapId).findings };
  return { hasStaleReferences: staleFindings(rediagnosed).length > 0, remaining: openFindings(rediagnosed) };
}

/**
 * Cloud itself is the journal: a filter already holding `proposed` is skipped, so an interrupted
 * run resumes by calling this again. One filter failing (not the owner, edited since analysis,
 * network) is recorded and the rest continue.
 * @param {FilterReport[]} reports
 * @param {{ readJql: (id: string) => Promise<string>, writeJql: (id: string, jql: string) => Promise<void> }} io
 */
export async function applyRepairs(reports, { readJql, writeJql }) {
  const done = [];
  const skipped = [];
  const failed = [];
  for (const r of reports) {
    try {
      const current = await readJql(r.filterId);
      if (current === r.proposed) {
        skipped.push(r.filterId);
        continue;
      }
      if (current !== r.original) {
        throw new Error(`changed since analysis: expected "${r.original}", found "${current}". Re-run analysis and apply again.`);
      }
      await writeJql(r.filterId, r.proposed);
      done.push(r.filterId);
    } catch (error) {
      failed.push({ filterId: r.filterId, name: r.name, message: error.message });
    }
  }
  return { done, skipped, failed };
}
