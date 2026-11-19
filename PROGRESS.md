# Afterflight progress

Last updated: 2026-11-16. Source of truth for what works, what was tested, and what needs a human.

## How to read test evidence
- **MOCKED**: `node --test` against fixtures, an in-memory Jira fake, a local fake DC server, or an in-memory KVS stand-in.
- **STATIC**: checks that read files (manifest, source) without running Jira or Forge.
- **LIVE**: runs against a real Jira Cloud site, a real Data Center, or a deployed Forge app. None has been executed yet; see Blockers.

## Baseline (start of this working session)
- 87 tests, all MOCKED or STATIC, all passing (`node --test`, Node 22).
- No live execution of any Cloud, Data Center or Forge call from the shipped code.

## Blockers needing a human
- **B1 No Data Center**: Atlassian stopped self-serve DC trial licenses on 2026-03-30, so no real JCMA run or real DC export exists.
- **B2 Forge never deployed**: `forge lint`, `deploy` and `install` need the owner's Forge login.
- **B3 Live Cloud tests**: the build sandbox cannot reach `*.atlassian.net`. A live smoke test (`bin/live-smoke.js`, when added) needs the domain allowed plus an API token.
