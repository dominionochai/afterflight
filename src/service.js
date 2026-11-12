import { analyse, applyRepairs, needsRepair, openFindings, staleFindings } from './engine.js';
import { filterIo, readCloudWorld } from './cloud-reader.js';
import { parseSnapshot } from './snapshot.js';

/** @param {{ snapshotText: string, requestJira: import('./cloud-reader.js').RequestJira }} input */
export async function runAnalysis({ snapshotText, requestJira }) {
  const source = parseSnapshot(snapshotText);
  const { reports, notMigrated } = analyse(source, await readCloudWorld(requestJira));
  return {
    notMigrated,
    filters: reports.map((r) => ({
      filterId: r.filterId,
      name: r.name,
      original: r.original,
      proposed: r.proposed,
      canRepair: needsRepair(r),
      open: openFindings(r).map(({ type, was, status, meant, resolvesNowTo }) => ({ type, was, status, meant, resolvesNowTo })),
    })),
  };
}

/**
 * Re-analyses server-side and applies only what this run proposes; JQL from the client is never trusted.
 * @param {{ snapshotText: string, filterIds: string[], requestJira: import('./cloud-reader.js').RequestJira }} input
 */
export async function runApply({ snapshotText, filterIds, requestJira }) {
  const source = parseSnapshot(snapshotText);
  const { reports } = analyse(source, await readCloudWorld(requestJira));
  const chosen = reports.filter((r) => needsRepair(r) && filterIds.includes(r.filterId));
  const { done, skipped } = await applyRepairs(chosen, filterIo(requestJira));
  const chosenIds = new Set(chosen.map((r) => r.filterId));
  const after = analyse(source, await readCloudWorld(requestJira)).reports;
  return {
    done,
    skipped,
    ignored: filterIds.filter((id) => !chosenIds.has(id)),
    stillStale: after.filter((r) => chosenIds.has(r.filterId) && staleFindings(r).length > 0).map((r) => r.name),
  };
}
