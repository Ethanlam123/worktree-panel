import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { FileEntry, Preview, Worktree } from '../types'

const PANE = 'worktree-panel'
const TITLE = 'Worktrees & files'
const REFRESH_MS = 2000

const worktrees = atom({ plugin: 'worktree-panel', key: 'worktrees' } as const, [] as Worktree[])
const gitError = atom({ plugin: 'worktree-panel', key: 'gitError' } as const, '')
// '' means the session's working directory
const treeRoot = atom({ plugin: 'worktree-panel', key: 'treeRoot' } as const, '')
// dir path -> its sorted entries
const tree = atom({ plugin: 'worktree-panel', key: 'tree' } as const, {} as Record<string, FileEntry[]>)
const expanded = atom({ plugin: 'worktree-panel', key: 'expanded' } as const, [] as string[])
const preview = atom({ plugin: 'worktree-panel', key: 'preview' } as const, null as Preview | null)

// cwd is the worktree itself, or a folder under it
const isInside = (cwd: string, path: string): boolean =>
  cwd === path || cwd.startsWith(path + '/')

const parseWorktrees = (porcelain: string, cwd: string): Worktree[] =>
  porcelain
    .trim()
    .split('\n\n')
    .map(block => {
      const field = (prefix: string): string =>
        block.split('\n').find(line => line.startsWith(prefix))?.slice(prefix.length) ?? ''
      const path = field('worktree ')
      return {
        path,
        branch: field('branch ').replace('refs/heads/', ''),
        head: field('HEAD ').slice(0, 7),
        isCurrent: isInside(cwd, path),
      }
    })
    .filter(w => w.path !== '')

const at = ($: EngineInterface): Promise<string> =>
  read($, treeRoot).then(chosen => (chosen === '' ? $.session.cwd() : chosen))

// directories first, then files, each alphabetical
const sortEntries = (entries: readonly FileEntry[]): FileEntry[] =>
  [...entries].sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name))

const listDir = async ($: EngineInterface, path: string): Promise<FileEntry[]> => {
  const entries = await $.fs.list(path).catch(() => [])
  return sortEntries(entries.map(e => ({ name: e.name, kind: e.kind })))
}

const refreshWorktrees = async ($: EngineInterface) => {
  const cwd = await $.session.cwd()
  const git = await $.process
    .run(['git', 'worktree', 'list', '--porcelain'], { cwd })
    .catch(() => undefined)
  if (!git || git.exitCode !== 0) {
    await update($, gitError, () => (git?.stderr ?? 'not a git repository').trim())
    await update($, worktrees, () => [])
  } else {
    await update($, gitError, () => '')
    await update($, worktrees, () => parseWorktrees(git.stdout, cwd))
  }
}

// re-list the root and every expanded folder
const refreshTree = async ($: EngineInterface) => {
  const root = await at($)
  const openDirs = [root, ...(await read($, expanded))]
  const next: Record<string, FileEntry[]> = {}
  for (const path of openDirs) {
    next[path] = await listDir($, path)
  }
  await update($, tree, () => next)
}

const refresh = async ($: EngineInterface) => {
  await refreshWorktrees($)
  await refreshTree($)
}

// a click on a worktree or Session dir: re-root the tree there
const reroot = async ($: EngineInterface, path: string) => {
  const cwd = await $.session.cwd()
  await update($, preview, () => null)
  await update($, expanded, () => [])
  await update($, treeRoot, () => (path === cwd ? '' : path))
  await refreshTree($)
}

// a click on a folder: expand or collapse it in the tree
const toggle = async ($: EngineInterface, path: string) => {
  const isOpen = (await read($, expanded)).includes(path)
  await update($, expanded, list => (isOpen ? list.filter(p => p !== path) : [...list, path]))
  await refreshTree($)
}

// a click on a file: show its content in the pane
const READ_CAP = 4 * 1024 * 1024 // $.fs.read rejects above this
// small enough that content plus the pager row fit a pane's body
const PAGE_LINES = 20

const countLines = async ($: EngineInterface, path: string): Promise<number> => {
  const wc = await $.process.run(['wc', '-l', path]).catch(() => undefined)
  return wc && wc.exitCode === 0 ? parseInt(wc.stdout.trim().split(/\s+/)[0] ?? '0', 10) || 0 : 0
}

const pageLines = async ($: EngineInterface, path: string, page: number): Promise<string> => {
  const first = (page - 1) * PAGE_LINES + 1
  const sed = await $.process
    .run(['sed', '-n', `${first},${first + PAGE_LINES - 1}p`, path])
    .catch(() => undefined)
  return sed && sed.exitCode === 0 ? sed.stdout : ''
}

const setPreview = async ($: EngineInterface, value: Preview) =>
  update($, preview, () => value)

// a whole preview taller than this pages in memory: the pane redraws every
// refresh, and thousands of rows at once would stall it
const PREVIEW_LINES_CAP = 500

const openPreview = async ($: EngineInterface, path: string, page = 1) => {
  const stat = await $.fs.stat(path).catch(() => undefined)
  if (!stat || stat.kind !== 'file') {
    await setPreview($, {
      path, content: 'cannot preview (missing, or a directory)', isError: true, page: 1, totalLines: 0, paged: false,
    })
    return
  }
  if (stat.size > READ_CAP) {
    // over the read cap: page through the file on the host, more-style
    const totalLines = await countLines($, path)
    // the file may have shrunk since this page was asked for: stay in range
    // (only when the count is known; without it every page may be the last)
    const pages = Math.max(1, Math.ceil(totalLines / PAGE_LINES))
    const at = totalLines > 0 ? Math.min(page, pages) : page
    const content = await pageLines($, path, at)
    // binary bytes render as nothing in the pane: name them instead
    const isBinary = /[\x00-\x08\x0e-\x1f\x7f]/.test(content)
    await setPreview($, {
      path,
      content: isBinary ? '(binary file, nothing to preview)' : content,
      isError: isBinary,
      page: at,
      totalLines: isBinary ? 0 : totalLines,
      paged: !isBinary,
    })
    return
  }
  const text = await $.fs.read(path).catch(() => undefined)
  const isBinary = text !== undefined && /[\x00-\x08\x0e-\x1f\x7f]/.test(text)
  if (text === undefined || isBinary || text === '') {
    const content =
      text === undefined
        ? 'cannot preview (unreadable)'
        : isBinary
          ? '(binary file, nothing to preview)'
          : '(empty file)'
    await setPreview($, { path, content, isError: true, page: 1, totalLines: 0, paged: false })
    return
  }
  // whole file in hand: page in memory when too tall, else draw it all and
  // let the pane's scroller show the rest
  const lines = text.split('\n')
  if (lines.length > PREVIEW_LINES_CAP) {
    const totalLines = lines.length
    const at = Math.min(page, Math.max(1, Math.ceil(totalLines / PAGE_LINES)))
    await setPreview($, {
      path,
      content: lines.slice((at - 1) * PAGE_LINES, at * PAGE_LINES).join('\n'),
      isError: false,
      page: at,
      totalLines,
      paged: true,
    })
    return
  }
  await setPreview($, { path, content: text, isError: false, page: 1, totalLines: 0, paged: false })
}

// one row of the tree, ready to draw
type Row = { path: string; label: string; isDir: boolean }

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'worktree-panel',
      description: 'Show git worktrees and files in a pane',
    })
    void $.ui.open({ id: PANE, title: TITLE })
    // a reload re-runs this: drop a stale preview rather than redraw it
    await update($, preview, () => null)
    await refresh($)
    $.clock.every(REFRESH_MS, () => {
      void refresh($)
    })

    return next(e)
  })

  on('command.run', { command: 'worktree-panel' }, async $ => {
    await refresh($)
    await $.ui.open({ id: PANE, title: TITLE })

    return { text: 'Worktree panel opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const trees = await read($, worktrees)
    const error = await read($, gitError)
    const shown = await read($, preview)
    const chosen = await read($, treeRoot)
    const cwd = await $.session.cwd()
    const root = chosen === '' ? cwd : chosen
    // the pane's scroll window shows what fits: draw every row, the engine scrolls
    // a wrapped line is two rows: cut to the pane's width so a page keeps its height
    const width = Math.max(10, (e.props.bodyColumns ?? e.viewport?.columns ?? 80) - 2)
    const fit = (line: string): string =>
      line.length > width ? line.slice(0, width - 1) + '~' : line === '' ? ' ' : line

    const treeMap = await read($, tree)
    const open = new Set(await read($, expanded))
    const rows: Row[] = []
    const walk = (dirPath: string, ancestry: readonly boolean[]): void => {
      const entries = treeMap[dirPath] ?? []
      entries.forEach((entry, i) => {
        const isLast = i === entries.length - 1
        const childPath = dirPath + '/' + entry.name
        const stem = ancestry.map(wasLast => (wasLast ? '    ' : '│   ')).join('')
        rows.push({
          path: childPath,
          label: stem + (isLast ? '└── ' : '├── ') + entry.name + (entry.kind === 'dir' ? '/' : ''),
          isDir: entry.kind === 'dir',
        })
        if (entry.kind === 'dir' && open.has(childPath)) {
          walk(childPath, [...ancestry, isLast])
        }
      })
    }
    walk(root, [])

    const nodeRow = (r: Row) => (
      <Button
        plain
        key={'node:' + r.path}
        dimColor={!r.isDir}
        onPress={() => (r.isDir ? void toggle($, r.path) : void openPreview($, r.path))}
      >
        {fit(r.label)}
      </Button>
    )

    const backRow = (
      <Button key="back" onPress={() => void update($, preview, () => null)}>
        Back
      </Button>
    )

    const previewBody = () => {
      if (!shown) return null
      return (
        <Box flexDirection="column">
          {shown.isError ? (
            <Text dimColor>{shown.content}</Text>
          ) : (
            shown.content.split('\n').map(line => <Text dimColor>{fit(line)}</Text>)
          )}
        </Box>
      )
    }

    const pagerRow = () => {
      // only a paged preview (one window of a longer file) has pages to turn
      if (!shown || !shown.paged) return null
      const pages = Math.max(1, Math.ceil(shown.totalLines / PAGE_LINES))
      // a full page means more may follow even when the line count is unknown
      const isFullPage = shown.content.split('\n').length > PAGE_LINES
      if (shown.totalLines <= PAGE_LINES && !isFullPage) return null
      const known = shown.totalLines > PAGE_LINES
      return (
        <Box>
          {shown.page > 1 && (
            <Button key="prev" onPress={() => void openPreview($, shown.path, shown.page - 1)}>
              Prev
            </Button>
          )}
          <Text dimColor>
            {' '}
            {known ? `${shown.page}/${pages}` : `page ${shown.page}`}{' '}
          </Text>
          {(shown.page < pages || (!known && isFullPage)) && (
            <Button key="next" onPress={() => void openPreview($, shown.path, shown.page + 1)}>
              Next
            </Button>
          )}
        </Box>
      )
    }

    // fullscreen with a preview: tree on top, preview below
    if (shown !== null && e.viewport?.isFullscreen === true) {
      const body = Math.max(12, (e.viewport?.rows ?? 24) - 8)
      const previewRoom = Math.max(3, Math.floor(body / 2) - 3)
      const treeRoom = Math.max(3, body - previewRoom - 5)
      return (
        <Box flexDirection="column">
          <Box justifyContent="space-between">
            <Text bold>Files</Text>
            {backRow}
          </Box>
          <Text dimColor>{root}</Text>
          {rows.slice(0, treeRoom).map(nodeRow)}
          {rows.length > treeRoom && <Text dimColor>... {rows.length - treeRoom} more</Text>}
          <Text dimColor>{'─'.repeat(width)}</Text>
          <Text bold>{fit(shown.path)}</Text>
          {previewBody()}
          {pagerRow()}
        </Box>
      )
    }

    // any size without the room: the preview takes the pane
    if (shown !== null) {
      return (
        <Box flexDirection="column">
          <Box justifyContent="space-between">
            <Text bold>{shown.path}</Text>
            {backRow}
          </Box>
          {previewBody()}
          {pagerRow()}
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        <Box justifyContent="space-between">
          <Text bold>Worktrees</Text>
          <Button key="refresh" onPress={() => void refresh($)}>
            Refresh
          </Button>
        </Box>
        {error !== '' && <Text dimColor>{error}</Text>}
        {error === '' &&
          trees.map(w => (
            <Button key={'wt:' + w.path} onPress={() => void reroot($, w.path)}>
              {w.isCurrent ? '* ' : '  '}
              {w.branch || w.head} <Text dimColor>{w.path}</Text>
            </Button>
          ))}
        <Box flexDirection="column" marginTop={1}>
          <Box justifyContent="space-between">
            <Text bold>Files</Text>
            {chosen !== '' && (
              <Button key="cwd" onPress={() => void reroot($, cwd)}>
                Session dir
              </Button>
            )}
          </Box>
          <Text dimColor>{root}</Text>
          {rows.map(nodeRow)}
        </Box>
      </Box>
    )
  })
}
