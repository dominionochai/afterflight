# 5. THE ACTUAL TECHNICAL ARCHITECTURE

Two sides, because a Cloud Forge application cannot simply read the customer's private Data Center database.

Jira Data Center (source environment: configuration, JQL, entity IDs and metadata) -> read-only snapshot/export -> migration comparison engine (mapping and discrepancy analysis, source versus Cloud references, repair proposals) -> Jira Cloud / Forge (destination environment: validate, approve, update and verify) -> migration repair report (what was broken, what was fixed, what remains unresolved).
