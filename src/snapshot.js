const ENTITY_TYPES = ['project', 'status', 'issuetype', 'priority', 'user', 'version', 'component', 'field'];

function stringRecords(value, path, required) {
  if (!Array.isArray(value)) {
    throw new Error(`Snapshot "${path}" must be an array, got ${value === null ? 'null' : typeof value}. Re-run the Data Center export script.`);
  }
  value.forEach((item, i) => {
    for (const key of required) {
      if (typeof item?.[key] !== 'string') {
        throw new Error(`Snapshot ${path}[${i}] needs a string "${key}", got ${JSON.stringify(item?.[key])}. Re-run the Data Center export script.`);
      }
    }
  });
  return value;
}

/**
 * Validates the read-only Data Center export at the boundary; everything past here trusts the shape.
 * @param {string} text
 * @returns {import('./engine.js').World}
 */
export function parseSnapshot(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new Error(`Snapshot is not valid JSON (${error.message}). Paste the whole file produced by the Data Center export script.`);
  }
  const entities = Object.fromEntries(
    ENTITY_TYPES.map((type) => [type, stringRecords(raw?.entities?.[type] ?? [], `entities.${type}`, ['id', 'name'])]),
  );
  const filters = stringRecords(raw?.filters, 'filters', ['id', 'name', 'ownerEmail', 'jql']);
  return { entities, filters };
}
