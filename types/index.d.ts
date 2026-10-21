export type Worktree = { path: string; branch: string; head: string; isCurrent: boolean }
export type FileEntry = { name: string; kind: 'file' | 'dir' | 'other' }
export type Preview = {
  path: string
  content: string
  isError: boolean
  page: number
  totalLines: number
}

declare module 'claude-code' {
  interface PluginState {
    'worktree-panel': {
      worktrees: Worktree[]
      gitError: string
      treeRoot: string
      tree: Record<string, FileEntry[]>
      expanded: string[]
      preview: Preview | null
    }
  }
}
