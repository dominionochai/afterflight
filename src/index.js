import Resolver from '@forge/resolver';
import api, { assumeTrustedRoute } from '@forge/api';
import { kvs, WhereConditions } from '@forge/kvs';
import { makeAuditLog } from './audit.js';
import { withRetry } from './retry.js';
import { buildIntegrityReport, renderMarkdown } from './report.js';
import { runAnalysis, runApply, runBoardParity, runBoardQueryCheck, runResultParity, runRollback } from './service.js';

const RUNTIME_BUDGET_MS = 20_000;
const rawJira = (path, init) => api.asUser().requestJira(assumeTrustedRoute(path), init);
const jira = () => withRetry(rawJira, { deadline: Date.now() + RUNTIME_BUDGET_MS });

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
resolver.define('analyse', ({ payload }) => runAnalysis({ ...payload, requestJira: jira() }));
resolver.define('boardParity', ({ payload }) => runBoardParity({ ...payload, requestJira: jira() }));
resolver.define('resultParity', ({ payload }) => runResultParity({ ...payload, requestJira: jira() }));
resolver.define('boardQueries', () => runBoardQueryCheck({ requestJira: jira() }));
resolver.define('apply', ({ payload, context }) => runApply({ ...payload, requestJira: jira(), audit, actor: actorOf(context) }));
resolver.define('rollback', ({ payload, context }) => runRollback({ runId: payload.runId, requestJira: jira(), audit, actor: actorOf(context) }));
resolver.define('report', async ({ payload }) => {
  const analysis = await runAnalysis({ ...payload, requestJira: jira() });
  const boards = payload.idMappingCsv ? await runBoardParity({ ...payload, requestJira: jira() }) : [];
  const queryCheck = await runBoardQueryCheck({ requestJira: jira() }).catch((error) => ({ checked: 0, findings: [], note: `Board quick filters were not checked (${error.message}).` }));
  const parity = await runResultParity({ ...payload, requestJira: jira() }).catch(() => []);
  const report = buildIntegrityReport({ generatedAt: new Date().toISOString(), analysis, boards, queryCheck, parity, auditEntries: await audit.list() });
  return { report, markdown: renderMarkdown(report) };
});

export const handler = resolver.getDefinitions();
