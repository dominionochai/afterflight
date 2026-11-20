# Afterflight progress

Last updated: 2026-11-16. Source of truth for what works, what was tested, and what needs a human.

## How to read test evidence
- **MOCKED**: `node --test` against fixtures, an in-memory Jira fake, a local fake DC server, or an in-memory KVS stand-in.
- **STATIC**: checks that read files (manifest, source) without running Jira or Forge.
- **LIVE**: runs against a real Jira Cloud site, a real Data Center, or a deployed Forge app. None has been executed yet; see Blockers.

## Baseline (start of this working session)
- 87 tests at baseline (now 103), all MOCKED or STATIC, all passing (`node --test`, Node 22).
- No live execution of any Cloud, Data Center or Forge call from the shipped code.

## Completed
1. **Report formatting**: lists no longer render as `- - item`; blast-radius coverage moved to "checked". Test: `audit.test.js` (MOCKED).
2. **Filter pairing**: filters sharing owner and name are never paired by guessing; they are listed as not analysed with the reason. A report row pointing at a missing Cloud filter is "not migrated", not a name guess. A Cloud filter is never claimed twice. Tests: `edge.test.js` (MOCKED).
3. **Retry and bounded concurrency**: `src/retry.js` (429, gateway errors, reads on 500, network errors; Retry-After; 20 s deadline inside Forge's 25 s runtime limit) wired into every resolver; `src/concurrency.js` bounds per-project and live-verify reads. Tests: `retry-concurrency.test.js` (MOCKED; Jira's real rate-limit behaviour is not tested).
4. **Needed-only Cloud reads**: only the entity types a snapshot's queries refer to are read; versions and components (two requests per project) only when referenced. Test: `retry-concurrency.test.js` (MOCKED).

5. **JQL edge cases and honest coverage**: `was`, `was not in`, `changed from/to` and `by` clauses are read and repaired; functions that take arguments (group, version and app functions that embed JQL) and unterminated strings are listed per filter as not analysed, counted in the report summary and named in a caveat. Tests: `jql-edge.test.js` (MOCKED).

## Resume here: remaining backlog, in priority order
1. **Large snapshot and analysis limits** (evidence gathered): the Forge UI-to-backend payload limit is 500 KB, a UI-invoked function runs at most 25 s, a KVS value is at most 240 KiB. Plan: split the pasted snapshot into about 50,000-character chunks stored in KVS with a checksummed meta record; batch analysis with offset and limit and a time budget; move plans and boards blast radius out of `runAnalysis` into its own batched call.
2. **Audit store and rollback reliability**: move the KVS adapter out of `src/index.js` into a testable module; let rollback reconcile "attempting" entries that never got an "applied" record by checking the live filter.
3. **Permission-aware comparisons** (acceptance test 10): classify each missing or unexpected issue as visible to the viewing user (real mismatch) or not visible (permissions or not migrated, indistinguishable from here). Needs route evidence for bulk issue fetch and permission checks first.
4. **Advanced Roadmaps and quick filters**: Cloud plan integrity (issue sources, exclusion rules and custom fields that point at entities missing in Cloud); quick filter comparison against an exported DC source with a runtime probe of the DC quick filter route.
5. **Real HTTP adapter and live smoke test** for Jira Cloud with API-token auth (cannot be run from the sandbox; see B3), plus a static test that every route the code calls has its scope in `manifest.yml`.
6. Then: `service.js` split by responsibility only if it still reads badly, a downloadable report, demo kit, Devpost write-up.

## Blockers needing a human
- **B1 No Data Center**: Atlassian stopped self-serve DC trial licenses on 2026-03-30, so no real JCMA run or real DC export exists.
- **B2 Forge never deployed**: `forge lint`, `deploy` and `install` need the owner's Forge login.
- **B4 Push access**: pushes used a one-hour GitHub token pasted in chat; a new session needs a fresh token. Never store it.
- **B3 Live Cloud tests**: the build sandbox cannot reach `*.atlassian.net`. A live smoke test (`bin/live-smoke.js`, when added) needs the domain allowed plus an API token.
