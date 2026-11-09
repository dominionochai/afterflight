# 10. IMMEDIATE NEXT ACTION

Before any code, we need a detailed technical reverse-engineering matrix for JCMA, Migration Doctor and JQL Stabilizer.

It must answer: What exactly does each product inspect? Which underlying APIs and data sources does it use? Which JQL entity types can it read? Which can it write? What mappings can it reconstruct? How does it verify equivalence? What does it leave untouched? What is impossible through Forge? Which weaknesses can we reproduce in a controlled migration?

Key distinction: we are not trying to make a prettier Migration Doctor. We are trying to prove that JCMA's documented gaps can be repaired more comprehensively and safely.

Current state: research complete enough to define the mission; reverse-engineering incomplete; no code built; no winner-level technical proof yet.

## Detailed technical reverse-engineering matrix

Only the supplied established findings are treated as confirmed. Do not infer capabilities beyond those findings. Each unknown or unverified entry is marked `UNVERIFIED`.

| Question | JCMA | Migration Doctor | JQL Stabilizer |
| --- | --- | --- | --- |
| What exactly does each product inspect? | Migrates projects, issues, users, groups, boards and filters; performs pre-migration checks; produces migration reports and error logs; performs partial JQL sanitisation and reports some unresolved JQL references. It does not verify whether board JQL returns the correct results after migration. | Nine post-migration checks; Data Center configuration snapshots; missing filter and dashboard detection; Data Center username detection in JQL; missing field, status and group detection; JQL validation and change logs. | Custom-field rename repair; original versus proposed JQL comparison; equivalence checking; owner-controlled updates; verification after saving; reverting the last verified update. |
| Which underlying APIs and data sources does it use? | Official product documentation covers the migration process, checks, reports, reconciliation and remediation mechanisms. Exact underlying APIs and data sources: UNVERIFIED. | A read-only Data Center snapshot script supplies information to its Cloud app. Exact APIs and other data sources: UNVERIFIED. | UNVERIFIED. |
| Which JQL entity types can it read? | Atlassian documentation identifies seven JQL-containing entity types and 14 referenced entity types. Names of those types and per-type read coverage: UNVERIFIED. | Data Center username detection in JQL and JQL validation are listed. Exact JQL-bearing entity types and read coverage: UNVERIFIED. | Custom-field rename repair is offered. Exact JQL-bearing entity types and read coverage: UNVERIFIED. |
| Which JQL entity types can it write? | Supports remediation of selected errors and partial JQL sanitisation. Exact JQL entity types written: UNVERIFIED. | Corrected filter copies are offered. Other write surfaces and exact entity types written: UNVERIFIED. | Owner-controlled updates are offered for custom-field rename repair. Other write surfaces and exact entity types written: UNVERIFIED. |
| What mappings can it reconstruct? | Entity ID mapping is part of the migration capability under investigation. Exact mappings and which entity types remain unresolved: UNVERIFIED. | Automated mapping of equivalent entities is an investigation target. Mappings it can currently reconstruct: UNVERIFIED. | Custom-field rename repair is offered. Exact mapping method and mappings beyond this: UNVERIFIED. |
| How does it verify equivalence? | JCMA does not verify whether board JQL returns the correct results after migration. Other equivalence verification: UNVERIFIED. | Query result comparison and verification that repairs preserve actual behaviour are investigation targets. Current equivalence verification: UNVERIFIED. | Equivalence checking and verification after saving are offered. Exact equivalence method and whether query results are compared: UNVERIFIED. |
| What does it leave untouched? | Some unresolved references are not reported. Which specific references or other issues are left untouched: UNVERIFIED. | Specific untouched issues: UNVERIFIED. | Specific untouched issues beyond the stated custom-field rename repair scope: UNVERIFIED. |
| What is impossible through Forge? | UNVERIFIED. | UNVERIFIED. | UNVERIFIED. |
| Which weaknesses can we reproduce in a controlled migration? | UNVERIFIED. | UNVERIFIED. | UNVERIFIED. |

Confirmed architecture constraint: a Cloud Forge application cannot simply read the customer's private Data Center database. Whether any specific operation in the three products is impossible through Forge is UNVERIFIED.

No controlled migration has been run, no application has been built, and no repair has been verified. Reproducibility of the weaknesses above is UNVERIFIED.
