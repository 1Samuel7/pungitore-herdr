# Pungitore Herdr

My custom [Herdr](https://herdr.dev) setup: the mods I wrote, the layout they
live in, the themes and the key bindings that go with them.

Herdr is the runtime your coding agents live on — terminals and coding agents
that keep running. This repository is the personal layer on top of it: what the
window looks like, what the sidebar says, and what the panels show.

## The mods

Ten mods, each with a recipe: a brief another agent could build the mod from,
and a screenshot of what it looks like. The recipes are the point — they say
what the mod shows, how it behaves, what it is built from, what trips you up
when you build it, and how you know it works.

| Mod | What it is | Recipe |
|---|---|---|
| [`herdr-spaces`](mods/herdr-spaces) | The spaces list in the sidebar: every space a solid block of its own colour, grouped by machine | [recipe](mods/herdr-spaces/RECIPE.md) |
| [`herdr-agents`](mods/herdr-agents) | The agents list below it, every row in the colour of the space it works in | [recipe](mods/herdr-agents/RECIPE.md) |
| [`herdr-dock`](mods/herdr-dock) | The strip at the foot of the sidebar: the theme, how much of the plan is left, the notes | [recipe](mods/herdr-dock/RECIPE.md) |
| [`herdr-tabs`](mods/herdr-tabs) | The tab bar, the active tab in the colour of its space | [recipe](mods/herdr-tabs/RECIPE.md) |
| [`herdr-pane`](mods/herdr-pane) | The header on every pane: the program, the folder, the agent's state | [recipe](mods/herdr-pane/RECIPE.md) |
| [`herdr-menu`](mods/herdr-menu) | The space context menu: rename, pin, icon and colour, notes, a new session | [recipe](mods/herdr-menu/RECIPE.md) |
| [`herdr-look`](mods/herdr-look) | The dialog that gives a space its icon and its colour | [recipe](mods/herdr-look/RECIPE.md) |
| [`herdr-notes`](mods/herdr-notes) | The notes and to-do dialog, global and per space | [recipe](mods/herdr-notes/RECIPE.md) |
| [`herdr-panel`](mods/herdr-panel) | The popup that picks the theme, and the one that shows the plan's usage | [recipe](mods/herdr-panel/RECIPE.md) |
| [`pungitore-panel`](mods/pungitore-panel) | The right-hand panel: each repository's open to-dos, mirrored from its `TODO.md` | [recipe](mods/pungitore-panel/RECIPE.md) |

Five of them — `herdr-agents`, `herdr-menu`, `herdr-pane`, `herdr-spaces` and
`herdr-tabs` — are modified copies of mods Herdr ships, and each says so in
its `mod.json` under `cloned_from`. See [NOTICE](NOTICE).

## The rest

- [`layouts/herdr.json`](layouts/herdr.json) — the layout: a 268px sidebar with
  the spaces and agents lists, the tab bar and panes in the middle, and the
  320px Pungitore panel on the right.
- [`themes/`](themes) — `tron-blue` and `tron-orange`, the two of Herdr's
  themes I keep coming back to.
- [`keys.json`](keys.json) — the key bindings.
- [`settings.json`](settings.json) — zoom, sounds, appearance.

## Installing it

Herdr reads everything from `~/.config/herdr-app`. To try this setup:

```sh
git clone https://github.com/1Samuel7/pungitore-herdr.git
cd pungitore-herdr
cp -r mods/* layouts/herdr.json themes/* ~/.config/herdr-app/
cp keys.json settings.json ~/.config/herdr-app/
```

Then switch to the layout with `layout.switch {name: "herdr"}`, or pick it in
the menu. Herdr applies layout and key changes live; mods reload themselves as
you edit them.

Herdr's own mods — `agents`, `tabs`, `pane`, `spaces`, `menu`, `files`,
`changes` and the rest — are not in this repository. They come with Herdr, and
copying them here would only ship a stale copy of someone else's work.

The mods here borrow a few files from Herdr's shipped ones: `herdr-dock`'s
`palette.svg` and `herdr-pane`'s and `herdr-tabs`' window art, and
`workspace-chrome`'s `check.svg` and `spinner.svg`. Those come with Herdr too.

## Sharing a mod

Each mod is a folder with `main.js`, `mod.json`, a `RECIPE.md` and a
`preview.png`, which is the shape Herdr's own sharing uses: a repository with
the topic `herdr-mod` shows up at [herdr.dev/mods](https://herdr.dev/mods)
within the hour.

## Licence

Apache License 2.0 — see [LICENSE](LICENSE). The mods derived from Herdr's
shipped ones stay under that licence; see [NOTICE](NOTICE) for which is which.
