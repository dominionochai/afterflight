import Resolver from '@forge/resolver';
import api, { assumeTrustedRoute } from '@forge/api';
import { kvs, WhereConditions } from '@forge/kvs';
import { makeAuditLog } from './audit.js';
import { buildIntegrityReport, renderMarkdown } from './report.js';
import { runAnalysis, runApply, runBoardParity, runBoardQueryCheck, runResultParity, runRollback } from './service.js';

const requestJira = (path, init) => api.asUser().requestJira(assumeTrustedRoute(path), init);

const store = {
  put: (key, value) => kvs.set(key, value, { keyPolicy: 'FAIL_IF_EXISTS' }),
  async list(prefix) {
    const out = [];
    for (let cursor; ; ) {
      const query = kvs.query().where('key', WhereConditions.beginsWith(prefix)).limit(100);
      const page = await (cursor ? query.cursor(cursor) : query).getMany();
      out.push(...page.results);
      cursor = page.nextCursor;
      if (!cursor) return out;
    }
  },
};
const audit = makeAuditLog(store);
const actorOf = (context) => context.accountId ?? 'unknown';

const resolver = new Resolver();
resolver.define('analyse', ({ payload }) => runAnalysis({ ...payload, requestJira }));
resolver.define('boardParity', ({ payload }) => runBoardParity({ ...payload, requestJira }));
resolver.define('resultParity', ({ payload }) => runResultParity({ ...payload, requestJira }));
resolver.define('boardQueries', () => runBoardQueryCheck({ requestJira }));
resolver.define('apply', ({ payload, context }) => runApply({ ...payload, requestJira, audit, actor: actorOf(context) }));
resolver.define('rollback', ({ payload, context }) => runRollback({ runId: payload.runId, requestJira, audit, actor: actorOf(context) }));
resolver.define('report', async ({ payload }) => {
  const analysis = await runAnalysis({ ...payload, requestJira });
  const boards = payload.idMappingCsv ? await runBoardParity({ ...payload, requestJira }) : [];
  const queryCheck = await runBoardQueryCheck({ requestJira }).catch((error) => ({ checked: 0, findings: [], note: `Board quick filters were not checked (${error.message}).` }));
  const parity = await runResultParity({ ...payload, requestJira }).catch(() => []);
  const report = buildIntegrityReport({ generatedAt: new Date().toISOString(), analysis, boards, queryCheck, parity, auditEntries: await audit.list() });
  return { report, markdown: renderMarkdown(report) };
});

export const handler = resolver.getDefinitions();
