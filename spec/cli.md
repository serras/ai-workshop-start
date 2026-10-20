# Command line
`./skill-atlas scan <GitHub URL | directory>`; `./skill-atlas serve`: the [web view](web.md)
- `github.com/<owner>/<repo>`: the default branch; `github.com/<owner>/<repo>/tree/<ref>`: that branch, tag or commit
- `github.com/<owner>`: every repository of the [organization](analysis.md#a-whole-organization), or of the user's account
Prints the result **at once**; *nothing is stored*.
`GITHUB_TOKEN`, optional: a higher GitHub rate limit.
## Output
```
JetBrains/kotlin · 6 skills
build-tools-bump-gradle-api — Bumps the Gradle API…
  https://github.com/JetBrains/kotlin/blob/<commit>/…
```
- Sorted by **name**; the description's *first sentence*: a `.` in a code span does not end it
- `also in <paths>` for copies; warnings go to *stderr*
### An organization
```
JetBrains · 149 skills in 21 repositories

JetBrains/aspire-plugin · 3 skills
changelog — Update CHANGELOG.md with a new release section from the latest GitHub release
  https://github.com/JetBrains/aspire-plugin/blob/<commit>/…
…

JetBrains/azure-tools-for-intellij · 3 skills
…
```
- Each repository *with skills* as on its own, after a blank line; the ones without are not printed
- No skill in any repository → `<owner> · 0 skills`, then `No skills found`
