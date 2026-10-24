export type SurfaceId = 'github' | 'diffshub' | 'npmx' | 'npm'
export type SurfaceFamily = 'git' | 'npm'

export type SurfaceKind = 'pull' | 'commit' | 'compare' | 'package' | 'version' | 'diff' | 'code' | 'user' | 'org' | 'search'

export type LineSide = 'new' | 'old'

/** View state that can travel between surfaces */
export interface ViewState {
  file?: string
  line?: number
  endLine?: number
  side?: LineSide
}

export interface RepoRef {
  owner: string
  repo: string
}

/** A parsed page on one of the four supported surfaces */
export interface Surface {
  id: SurfaceId
  family: SurfaceFamily
  kind: SurfaceKind
  url: URL
  repo?: RepoRef
  number?: string
  sha?: string
  range?: string
  pkg?: string
  version?: string
  from?: string
  to?: string
  file?: string
  user?: string
  org?: string
  query?: string
}

export interface Alternate {
  id: SurfaceId
  label: string
  url: string | null
  available: boolean
  note?: string
}
