# Command line
`./skill-atlas scan <GitHub URL | directory>`; `./skill-atlas serve`: the [web view](web.md)
- `github.com/<owner>/<repo>`: the default branch; `github.com/<owner>/<repo>/tree/<ref>`: that branch, tag or commit
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
