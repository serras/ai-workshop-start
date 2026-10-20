# Repository analysis
## Input
A **GitHub repository** URL, or a local directory
## Output
Every `SKILL.md`: **name**, **description**, **link**
## Architecture
Core: fetch → find → parse. CLI: a *thin client*.
Skill: id = `repo:path`, name, description, commit
## Details
- **GitHub API**, no clone; *under 5 s* for intellij-community
- The name: front matter, else the directory
- The link pins the *scanned commit*
- A `/tree/<ref>` URL pins the commit: listed through its tree, since code search sees only the default branch; an unknown ref → a clear message, exit code 1
- End-to-end: `JetBrains/MPS`, `JetBrains/android`, `JetBrains/kotlin` and `JetBrains/koog`, each at a fixed commit, print what [tests/e2e](../tests/e2e/) holds
- Malformed front matter → a *warning*, the scan goes on
- Unreachable repository → a clear message, exit code 1
### What is a project skill?
- Only folders usually containing skills (`agents/skills`, `agent/skills`, `.claude/skills`, and similar roots for other tools) should be considered
- The same skill may be duplicated (one copy per agent), but those should count as a single skill. For example, `.agents/skills` and `.claude/skills` may contain the same skill, but should count as one.
- Roots: `.agents/skills`, `agents/skills`, `.agent/skills`, `agent/skills`, `.claude/skills`, `.github/skills`, `.cursor/skills`, `.codex/skills`, `.gemini/skills`, `.junie/skills`, `.opencode/skills`, `.windsurf/skills`
- A root counts at any depth (a monorepo module has its own); a `SKILL.md` must be in a skill directory under it, not in the root itself
- Copies: the same path under a root, with the same prefix before it; the skill is the copy in the first root of the list, the others are its *copies*
- Skills used as resources (either because they are shipped as part of the product, or because they are used in tests) should not be counted as project skills
- Resources: a root under a directory named `src`, `resources`, `test`, `tests`, `__tests__`, `testSrc`, `testData`, `testResources`, `testFixtures`, `fixture`, `fixtures` or `__fixtures__` (any case, with or without `-` and `_`) holds resources, not project skills
