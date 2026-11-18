# Git workflow

The policy that governs every commit, push, branch, pull request and release
in this repository is a global rule, not a habit of the agent:

- `~/.claude/rules/git-workflow.md` — the rules themselves.

Read it before touching git here. It is short, and it is written for a person
who does not work with git every day: what a commit is, what a branch is, what
a pull request is, and when each of them may happen without asking.

## What is specific to this repository

- **Never commit on `main`.** The agent opens a branch first, always, even for
  a one-line fix.
- **The two `pungitore-` mods live in two repositories.** Their source of
  truth is the plugin marketplace repository
  (<https://github.com/1Samuel7/pungitore>), and the copies here are what this
  repository installs. A change to one of them has to be made in both, in the
  same commit, or the two drift apart. The rule that kills the drift is the
  open to-do in the plugin repository: combine the two repositories so the
  halves of the same project are versioned together.
- **A change to a mod has to be checked before it is committed.**
  `herdr-app check mods/<name>` has to pass, and the recipe of the mod has to
  describe what the mod now does. The recipe is the contract: another agent
  builds the mod from it.

## The doors, here

- **main** — the pull request is the door. The agent opens it with the diff,
  shows it, and merges only after you say yes. Then it deletes the branch.
- **publish** — a version going out: the plugin version in the marketplace
  repository, or a tag here. The agent prepares everything and asks before the
  version is published.
- **delete** — branches, tags, files, history. The agent asks; the one
  exception is a branch whose work is already merged and pushed.

## Naming

- A branch says what it is for: `feat/todo-panel`, `fix/dock-lessons-row`.
- A commit says what changed and why, in one line and a paragraph if the
  reason is not obvious.
- A pull request says what it changes and how it was verified.
