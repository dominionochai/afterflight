# 1. THE MISSION

Build a better post-migration repair system for Jira Data Center to Jira Cloud migrations.

Premise: Atlassian's Jira Cloud Migration Assistant (JCMA) moves the data, but does not guarantee the migrated Jira environment behaves as it did before migration. We identify and repair the problems its migration process leaves behind. This is not another migration tool. It checks, diagnoses and repairs what migration leaves broken.

Pitch: Atlassian's migration tooling has documented gaps in JQL resolution and post-migration validation. We built a repair system that identifies those gaps, reconstructs broken references, repairs affected configurations and verifies the results. No claims of replacing JCMA. No claims of fixing everything. We demonstrate exactly what we improve.

# 2. WHAT WE ARE REVERSE-ENGINEERING

Three systems.

## A. Atlassian JCMA — primary target (Jira Cloud Migration Assistant, official product documentation: the migration process, checks, reports, reconciliation and remediation mechanisms).

What it already does: migrates projects, issues, users, groups, boards and filters; performs pre-migration checks; produces migration reports and error logs; supports remediation of selected errors; reports some unresolved JQL references.

What we are investigating, as a table of JCMA capability vs our investigation:

| JCMA capability | Our investigation |
| --- | --- |
| JQL sanitisation | Which references does it miss? |
| Entity ID mapping | Which entity types remain unresolved? |
| Pre-migration checks | What problems escape detection? |
| Post-migration reports | What important failures are not reported? |
| Board migration | Why can boards return different results? |
| Remediation | Which corrections remain manual? |
| Migration completion | What does successful migration actually guarantee? |

Primary evidence: Atlassian explicitly states its JQL sanitisation is partial and that not all unresolved references are reported. Its documentation identifies seven JQL-containing entity types and 14 referenced entity types (Atlassian Support). Another Atlassian support article explicitly says JCMA does not verify whether board JQL returns the correct results after migration (Atlassian Support). MIG-2520 documents requests for automatic correction of remaining unmapped JQL references (Atlassian).
