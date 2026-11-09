# 6. DEVELOPMENT SEQUENCE

We do not start by building a dashboard.

| Phase | Work | Exit condition |
| --- | --- | --- |
| 1 | Reverse-engineer JCMA | Documented coverage and failure matrix |
| 2 | Reverse-engineer both competitors | Feature and technical comparison |
| 3 | Build test migration environment | Reproducible DC-to-Cloud migration |
| 4 | Build JQL detector | Finds deliberately introduced defects |
| 5 | Build mapping engine | Correctly maps known entities |
| 6 | Build repair engine | Repairs supported defects |
| 7 | Build verification | Proves successful corrections |
| 8 | Build Forge interface | Usable administrator workflow |
| 9 | Demonstrate against JCMA | Reproducible before-and-after evidence |

Phase 3 is the first serious gate. Without a real source and destination environment, we cannot honestly demonstrate that we improve migration outcomes.
