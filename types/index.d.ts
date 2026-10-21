export type Worktree = { path: string; branch: string; head: string; isCurrent: boolean }
export type FileEntry = { name: string; kind: 'file' | 'dir' | 'other' }
export type Preview = {
  path: string
  content: string
  isError: boolean
  page: number
  totalLines: number
  // true when content is one page of a longer file, so the pager row applies
  paged: boolean
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
      treeOffset: number
      previewOffset: number
    }
  }
}
