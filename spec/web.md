# Web view
`./skill-atlas serve [--port <port>]`: the scan as a page, at `http://localhost:3000` by default
- At the top, a **text field**: a GitHub URL, a GitHub organization (`github.com/<owner>`) or a directory, as for `scan`
  - `~/projects/foo` → the same directory as `/home/<you>/projects/foo`: nothing in the browser expands `~`, the server does, as `scan` does; a relative path, against the directory `serve` started in
- On the left, at the very top and *always visible*, a **filter** field: before any scan, after a failed one, and while the list under it scrolls
  - As the user types, only the skills whose *name* contains the text, ignoring case, are listed; *no button*
  - Empty or only spaces → every skill
  - The selected skill stays on the right, even when filtered out of the list
  - A new scan empties it
- Under it, for GitHub, the **owner**: the organization scanned, or the organization or user owning the repository; its *avatar*, its login, linked to its GitHub page, and its *homepage*, linked, shown without `https://` and a trailing `/`; whichever of them [its profile lists](analysis.md#details)
  - Nothing for a local directory
  - GitHub does not answer for the owner's profile → its login only, and a warning
- Then the **skills**: the scan's summary, `<owner>/<repo> · N skills`, or `<owner> · N skills in M repositories` for an organization; it stays the scan's, whatever the filter
  - Then the skills **by affinity**, as [the skill map](analysis.md#the-skill-map) groups them, also for a single repository: `<group> · K skills`, *K* the skills the filter leaves there; for an organization, across its repositories
  - Each group's skills as **chips**: only their *names*, sorted by name, as many on a line as fit; the description's first sentence, as text, on hover, after the skill's repository for an organization
  - A group with no skill the filter leaves *is not shown*
  - No skill matches the filter, or none at all in the repository or the organization → `No skills found`
  - The warnings below them; for an organization, each after its repository
- On the right, the **selected skill's `SKILL.md`**, rendered: its front matter as a table, then its Markdown; its path, linked as in `scan` for a GitHub repository, after its repository for an organization, then its repository's GitHub **stars**, and its copies
  - The stars: `★ 56.2k`: under 1000 as they are; else in thousands, `k`, or millions, `m`, *rounded* to one decimal, without a `.0` (`1k`, `999.9k`, `1m`); the exact number on hover; none for a local directory
- The description is *Markdown*: rendered in the table; on a chip's hover, its text
- A failed scan → its message, in place of the skills, under the filter
- `?repo=…&skill=…` in the address, the skill by its id, `repo:path`: the scan and the selection survive a reload; `&filter=…`, the filter
  - A failed scan too: the address is the scan shown, its repository; a reload scans it again, and shows its message
  - Typed at the top, no skill and an empty filter, as for any new scan; from the address, a reload or a shared link, its `&skill=…` and `&filter=…` kept
- `GITHUB_TOKEN`, as for `scan`; *nothing is stored*; Claude's groups kept in memory only, while it runs
## Look
- The *same layout*, in an **indigo-to-violet** palette: the header a gradient, with the **logo**, a compass, before `Skill Atlas`, and the field and `Scan` in white on it
- The left pane *tinted*: the filter with a search icon; the owner a **card**; each skill a rounded **chip**, the selected one *filled* with the accent color
- Each group's name in *small capitals*; the stars a gold **pill**
- The selected `SKILL.md` on a white **paper card**, a violet line on its top; the front matter's keys in a column of their own; tables and code blocks rounded
  - The card *holds all of its content*, at any width: long code spans, links and values wrap, anywhere if they must, also in the front matter and in tables, as on GitHub; only a code block scrolls sideways
  - Its headings wrap as its text does; in a narrow card, the front matter's keys too, at their hyphens first, anywhere if a key has none and does not fit
- A failed scan's message in a red box, wrapped in it, a long address too; the warnings amber
- **Light and dark**, as the system is: the same colors, from one palette, `light-dark()`; system fonts, nothing loaded from elsewhere
## Safety
- Listens on *this machine only*, and answers only for `localhost`: it reads local directories
- The owner's homepage is only ever a web address, and its avatar an `https:` one
- Nothing in a `SKILL.md` runs: raw HTML is shown as text; links keep only web addresses, relative ones resolved against the file and `/…` against the repository's files at the scanned commit, as GitHub does; images keep only `https:` addresses, the ones the page loads, and are their text otherwise
- A page on `http://localhost` cannot open `file:` addresses: for a local directory, the path and the links are only text
- A port in use → a clear message, exit code 1
## Demo
`npm run demo`: [the demo](../demo/script.ts) plays every feature above on a fake GitHub and a recorded Claude, [no network](../demo/source.ts), and takes its key moments into [shots/](../shots/), with a video, `shots/demo.webm`
- `npm run test:visual` plays it again: each shot must be the one in `shots/`: it fails when *more than 2%* of its pixels changed; a missing one fails too
- The shots are taken on macOS, and compared on macOS in CI; a failure posts each differing shot, expected, actual and diff, in the run's summary and on the pull request
- A change to the page that shows → `npm run demo`, and the new shots committed with it
