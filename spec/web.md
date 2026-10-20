# Web view
`./skill-atlas serve [--port <port>]`: the scan as a page, at `http://localhost:3000` by default
- At the top, a **text field**: a GitHub URL or a directory, as for `scan`
- On the left, the **skills**: `<owner>/<repo> · N skills`, each skill's name and first sentence, sorted by **name**; the warnings below them
- On the right, the **selected skill's `SKILL.md`**, rendered: its front matter as a table, then its Markdown; its path, linked as in `scan`, and its copies
- A failed scan → its message, in place of the skills
- `?repo=…&skill=…` in the address: the scan and the selection survive a reload
- `GITHUB_TOKEN`, as for `scan`; *nothing is stored*
## Safety
- Listens on *this machine only*, and answers only for `localhost`: it reads local directories
- Nothing in a `SKILL.md` runs: raw HTML is shown as text; links keep only web addresses, relative ones resolved against the file
- A port in use → a clear message, exit code 1
