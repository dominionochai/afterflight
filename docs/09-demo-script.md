# 9. WHAT THE FINISHED CODEGEIST SUBMISSION MUST DEMONSTRATE

One deliberately prepared migration scenario.

Before: run JCMA. Show the resulting migrated environment and its remaining defects.

Our inspection: run our product. Show the actual broken references, missed problems and affected configuration.

Our repair: apply deterministic corrections and flag ambiguous cases.

After: run verification. Show which problems were fixed and which remain unresolved.

Final pitch: Atlassian's migration assistant moves Jira environments to Cloud, but its own documentation acknowledges that some JQL references remain unresolved and board results are not verified. We built a repair system that compares the original and migrated configurations, identifies what broke, fixes supported problems and verifies the outcome.
