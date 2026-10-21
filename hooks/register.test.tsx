import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const PANE = {
  plugin: 'worktree-panel',
  component: 'Pane',
  requestId: 'worktree-panel',
  props: {
    title: 'Worktrees & files',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

// the engine answers every test shares, plus whatever the test adds on top
const baseMocks = (on: On, cwd: string, add: (on: On) => void = () => {}) => {
  on('command.register', () => ({ value: { command: 'worktree-panel' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('clock.every', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: cwd }))
  add(on)
}

const GIT_OK = () => ({
  value: {
    exitCode: 0,
    stdout:
      'worktree /repo\nHEAD 1234567abcdef\nbranch refs/heads/main\n\n' +
      'worktree /repo-wt\nHEAD fedcba0987654321\nbranch refs/heads/feature\n',
    stderr: '',
    isStdoutTruncated: false,
    isStderrTruncated: false,
  },
})

const GIT_FAIL = () => ({
  value: {
    exitCode: 128,
    stdout: '',
    stderr: 'fatal: not a git repository (or any of the parent directories): .git',
    isStdoutTruncated: false,
    isStderrTruncated: false,
  },
})

test('the pane lists worktrees and a file tree, on every surface', async ($, on) => {
  baseMocks(on, '/repo', o => {
    o('process.run', GIT_OK)
    o('fs.list', () => ({
      value: [
        { name: 'a.ts', kind: 'file', size: 10, mtimeMs: 0, isLink: false },
        { name: 'src', kind: 'dir', size: 0, mtimeMs: 0, isLink: false },
      ],
    }))
  })

  await $.session.start({ cwd: '/repo', surface: 'desktop', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })

    const current = await ui.find({ key: 'wt:/repo' })
    expect(current?.text).toContain('* main')
    expect(current?.text).toContain('/repo')
    const other = await ui.find({ key: 'wt:/repo-wt' })
    expect(other?.text).toContain('feature')
    expect((await ui.find({ key: 'node:/repo/src' }))?.text).toBe('├── src/')
    expect((await ui.find({ key: 'node:/repo/a.ts' }))?.text).toBe('└── a.ts')
    await ui.unmount()
  }
})

test('outside a git repository the pane says so and still lists files', async ($, on) => {
  baseMocks(on, '/plain', o => {
    o('process.run', GIT_FAIL)
    o('fs.list', () => ({
      value: [{ name: 'notes.md', kind: 'file', size: 3, mtimeMs: 0, isLink: false }],
    }))
  })

  await $.session.start({ cwd: '/plain', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /not a git repository/ }))?.text).toContain(
    'not a git repository',
  )
  expect((await ui.find({ key: 'node:/plain/notes.md' }))?.text).toBe('└── notes.md')
  await ui.unmount()
})

test('clicking a folder expands it as a tree; clicking again collapses', async ($, on) => {
  baseMocks(on, '/repo', o => {
    o('process.run', GIT_FAIL)
    o('fs.list', (_, e) => ({
      value:
        e.path === '/repo/src'
          ? [{ name: 'inner.ts', kind: 'file', size: 1, mtimeMs: 0, isLink: false }]
          : [
              { name: 'a.ts', kind: 'file', size: 10, mtimeMs: 0, isLink: false },
              { name: 'src', kind: 'dir', size: 0, mtimeMs: 0, isLink: false },
            ],
    }))
  })

  await $.session.start({ cwd: '/repo', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ key: 'node:/repo/src/inner.ts' })).toBeUndefined()

  await ui.press({ key: 'node:/repo/src' })
  expect((await ui.find({ key: 'node:/repo/src/inner.ts' }))?.text).toBe('│   └── inner.ts')

  await ui.press({ key: 'node:/repo/src' })
  expect(await ui.find({ key: 'node:/repo/src/inner.ts' })).toBeUndefined()
  await ui.unmount()
})

test('clicking a file previews it; clicking a worktree re-roots the tree', async ($, on) => {
  baseMocks(on, '/repo', o => {
    o('process.run', GIT_OK)
    o('fs.list', (_, e) => ({
      value:
        e.path === '/repo-wt'
          ? [{ name: 'wt.txt', kind: 'file', size: 2, mtimeMs: 0, isLink: false }]
          : [{ name: 'a.ts', kind: 'file', size: 10, mtimeMs: 0, isLink: false }],
    }))
    o('fs.stat', () => ({ value: { kind: 'file', size: 10, mtimeMs: 0, isLink: false } }))
    o('fs.read', () => ({ value: 'hello\nworld' }))
  })

  await $.session.start({ cwd: '/repo', surface: 'desktop', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })

    await ui.press({ key: 'node:/repo/a.ts' })
    expect((await ui.find({ type: 'Text', text: /^\/repo\/a\.ts$/ }))?.text).toBe('/repo/a.ts')
    expect((await ui.find({ type: 'Text', text: /^hello$/ }))?.text).toBe('hello')
    // a short file draws whole: no pager row
    expect(await ui.find({ key: 'next' })).toBeUndefined()
    await ui.press({ key: 'back' })
    expect(await ui.find({ key: 'node:/repo/a.ts' })).toBeDefined()

    await ui.press({ key: 'wt:/repo-wt' })
    expect((await ui.find({ key: 'node:/repo-wt/wt.txt' }))?.text).toBe('└── wt.txt')
    await ui.press({ key: 'cwd' })
    await ui.unmount()
  }
})

test('clicking a binary file says so instead of drawing nothing', async ($, on) => {
  baseMocks(on, '/plain', o => {
    o('process.run', GIT_FAIL)
    o('fs.list', () => ({
      value: [{ name: '.DS_Store', kind: 'file', size: 6148, mtimeMs: 0, isLink: false }],
    }))
    o('fs.stat', () => ({ value: { kind: 'file', size: 6148, mtimeMs: 0, isLink: false } }))
    o('fs.read', () => ({ value: '\x00\x00\x00\x01Bud1\x00' }))
  })

  await $.session.start({ cwd: '/plain', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'node:/plain/.DS_Store' })
  expect((await ui.find({ type: 'Text', text: /binary file/ }))?.text).toBe(
    '(binary file, nothing to preview)',
  )
  expect(await ui.find({ key: 'back' })).toBeDefined()
  await ui.unmount()
})

test('a file over the read cap pages through, more-style', async ($, on) => {
  baseMocks(on, '/plain', o => {
    o('process.run', (_, e) => {
      if (e.argv[0] === 'wc') {
        return {
          value: {
            exitCode: 0,
            stdout: '     120 /plain/big.log',
            stderr: '',
            isStdoutTruncated: false,
            isStderrTruncated: false,
          },
        }
      }
      return {
        value: {
          exitCode: 0,
          stdout: e.argv[2] === '1,20p' ? 'alpha\nbeta' : 'gamma\ndelta',
          stderr: '',
          isStdoutTruncated: false,
          isStderrTruncated: false,
        },
      }
    })
    o('fs.list', () => ({
      value: [{ name: 'big.log', kind: 'file', size: 5000000, mtimeMs: 0, isLink: false }],
    }))
    o('fs.stat', () => ({ value: { kind: 'file', size: 5000000, mtimeMs: 0, isLink: false } }))
  })

  await $.session.start({ cwd: '/plain', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'node:/plain/big.log' })
  expect((await ui.find({ type: 'Text', text: /^alpha$/ }))?.text).toBe('alpha')
  expect((await ui.find({ type: 'Text', text: /1\/6/ }))?.text).toContain('1/6')
  expect(await ui.find({ key: 'prev' })).toBeUndefined()

  await ui.press({ key: 'next' })
  expect((await ui.find({ type: 'Text', text: /^gamma$/ }))?.text).toBe('gamma')
  expect((await ui.find({ type: 'Text', text: /2\/6/ }))?.text).toContain('2/6')
  expect(await ui.find({ key: 'prev' })).toBeDefined()

  await ui.press({ key: 'prev' })
  expect((await ui.find({ type: 'Text', text: /^alpha$/ }))?.text).toBe('alpha')
  await ui.unmount()
})

test('a page beyond a shrunk file is clamped to the last real page', async ($, on) => {
  let wcCalls = 0
  baseMocks(on, '/plain', o => {
    o('process.run', (_, e) => {
      if (e.argv[0] === 'wc') {
        wcCalls += 1
        // the file shrinks after the fourth look: 120 lines down to 40
        return {
          value: {
            exitCode: 0,
            stdout: wcCalls <= 4 ? '     120 /plain/big.log' : '      40 /plain/big.log',
            stderr: '',
            isStdoutTruncated: false,
            isStderrTruncated: false,
          },
        }
      }
      return {
        value: {
          exitCode: 0,
          stdout: e.argv[2] === '1,20p' ? 'alpha\nbeta' : 'gamma\ndelta',
          stderr: '',
          isStdoutTruncated: false,
          isStderrTruncated: false,
        },
      }
    })
    o('fs.list', () => ({
      value: [{ name: 'big.log', kind: 'file', size: 5000000, mtimeMs: 0, isLink: false }],
    }))
    o('fs.stat', () => ({ value: { kind: 'file', size: 5000000, mtimeMs: 0, isLink: false } }))
  })

  await $.session.start({ cwd: '/plain', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'node:/plain/big.log' })
  await ui.press({ key: 'next' })
  await ui.press({ key: 'next' })
  await ui.press({ key: 'next' })
  await ui.press({ key: 'next' })

  // asking for page 5 of a now-2-page file lands on page 2, not an empty page
  expect((await ui.find({ type: 'Text', text: /2\/2/ }))?.text).toContain('2/2')
  expect((await ui.find({ type: 'Text', text: /^gamma$/ }))?.text).toBe('gamma')
  expect(await ui.find({ key: 'next' })).toBeUndefined()
  await ui.unmount()
})

test('without a line count, a full page still offers Next', async ($, on) => {
  const fullPage = 'l01\nl02\nl03\nl04\nl05\nl06\nl07\nl08\nl09\nl10\nl11\nl12\nl13\nl14\nl15\nl16\nl17\nl18\nl19\nl20\n'
  baseMocks(on, '/plain', o => {
    o('process.run', (_, e) =>
      e.argv[0] === 'wc'
        ? {
            value: {
              exitCode: 1,
              stdout: '',
              stderr: 'wc: not found',
              isStdoutTruncated: false,
              isStderrTruncated: false,
            },
          }
        : {
            value: {
              exitCode: 0,
              stdout: fullPage,
              stderr: '',
              isStdoutTruncated: false,
              isStderrTruncated: false,
            },
          },
    )
    o('fs.list', () => ({
      value: [{ name: 'big.log', kind: 'file', size: 5000000, mtimeMs: 0, isLink: false }],
    }))
    o('fs.stat', () => ({ value: { kind: 'file', size: 5000000, mtimeMs: 0, isLink: false } }))
  })

  await $.session.start({ cwd: '/plain', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'node:/plain/big.log' })
  expect((await ui.find({ type: 'Text', text: /page 1/ }))?.text).toContain('page 1')
  expect(await ui.find({ key: 'next' })).toBeDefined()

  await ui.press({ key: 'next' })
  expect((await ui.find({ type: 'Text', text: /page 2/ }))?.text).toContain('page 2')
  await ui.unmount()
})

test('every tree row is drawn; the pane scrolls instead of truncating', async ($, on) => {
  baseMocks(on, '/plain', o => {
    o('process.run', GIT_FAIL)
    o('fs.list', () => ({
      value: Array.from({ length: 12 }, (_, i) => ({
        name: `f${String(i + 1).padStart(2, '0')}.txt`,
        kind: 'file',
        size: 1,
        mtimeMs: 0,
        isLink: false,
      })),
    }))
  })

  await $.session.start({ cwd: '/plain', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  // taller than the room the pane had: the last row still draws, no "more" note
  expect((await ui.find({ key: 'node:/plain/f12.txt' }))?.text).toBe('└── f12.txt')
  expect(await ui.find({ type: 'Text', text: /more/ })).toBeUndefined()
  await ui.unmount()
})

test('a readable file too tall to draw whole pages in memory', async ($, on) => {
  baseMocks(on, '/plain', o => {
    // no wc or sed: any paging must come from the text already read
    o('process.run', GIT_FAIL)
    o('fs.list', () => ({
      value: [{ name: 'tall.txt', kind: 'file', size: 6000, mtimeMs: 0, isLink: false }],
    }))
    o('fs.stat', () => ({ value: { kind: 'file', size: 6000, mtimeMs: 0, isLink: false } }))
    o('fs.read', () => ({
      value: Array.from({ length: 600 }, (_, i) => `l${String(i + 1).padStart(3, '0')}`).join('\n'),
    }))
  })

  await $.session.start({ cwd: '/plain', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'node:/plain/tall.txt' })
  expect((await ui.find({ type: 'Text', text: /^l001$/ }))?.text).toBe('l001')
  expect((await ui.find({ type: 'Text', text: /1\/30/ }))?.text).toContain('1/30')

  await ui.press({ key: 'next' })
  expect((await ui.find({ type: 'Text', text: /^l021$/ }))?.text).toBe('l021')
  expect((await ui.find({ type: 'Text', text: /2\/30/ }))?.text).toContain('2/30')
  await ui.unmount()
})

test('fullscreen keeps the tree above the preview', async ($, on) => {
  baseMocks(on, '/plain', o => {
    o('process.run', GIT_FAIL)
    o('fs.list', () => ({
      value: [
        { name: 'src', kind: 'dir', size: 0, mtimeMs: 0, isLink: false },
        { name: 'a.ts', kind: 'file', size: 10, mtimeMs: 0, isLink: false },
      ],
    }))
    o('fs.stat', () => ({ value: { kind: 'file', size: 10, mtimeMs: 0, isLink: false } }))
    o('fs.read', () => ({ value: 'hello\nworld' }))
  })

  await $.session.start({ cwd: '/plain', surface: 'desktop', isInteractive: true })

  const FULL = {
    ...PANE,
    surface: 'terminal',
    viewport: { columns: 200, rows: 50, isFullscreen: true },
  } as const
  const ui = await $.ui.mount(FULL)
  await ui.press({ key: 'node:/plain/a.ts' })

  // the tree stays above
  expect((await ui.find({ key: 'node:/plain/src' }))?.text).toBe('├── src/')
  // the preview sits below
  expect((await ui.find({ type: 'Text', text: /^hello$/ }))?.text).toBe('hello')
  expect((await ui.find({ key: 'back' }))?.text).toBe('Back')

  // Back returns to the tree-only layout
  await ui.press({ key: 'back' })
  expect(await ui.find({ key: 'node:/plain/src' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^hello$/ })).toBeUndefined()
  await ui.unmount()
})
