import { expect, test } from 'claude-code/testing'

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

test('the pane lists worktrees and a file tree, on every surface', async ($, on) => {
  on('command.register', () => ({ value: { command: 'worktree-panel' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('clock.every', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('process.run', () => ({
    value: {
      exitCode: 0,
      stdout:
        'worktree /repo\nHEAD 1234567abcdef\nbranch refs/heads/main\n\n' +
        'worktree /repo-wt\nHEAD fedcba0987654321\nbranch refs/heads/feature\n',
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }))
  on('fs.list', () => ({
    value: [
      { name: 'a.ts', kind: 'file', size: 10, mtimeMs: 0, isLink: false },
      { name: 'src', kind: 'dir', size: 0, mtimeMs: 0, isLink: false },
    ],
  }))

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
  on('command.register', () => ({ value: { command: 'worktree-panel' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('clock.every', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/plain' }))
  on('process.run', () => ({
    value: {
      exitCode: 128,
      stdout: '',
      stderr: 'fatal: not a git repository (or any of the parent directories): .git',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }))
  on('fs.list', () => ({
    value: [{ name: 'notes.md', kind: 'file', size: 3, mtimeMs: 0, isLink: false }],
  }))

  await $.session.start({ cwd: '/plain', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /not a git repository/ }))?.text).toContain(
    'not a git repository',
  )
  expect((await ui.find({ key: 'node:/plain/notes.md' }))?.text).toBe('└── notes.md')
  await ui.unmount()
})

test('clicking a folder expands it as a tree; clicking again collapses', async ($, on) => {
  on('command.register', () => ({ value: { command: 'worktree-panel' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('clock.every', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('process.run', () => ({
    value: {
      exitCode: 128,
      stdout: '',
      stderr: 'fatal: not a git repository',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }))
  on('fs.list', (_, e) => ({
    value:
      e.path === '/repo/src'
        ? [{ name: 'inner.ts', kind: 'file', size: 1, mtimeMs: 0, isLink: false }]
        : [
            { name: 'a.ts', kind: 'file', size: 10, mtimeMs: 0, isLink: false },
            { name: 'src', kind: 'dir', size: 0, mtimeMs: 0, isLink: false },
          ],
  }))

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
  on('command.register', () => ({ value: { command: 'worktree-panel' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('clock.every', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('process.run', (_, e) => {
    if (e.argv[0] === 'git') {
      return {
        value: {
          exitCode: 0,
          stdout:
            'worktree /repo\nHEAD 1234567abcdef\nbranch refs/heads/main\n\n' +
            'worktree /repo-wt\nHEAD fedcba0987654321\nbranch refs/heads/feature\n',
          stderr: '',
          isStdoutTruncated: false,
          isStderrTruncated: false,
        },
      }
    }
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('fs.list', (_, e) => ({
    value:
      e.path === '/repo-wt'
        ? [{ name: 'wt.txt', kind: 'file', size: 2, mtimeMs: 0, isLink: false }]
        : [{ name: 'a.ts', kind: 'file', size: 10, mtimeMs: 0, isLink: false }],
  }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 10, mtimeMs: 0, isLink: false } }))
  on('fs.read', () => ({ value: 'hello\nworld' }))

  await $.session.start({ cwd: '/repo', surface: 'desktop', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })

    await ui.press({ key: 'node:/repo/a.ts' })
    expect((await ui.find({ type: 'Text', text: /^\/repo\/a\.ts$/ }))?.text).toBe('/repo/a.ts')
    expect((await ui.find({ type: 'Text', text: /^hello$/ }))?.text).toBe('hello')
    await ui.press({ key: 'back' })
    expect(await ui.find({ key: 'node:/repo/a.ts' })).toBeDefined()

    await ui.press({ key: 'wt:/repo-wt' })
    expect((await ui.find({ key: 'node:/repo-wt/wt.txt' }))?.text).toBe('└── wt.txt')
    await ui.press({ key: 'cwd' })
    await ui.unmount()
  }
})

test('clicking a binary file says so instead of drawing nothing', async ($, on) => {
  on('command.register', () => ({ value: { command: 'worktree-panel' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('clock.every', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/plain' }))
  on('process.run', () => ({
    value: {
      exitCode: 128,
      stdout: '',
      stderr: 'fatal: not a git repository',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }))
  on('fs.list', () => ({
    value: [{ name: '.DS_Store', kind: 'file', size: 6148, mtimeMs: 0, isLink: false }],
  }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 6148, mtimeMs: 0, isLink: false } }))
  on('fs.read', () => ({ value: '\x00\x00\x00\x01Bud1\x00' }))

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
  on('command.register', () => ({ value: { command: 'worktree-panel' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('clock.every', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/plain' }))
  on('process.run', (_, e) => {
    if (e.argv[0] === 'wc') {
      return { value: { exitCode: 0, stdout: '     120 /plain/big.log', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
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
  on('fs.list', () => ({
    value: [{ name: 'big.log', kind: 'file', size: 5000000, mtimeMs: 0, isLink: false }],
  }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 5000000, mtimeMs: 0, isLink: false } }))

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
