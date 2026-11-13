// SYNTHETIC: an in-memory stand-in for Forge KVS, used only by tests. Like the real one with FAIL_IF_EXISTS, put never overwrites.
export function memoryStore({ failPut = false } = {}) {
  const data = new Map();
  return {
    data,
    async put(key, value) {
      if (failPut) throw new Error('store down');
      if (data.has(key)) throw new Error(`key exists: ${key}`);
      data.set(key, structuredClone(value));
    },
    async list(prefix) {
      return [...data].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => ({ key, value }));
    },
  };
}

export const tickingClock = (start = Date.UTC(2026, 10, 13, 12, 0, 0)) => {
  let t = start;
  return () => new Date((t += 1000));
};
