# Repository analysis
## Input
A **GitHub repository** URL, a **GitHub organization** URL, or a local directory
## Output
Every `SKILL.md`: **name**, **description**, **link**; for an organization, by repository
## Architecture
Core: fetch → find → parse; for the [web view](web.md), then [group](#the-skill-map). CLI and web view: *thin clients*.
Skill: id = `repo:path`, name, description, commit, the `SKILL.md` text
Repository: on GitHub, also its *stars*. Organization, or the user owning a repository: also its *avatar* and *homepage*
## Details
- **GitHub API**, no clone; *under 5 s* for intellij-community
- The name: front matter, else the directory
- The link pins the *scanned commit*
- A `/tree/<ref>` URL pins the commit: listed through its tree, since code search sees only the default branch; an unknown ref → a clear message, exit code 1
- End-to-end: `JetBrains/MPS`, `JetBrains/android`, `JetBrains/kotlin` and `JetBrains/koog`, each at a fixed commit, print what [tests/e2e](../tests/e2e/) holds
- Malformed front matter → a *warning*, the scan goes on
- Unreachable repository → a clear message, exit code 1
- The owner's avatar and homepage: what its GitHub profile lists, for an organization or a user; the avatar only over `https:`; the homepage only a web address, `https://` added when it has no scheme (`www.jetbrains.com` → `https://www.jetbrains.com/`); otherwise *left out*
- For a single repository, the owner's profile is one more request, made only when it is shown (the [web view](web.md)); the CLI prints neither
### A whole organization
- `github.com/<owner>`: every repository of the organization, or of the user's account, scanned as each would be on its own, at its *default branch*
- Repositories sorted by id, *ignoring case*; skills by name within each; a repository's warnings after its id: `<owner>/<repo>: …`
- With `GITHUB_TOKEN`: **one code search** for the whole owner; only the repositories it finds are scanned; over the 1000 results it answers → a warning that some skills may be missing. Code search leaves *forks* out: each fork's tree
- Without it: each repository's tree, a few at a time
- Empty and disabled repositories: nothing to scan, *skipped*; an empty repository scanned on its own → a clear message, exit code 1
- Unknown organization → a clear message, exit code 1
### What is a project skill?
- Only folders usually containing skills (`agents/skills`, `agent/skills`, `.claude/skills`, and similar roots for other tools) should be considered
- The same skill may be duplicated (one copy per agent), but those should count as a single skill. For example, `.agents/skills` and `.claude/skills` may contain the same skill, but should count as one.
- Roots: `.agents/skills`, `agents/skills`, `.agent/skills`, `agent/skills`, `.claude/skills`, `.github/skills`, `.cursor/skills`, `.codex/skills`, `.gemini/skills`, `.junie/skills`, `.opencode/skills`, `.windsurf/skills`
- A root counts at any depth (a monorepo module has its own); a `SKILL.md` must be in a skill directory under it, not in the root itself
- Copies: the same path under a root, with the same prefix before it; the skill is the copy in the first root of the list, the others are its *copies*
- Skills used as resources (either because they are shipped as part of the product, or because they are used in tests) should not be counted as project skills
- Resources: a root under a directory named `src`, `resources`, `test`, `tests`, `__tests__`, `testSrc`, `testData`, `testResources`, `testFixtures`, `fixture`, `fixtures` or `__fixtures__` (any case, with or without `-` and `_`) holds resources, not project skills
## The skill map
The skills, of a repository or of a whole organization, **grouped by affinity**, for the [web view](web.md); the CLI prints them as before
- By **Claude**: `claude -p` on the machine the web view runs on, the prompt on its stdin, its answer on its stdout; `SKILL_ATLAS_CLAUDE`, another executable
- Asked: every skill, numbered, sorted by name, with its name and its description on one line; answered: JSON, `{"groups": [{"name": "…", "skills": [1, 2]}]}`, also in a code block or after a sentence
- Each group's *name* says what kind of skills it holds: the names alone give an idea of the skills in the repository or the organization
- An organization's groups go **across** its repositories
- Groups sorted by name, ignoring case; skills by name within each; a skill the answer leaves out → `Other`, *last*; one listed twice → its first group; numbers that are no skill, ignored
- No skill → no group, *nothing asked*
- Claude not installed, failing, over *3 minutes*, or answering no group of the skills → **by repository**, each a group named after its id, and a warning: `Skills grouped by repository, not by affinity: <why>`
- The same skills asked about *once* while the web view runs, in memory only: a reload does not ask again; a failure is asked again
- The tests are *deterministic*: Claude's answers **recorded**, by prompt, in [tests/claude.json](../tests/claude.json) and [demo/claude.json](../demo/claude.json), and replayed; an unrecorded prompt is never sent. `npm run record`: asked again of `claude -p`
