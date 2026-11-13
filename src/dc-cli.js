import { readFile, writeFile } from 'node:fs/promises';
import { exportDcSnapshot, makeDcGetJson } from './dc-exporter.js';
import { parseIdMapping } from './idmap.js';

const USAGE = [
  'Usage: node bin/export-dc.js --out snapshot.json --base-url https://jira.example.com',
  '         [--id-mapping report.csv --filter-type "<Entity Type used for filters in the report>"]',
  'The credential is read from AFTERFLIGHT_DC_AUTH as a full Authorization header value, e.g. "Bearer <token>".',
  'The base URL may instead come from AFTERFLIGHT_DC_URL. The export only issues GET requests.',
].join('\n');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith('--') || argv[i + 1] === undefined) throw new Error(`Expected "--name value" pairs, got "${argv[i]}".\n${USAGE}`);
    args[argv[i].slice(2)] = argv[i + 1];
  }
  return args;
}

/** @param {string[]} argv @param {Record<string, string | undefined>} env @param {(line: string) => void} [log] */
export async function main(argv, env, log = console.log) {
  const args = parseArgs(argv);
  const baseUrl = args['base-url'] ?? env.AFTERFLIGHT_DC_URL;
  const authorization = env.AFTERFLIGHT_DC_AUTH;
  if (!baseUrl || !authorization || !args.out) throw new Error(USAGE);

  let filterIds = [];
  if (args['id-mapping']) {
    if (!args['filter-type']) throw new Error('--id-mapping needs --filter-type, the Entity Type string the report uses for filters.');
    filterIds = parseIdMapping(await readFile(args['id-mapping'], 'utf8')).serverIds(args['filter-type']);
  }
  const { snapshot, warnings } = await exportDcSnapshot({ getJson: makeDcGetJson({ baseUrl, authorization }), filterIds });
  await writeFile(args.out, JSON.stringify(snapshot, null, 2));
  warnings.forEach((w) => log(`WARNING ${w}`));
  log(`Wrote ${args.out}: ${snapshot.filters.length} filters, ${snapshot.boards.length} boards, ${snapshot.entities.project.length} projects.`);
}
