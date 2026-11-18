# Pungitore panel

A permanent column on the right of the window that shows the repository the
shown space works in the way the workflow sees it: the open to-dos from its
`TODO.md`, the branch it is on, and what the agents in it are doing. The first
open to-do is marked as the next action, and clicking a to-do opens it in a
dialog where it can be changed before it goes out as a session's first message.

![Pungitore panel](preview.png)

**What you see:**

- A full-height column, 320px wide in this layout, on a `theme().surface`
  background, padded 8px, with the rows 2px apart. It scrolls with a scrollbar.
- One word at the top, "Pungitore", in 11px `theme().dim`, padded 4px left and
  4px bottom. Next to it, "N waiting" in 11px `theme().accent`, when the
  Learning Loop has candidate lessons waiting to be promoted.
- One block, for the repository the shown space works in: an 8px square chip in
  the colour the space wears in the sidebar, then the repository's name — the
  last path segment of its folder — in 12px semibold in that same colour,
  truncated. To its right, the branch in 10.5px `theme().dim`, when Herdr knows
  one.
- Then one line per agent working in that space: a 7px round dot in the
  agent's status colour, and the status word followed by the agent's title
  (`working — Writing the eval suites`), in 11px `theme().muted`, truncated.
  The dot is green `#3fae6a` for working, amber for blocked, blue for done and
  grey for idle; an unknown status falls back to `theme().dim`, and an agent
  reported as `error` is drawn in the blocked colour.
- Then the open to-dos, at most six. Each is a row with 8px of side padding
  and 3px above and below, rounded 5px, that turns `theme().hover` under the
  pointer. Its marker is `▶` in 11px `theme().accent` for the first one and
  `·` in 11px `theme().dim` for the rest; its text is 11.5px,
  `theme().foreground` for the first one and `theme().muted` for the rest.
- Under the to-dos, `+N more` in 10.5px `theme().dim` when the repository has
  more than six open ones, and `N done` in the same style when its `TODO.md`
  has ticked boxes.

**How it behaves:**

- **The panel follows the space the window is showing.** It is one repository,
  not a list: the space Herdr has selected, and the repository that space's
  terminal is working in. Switching spaces in the sidebar switches what the
  panel shows.
- **The repository is where the work is, not where the space was made.** A
  space's own folder is where its *next* terminal starts, which goes stale as
  soon as a terminal moves, so the panel takes the folder from the terminal in
  the shown space — the focused one — and walks up from there to the nearest
  `TODO.md`, so a terminal sitting in `src/` still finds the repository's.
- **The repository's `TODO.md` is canonical.** This panel only mirrors it, and
  it reads the file itself, with the space's machine as the `on` host, so a
  repository on another machine is read over there. The mirror cannot drift
  from the truth. An open to-do is a line matching `-` or `*`, then `[ ]`, then
  the text; a ticked line (`[x]` or `[X]`) counts towards the "done" total.
- **A switch of space is read at once.** Herdr redraws the mod when its live
  data changes, and the panel reads the new repository on that redraw: one
  file read, not the wait for the next poll. It says "reading…" while it is
  read, and the to-dos of the repository it just left are gone, so a click
  cannot start a session in the wrong one.
- **Every five seconds the panel re-reads the repository and redraws.** A
  change to a `TODO.md` shows up within five seconds, with no reload and no
  keypress.
- **The waiting count is the Learning Loop's, read as a fact.** The Loop
  publishes the count in a marker comment, and the panel sums the markers, so
  the loop is visible without asking for it. A machine without the Loop
  installed shows nothing there.
- **Clicking an open to-do does not start anything.** It opens the
  `pungitore-confirm` dialog — a 520x250 one, over the window — with the
  to-do already written in the box, the repository's name in the line above it,
  and a Send and a Cancel button. The text can be changed there; Enter sends
  it, Esc or Cancel sends nothing. Sending it starts `claude` in that space,
  in that repository's folder, with the text as the agent's first message, and
  a notification names the repository and repeats the message.
- **The `▶` marks the first open to-do as the next action.** It is a marker,
  not a filter: clicking any to-do opens that one.
- **The panel reads what Herdr knows about the space:** its folder, its branch
  and its agents. It never asks git anything itself.
- **The colour is the space's own.** It comes from `shared("space.colors")`,
  the same map the sidebar, the tab bar and the picker read, so the panel and
  the sidebar agree on which space is which. The names map to the same hexes
  they do there: `ansi6` is `#22a99a`, `ansi3` `#e3814f`, `ansi4` `#5b8def`,
  `ansi5` `#8b7cf6`, `ansi2` `#3fae6a`, `ansi1` `#d9649a`.

**Built from:**

- The layout's node tree. `layouts/herdr.json` is a root row with two children:
  the 268px `sidebar` column and the `work` column. The panel is the 320px
  block inside the work area's row, next to the terminal. It sits there, and
  not as a third column of the root, so the tab bar spans the whole work area
  and the window buttons it draws stay in the corner of the window.
- The mod itself: `mods/pungitore-panel/main.js`, default-exporting a class
  extending `View`, with `mod.json` as `{"place": "right", "size": 320}`.
- The `herdr` functions it calls: `spaces()` for the spaces and the one that
  is shown, `focused()` and `panes()` for the folder the work is in, `agents()`
  for the agents in the space, `readTextFile()` to read the `TODO.md`,
  `exec("grep", …)` for the waiting count, `shared("space.colors")` for the
  colour of the space, `openOverlay()` to open the confirmation dialog,
  `theme()` for the colours, and `checking()` to stand down during
  `herdr-app check`.
- The dialog it opens is a mod of its own: `mods/pungitore-confirm`.
- Its art: none. Every mark is drawn — the `▶` and `·` markers are text, the
  status dot is a 7px rounded box, the repository name is text.

**Watch out:**

- **The repository's name is its folder's last segment.** A space called
  something else, or a repository whose folder is named something else, shows
  the folder.
- **The to-do text is the `TODO.md` line with the box stripped.** The regex
  allows leading whitespace, so an indented sub-item counts as a top-level
  open to-do and takes a slot of its own. A line written as `[ ]` with no `-`
  or `*` in front is not seen at all.
- **Six to-dos is all you get.** The rest are counted in "+N more" and cannot
  be opened from here — go to the repository's `TODO.md`.
- **The to-do is a proposal, not an order.** Nothing is sent until the dialog
  is sent, and the text that goes out is the edited one, not the one in
  `TODO.md`. `TODO.md` is never rewritten: what is sent is not ticked off
  there.
- **Sending starts `claude`**, not whatever agent the space uses, and it
  starts it in the space's folder. The dialog is the only confirmation; after
  it, the session is a tab like any other, and closing it is on you.
- **The branch is Herdr's, not git's:** no branch, nothing shown.
- **The panel is read-mostly.** It cannot edit `TODO.md`, reorder to-dos or
  mark one done — the repository's file is the only place that changes.

**Done when:**

- The space the window is showing has its repository's name, its branch when
  Herdr knows one, and its first open to-do as the first `▶` line.
- Switching spaces switches what the panel shows, and a terminal sitting
  below the repository's root still finds the repository's `TODO.md`.
- The block wears the colour of the space it shows: the chip and the
  repository's name are in the colour that space has in the sidebar.
- Clicking that line opens a dialog with the to-do in an editable box, the
  repository's name above it, and a Send and a Cancel button; nothing starts
  until it is sent.
- Sending it opens a new tab in that space running `claude` in that folder,
  with the edited text as its first message, and a notification names the
  repository and repeats the message. Esc or Cancel starts nothing.
- A repository with seven or more open to-dos shows six of them and "+1 more".
- A repository whose `TODO.md` has ticked boxes as well as open ones shows
  "N done" under its open to-dos.
- An agent working in that space shows its status word and title under the
  repository name, with the dot in that status's colour.
- Editing the repository's `TODO.md` while the panel is open changes what the
  panel shows within five seconds, with no reload.
