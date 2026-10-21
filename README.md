# worktree-panel

A Claude Code pane that keeps git worktrees and your files beside the chat.

It opens a pane on session start (or via `/worktree-panel`) with two sections:

- **Worktrees** - every `git worktree`, its branch and path, the one you are in
  marked with `*`; outside a git repository it says so
- **Files** - the working directory's entries, directories first

Everything is clickable: a file previews its content in the pane (with Prev /
Next paging for large files, `more`-style), a directory browses into it, a
worktree points the Files section at that worktree's root. The panel refreshes
every two seconds, plus a Refresh button. Binary and empty files are named
instead of drawn.

A tree taller than the pane scrolls: mouse wheel over the pane, or the arrow
keys once the pane has focus.

## Install

At the prompt of a terminal session:

```
/plugin install worktree-panel --marketplace Ethanlam123/worktree-panel
```

From a shell:

```
claude plugin install worktree-panel --marketplace Ethanlam123/worktree-panel
```

## Development

Run it from a checkout with `claude --plugin-dir <this folder>`. Tests:
`claude plugin test <this folder>`; types: `tsc -p <this folder>` (the engine
lays `.claude-plugin/types/` when it loads the plugin).

## License

MIT
