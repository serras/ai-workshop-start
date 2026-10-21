# Skill Atlas

Every agent skill in a repository: `./skill-atlas scan` finds each `SKILL.md` and prints its name,
description and link, in colors on a terminal (`NO_COLOR` turns them off, `FORCE_COLOR` on).

```console
$ npm ci
$ ./skill-atlas scan https://github.com/JetBrains/kotlin
JetBrains/kotlin · 6 skills
…
build-tools-bump-gradle-api — Bumps the Gradle API version that Kotlin Gradle plugins are compiled against in the Kotlin compiler repository.
  https://github.com/JetBrains/kotlin/blob/5ab6270ab772d113e8ad52ebfcaa0109c522ae00/.claude/skills/build-tools-bump-gradle-api/SKILL.md
…
```

Or a whole organization, repository by repository: `./skill-atlas scan https://github.com/JetBrains`.

Or browse them: `./skill-atlas serve` opens a web view at http://localhost:3000 (`--port` for another
port), with the repository or organization to search at the top, its skills on the left, under the
organization's avatar and homepage, as chips grouped by affinity and filtered by name as you type,
and the selected `SKILL.md` on the right, with its repository's stars, in light or dark mode as your
system is. Claude groups the skills: `claude -p` on your machine (`SKILL_ATLAS_CLAUDE` for another
executable); without it, they are grouped by repository.

Set `GITHUB_TOKEN` for a higher GitHub rate limit. `npm test` runs the tests, with Claude's answers
replayed from [tests/claude.json](tests/claude.json); `npm run record` asks Claude for them again.

`npm run demo` plays every feature of the web view on a fake GitHub and takes its shots into
[shots/](shots/), with a video; `npm run test:visual` checks the page still looks exactly like them
(`npx playwright install chromium` first).
`npm run promo` records a 30-second promotional video of it, with captions, into
[promo/](promo/), next to a [Slack post](promo/slack-post.md) (ffmpeg needed).

- [spec/](spec/): what it does. [AGENTS.md](AGENTS.md): the definition of done.
- [fixture/](fixture/README.md): a small repository for the tests.
