# 4. WHAT WE INTEND TO BUILD

Five components.

1. Migration snapshot reader — read the Data Center configuration snapshot and Cloud configuration through supported interfaces.
2. Reference comparison engine — compare source and destination references across projects, custom fields, statuses, issue types, priorities, versions, components, users, groups, filters, sprints, and other supported JQL entities.
3. JQL diagnosis engine — identify unresolved IDs, missing entities, invalid field references, stale usernames, broken filter references, and queries that execute but produce suspiciously different results.
4. Repair engine — generate replacement JQL, use deterministic mappings, flag ambiguous mappings, preserve original queries, require approval where necessary, apply supported changes.
5. Verification and reporting — re-read repaired configuration, validate the JQL, compare query results where possible, record successful and failed repairs, generate a migration integrity report.
