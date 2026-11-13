const HEADER = 'entity type';

function splitCsvLine(line) {
  const cells = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { cells.push(cell); cell = ''; }
    else cell += c;
  }
  return [...cells, cell];
}

/**
 * Parses JCMA's ID Mapping Report CSV (Entity Type, Server ID, Cloud ID). The report repeats its
 * header row, so every row whose first cell is "Entity Type" is skipped. Entity type strings are kept
 * exactly as written; which string means "filter" or "board" must come from a real report.
 * @param {string} csvText
 * @returns {{ get: (entityType: string, serverId: string) => string | undefined, serverIds: (entityType: string) => string[], size: number }}
 */
export function parseIdMapping(csvText) {
  const map = new Map();
  csvText.split(/\r?\n/).forEach((line, i) => {
    if (!line.trim()) return;
    const [type, serverId, cloudId] = splitCsvLine(line).map((cell) => cell.trim());
    if (type.toLowerCase() === HEADER) return;
    if (!type || !serverId || !cloudId) {
      throw new Error(`ID mapping line ${i + 1} needs Entity Type, Server ID and Cloud ID, got "${line}". Re-download the report.`);
    }
    const key = `${type}|${serverId}`;
    if (map.has(key) && map.get(key) !== cloudId) {
      throw new Error(`ID mapping line ${i + 1}: ${key} maps to both ${map.get(key)} and ${cloudId}. Reports cover earlier runs too; download the report for the migration you are verifying.`);
    }
    map.set(key, cloudId);
  });
  return {
    get: (entityType, serverId) => map.get(`${entityType}|${serverId}`),
    serverIds: (entityType) => [...map.keys()].filter((k) => k.startsWith(`${entityType}|`)).map((k) => k.slice(entityType.length + 1)),
    size: map.size,
  };
}
