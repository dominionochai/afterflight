# Afterflight progress

Last updated: 2026-11-16. Source of truth for what works, what was tested, and what needs a human.

## How to read test evidence
- **MOCKED**: `node --test` against fixtures, an in-memory Jira fake, a local fake DC server, or an in-memory KVS stand-in.
- **STATIC**: checks that read files (manifest, source) without running Jira or Forge.
- **LIVE**: runs against a real Jira Cloud site, a real Data Center, or a deployed Forge app. None has been executed yet; see Blockers.

## Baseline (start of this working session)
- 87 tests at baseline (now 98), all MOCKED or STATIC, all passing (`node --test`, Node 22).
- No live execution of any Cloud, Data Center or Forge call from the shipped code.

## Completed
1. **Report formatting**: lists no longer render as `- - item`; blast-radius coverage moved to "checked". Test: `audit.test.js` (MOCKED).
2. **Filter pairing**: filters sharing owner and name are never paired by guessing; they are listed as not analysed with the reason. A report row pointing at a missing Cloud filter is "not migrated", not a name guess. A Cloud filter is never claimed twice. Tests: `edge.test.js` (MOCKED).
3. **Retry and bounded concurrency**: `src/retry.js` (429, gateway errors, reads on 500, network errors; Retry-After; 20 s deadline inside Forge's 25 s runtime limit) wired into every resolver; `src/concurrency.js` bounds per-project and live-verify reads. Tests: `retry-concurrency.test.js` (MOCKED; Jira's real rate-limit behaviour is not tested).
4. **Needed-only Cloud reads**: only the entity types a snapshot's queries refer to are read; versions and components (two requests per project) only when referenced. Test: `retry-concurrency.test.js` (MOCKED).

## Blockers needing a human
- **B1 No Data Center**: Atlassian stopped self-serve DC trial licenses on 2026-03-30, so no real JCMA run or real DC export exists.
- **B2 Forge never deployed**: `forge lint`, `deploy` and `install` need the owner's Forge login.
- **B3 Live Cloud tests**: the build sandbox cannot reach `*.atlassian.net`. A live smoke test (`bin/live-smoke.js`, when added) needs the domain allowed plus an API token.
