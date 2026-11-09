# 2. WHAT WE ARE REVERSE-ENGINEERING (continued)

## B. Migration Doctor — closest competitor (Marketplace listing). Understand its checks, snapshot architecture and repair implementation.

What it already offers: nine post-migration checks; Data Center configuration snapshots; missing filter and dashboard detection; Data Center username detection in JQL; missing field, status and group detection; corrected filter copies; JQL validation and change logs.

Its architecture is particularly important: a read-only Data Center snapshot script supplies information to its Cloud app.

What we need to improve: coverage of unresolved references; detection of valid-but-incorrect JQL; board and filter dependency analysis; automated mapping of equivalent entities; query result comparison; repair coverage beyond corrected saved-filter copies; verification that repairs preserve actual behaviour.

We must install and test its public product before making claims about functionality it does not support.

## C. JQL Stabilizer — repair-engine reference (Marketplace listing). Understand its reference replacement and verification approach.

What it already offers: custom-field rename repair; original versus proposed JQL comparison; equivalence checking; owner-controlled updates; verification after saving; reverting the last verified update.

What we need to improve: migration-specific entity mapping; multiple entity types rather than principally custom-field references; cross-instance Data Center-to-Cloud comparison; bulk diagnosis and repair; board-level JQL coverage; historical migration mapping and evidence.

We must not pretend its safety features are novel. We need to build on them.
