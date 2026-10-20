# Web view
`./skill-atlas serve [--port <port>]`: the scan as a page, at `http://localhost:3000` by default
- At the top, a **text field**: a GitHub URL or a directory, as for `scan`
- On the left, the **skills**: `<owner>/<repo> · N skills`, each skill's name and first sentence, sorted by **name**; the warnings below them
- Above the skills, a **filter** field: as the user types, only the skills whose *name* contains the text, ignoring case, are listed; *no button*
  - Empty or only spaces → every skill; no match → `No skill matches "<text>".`; the count stays the scan's
  - The selected skill stays on the right, even when filtered out of the list
  - A new scan empties it
- On the right, the **selected skill's `SKILL.md`**, rendered: its front matter as a table, then its Markdown; its path, linked as in `scan` for a GitHub repository, and its copies
- The description is *Markdown*: rendered in the list and in the table; in the list, a link is only its text
- A failed scan → its message, in place of the skills
- `?repo=…&skill=…` in the address: the scan and the selection survive a reload; `&filter=…`, the filter
- `GITHUB_TOKEN`, as for `scan`; *nothing is stored*
## Safety
- Listens on *this machine only*, and answers only for `localhost`: it reads local directories
- Nothing in a `SKILL.md` runs: raw HTML is shown as text; links keep only web addresses, relative ones resolved against the file and `/…` against the repository's files at the scanned commit, as GitHub does; images keep only `https:` addresses, the ones the page loads, and are their text otherwise
- A page on `http://localhost` cannot open `file:` addresses: for a local directory, the path and the links are only text
- A port in use → a clear message, exit code 1
