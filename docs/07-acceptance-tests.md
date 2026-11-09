# 7. THE ACCEPTANCE TESTS

1. A project ID changes between environments. Can we reconstruct the correct JQL?
2. A custom field is renamed. Can we identify every affected filter?
3. A user is migrated to a different account ID. Can we repair the reference?
4. A status is missing. Can we detect the problem without guessing a replacement?
5. A filter references another filter that was not migrated. Can we identify the dependency?
6. A board migrates successfully but returns different issues. Can we detect the discrepancy?
7. A query is syntactically valid but references the wrong project. Can we flag it?
8. A repair is applied. Can we verify that it worked and preserve the original?
9. A repair is interrupted halfway through. Can we safely resume without corrupting the configuration?
10. A query returns different results because permissions differ. Can we distinguish permission effects from actual JQL corruption?

We do not claim success until these tests pass.
