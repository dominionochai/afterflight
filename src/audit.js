/**
 * @typedef {{ runId: string, at: string, actor: string, action: 'repair' | 'rollback', filterId: string, name: string,
 *   before: string, after: string, outcome: 'attempting' | 'applied' | 'skipped' | 'failed', message?: string, rollbackOf?: string }} AuditEntry
 * @typedef {{ put: (key: string, value: AuditEntry) => Promise<void>,
 *   list: (prefix: string) => Promise<{ key: string, value: AuditEntry }[]> }} AuditStore
 * `put` must refuse to overwrite an existing key, so entries are append-only.
 */
const PREFIX = 'audit:';

/** @param {AuditStore} store @param {{ now?: () => Date }} [options] */
export function makeAuditLog(store, { now = () => new Date() } = {}) {
  return {
    /** @param {Omit<AuditEntry, 'at'>} entry */
    async record(entry) {
      const full = { ...entry, at: now().toISOString() };
      await store.put(`${PREFIX}${full.at}:${entry.runId}:${entry.filterId}:${entry.outcome}`, full);
      return full;
    },
    /** @returns {Promise<AuditEntry[]>} oldest first */
    async list() {
      return (await store.list(PREFIX)).map((r) => r.value).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
    },
  };
}

/** Turns one run's applied repairs into reports that applyRepairs can undo: current must equal `after`. */
export function appliedRepairs(entries, runId) {
  return entries
    .filter((e) => e.runId === runId && e.action === 'repair' && e.outcome === 'applied')
    .map((e) => ({ filterId: e.filterId, name: e.name, original: e.after, proposed: e.before }));
}
