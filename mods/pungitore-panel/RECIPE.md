# Pungitore panel

The **To-dos** panel: the third tab of the right-hand column, next to Files and
Changes. It shows the to-dos of the space the window is showing, in two lists.

**This repository** is the open to-dos of the repository the space works in,
mirrored from its `TODO.md` — the truth the agent works from. **Quick to-dos**
are the ones you type by hand, kept by Herdr and not written into the
repository: a session refines one of them and writes the deeper to-do into
`TODO.md`.

Clicking either kind of to-do opens it in a dialog, where it can be read and
changed before it goes out as the first message of a new session.

![Pungitore panel](preview.png)

**What you see:**

- The panel fills the right-hand column (368px in this layout), on a
  `theme().surface` background, padded 8px, with the blocks 2px apart. It
  scrolls with a scrollbar.
- One word at the top, "To-dos", in 12.5px semibold `theme().foreground`.
- **This repository** — a heading of that name in 12.5px semibold
  `theme().foreground`. Under it, the repository the shown space works in: an
  8px square chip in the colour the space wears in the sidebar, then the
  repository's name — the last path segment of its folder — in 12px semibold in
  that same colour, truncated. To its right, the branch in 10.5px
  `theme().dim`, when Herdr knows one.
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
- **Quick to-dos** — a second heading, in 12.5px semibold `theme().foreground`,
  with "yours, kept in Herdr" in 10.5px `theme().dim` at the right. Under it:
  - one row per quick to-do, at least 28px tall, 8px of side padding, rounded
    6px, turning `theme().hover` under the pointer. At the left a 16px box
    holding an 11px square with 3px corners and a 1px border: empty and
    `theme().border` when the to-do is open, filled with `theme().done` and
    carrying an 8px check when it is done. Then the text, 11.5px,
    `theme().foreground`, or `theme().dim` when the to-do is done. At the
    right a 18px `✕` at half opacity, which takes the blocked colour under the
    pointer.
  - when there are none, the line "None yet — write one below." in 11px
    `theme().dim`.
  - and a field, 30px tall, rounded 8px, with a 1px border in `theme().input`
    (in `theme().accent` while it has the focus), holding an input with the
    placeholder "Add a to-do…".

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
- **Quick to-dos belong to one space.** They are written under the space's own
  id, so two spaces have two lists, and the list follows the space the panel
  is showing. They are kept in the shared key `herdr.notes` — the store the
  notes dialog used, which is why what was written there before is still here.
- **A quick to-do is a seed, not an order.** It stays in Herdr; it is not
  written into `TODO.md`. The dialog says so when the to-do is opened: "The
  session refines this to-do and writes it into this repository's TODO.md."
- **The box ticks, the text opens, the `✕` drops.** Clicking the small box
  marks the to-do done (or not); clicking the text opens it in the dialog;
  clicking the `✕` removes it. Nothing is sent by any of them.
- **Typing a new to-do and pressing Enter adds it to the space's list.** The
  field takes the keyboard while it has the focus, and Esc gives it back.
- **Clicking an open to-do does not start anything.** It opens the
  `pungitore-confirm` dialog — a 520x260 one, over the window — with the
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
  the 268px `sidebar` column and the `work` column. Inside the work area's
  row sits the `panel` column (368px, min 280, max 900, hidden), and its
  `panel-body` is a **stack** of three blocks: `files` (Herdr's own), `changes`
  (Herdr's own) and `todos` — this mod. The stack shows one child at a time,
  and the tab bar's buttons choose which: "Files", "Changes" and "To-dos".
- The mod itself: `mods/pungitore-panel/main.js`, default-exporting a class
  extending `View`, with `mod.json` as
  `{"place": "none", "title": "To-dos", "size": 320}`. `"place": "none"`
  because the layout places it, not the mod; the size is the fallback for a
  layout that gives the block none.
- The `herdr` functions it calls: `spaces()` for the spaces and the one
  is shown, `focused()` and `panes()` for the folder the work is in, `agents()`
  for the agents in the space, `readTextFile()` to read the `TODO.md`,
  `shared("space.colors")` for the colour of the space, `shared("herdr.notes")`
  for the quick to-dos, `setShared()` to write them, `openOverlay()` to open
  the confirmation dialog, `theme()` for the colours, and `checking()` to stand
  down during `herdr-app check`.
- The gpui pieces it uses: `InputState.new({placeholder})` and `Input.new(state)`
  from `gpui-base` for the field, a focus handle with `track_focus` for the
  keyboard, and `cx.timer.every(5000, …)` for the poll.
- The dialog it opens is a mod of its own: `mods/pungitore-confirm`.
- Its art: the shipped `mods/workspace-chrome/check.svg` and `x.svg`, and the
  drawn marks: the `▶` and `·` markers are text, the status dot is a 7px
  rounded box, the tick box is an 11px rounded square with a 1px border.

**Watch out:**

- **The waiting count is not here.** The candidate lessons the Learning Loop is
  waiting for are counted by the dock and listed in its popup — a fact about
  this machine, not about one space. This panel is about the space in front.
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
- **The panel cannot edit `TODO.md`.** It can reorder nothing and mark
  nothing there: the repository's file is the only place that changes. A quick
  to-do's tick is the panel's own, in Herdr's store, and says nothing about
  the repository.
- **The quick to-dos share the old notes store.** The key `herdr.notes` still
  holds a `global` list, which the panel does not show: the two lines that
  used to be seeded there ("Easier integration with 'matt's skills'" and
  "Easier integration with 'wayfinder starmap'") are still in the store and
  invisible. The key was kept rather than replaced so that what was written
  there before is not lost.

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
- Typing a to-do in the field and pressing Enter puts it in the list under
  "Quick to-dos"; clicking its box ticks it and clicking the `✕` takes it
  away; switching to another space and back shows the same list.
- Clicking a quick to-do opens the dialog with the hint "The session refines
  this to-do and writes it into this repository's TODO.md." under the text.
