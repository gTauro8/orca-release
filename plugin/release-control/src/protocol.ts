// The board/panel <-> worker contract, declared once.
import type { ActionRequest, GraphSummary, ProjectInfo, Snapshot } from './model'
import type { Hit, StandupRow } from './work'

export {}

declare module 'orca' {
  interface PluginRequests {
    /** Latest snapshot; `refresh` re-reads every project first (a few seconds). */
    'rc.snapshot': { input: { refresh?: boolean }; output: Snapshot }
    /** Starts the skill for an action in the project's workspace, or opens something. */
    'rc.action': { input: ActionRequest; output: { ok: boolean; message: string } }
    /** Community-level summary of a project's graphify graph. */
    'rc.graph': { input: { path: string }; output: GraphSummary | null }
    /** Saved star positions (node id -> [x, y] as fractions of the canvas). */
    'rc.positions.get': { input: Record<string, never>; output: Record<string, [number, number]> }
    'rc.positions.set': { input: Record<string, [number, number]>; output: { ok: boolean } }
    /** Docs, API endpoints, scripts, env names, local URLs and recent commits of one project. */
    'rc.project': { input: { path: string }; output: ProjectInfo | null }
    /** The markdown text of one document of a project (must stay inside it). */
    'rc.doc': { input: { path: string; doc: string }; output: { text: string } | null }
    /** Opens a file of a project in an Orca editor tab, in the project's workspace. */
    'rc.openFile': { input: { path: string; file: string }; output: { ok: boolean; message: string } }
    /** My commits per project since a git date ("yesterday 00:00", "last monday"). */
    'rc.standup': { input: { since: string }; output: { rows: StandupRow[]; since: string } }
    /** Search across every project's name, docs, endpoints, scripts and env names. */
    'rc.search': { input: { q: string }; output: Hit[] }
    /** The last lines of a terminal the board started, or of a compose service, in one project. */
    'rc.logs': { input: { path: string; source: string }; output: { lines: string[]; error: string | null } }
    /** Opens the full-width board in an editor tab. */
    'rc.openBoard': { input: Record<string, never>; output: { ok: boolean; message: string } }
  }
  interface PluginPanelEvents {
    /** Posted after every refresh. */
    'rc.updated': Snapshot
    /** A push or deploy pressed on the board showed up in the data. */
    'rc.landed': { path: string; kind: 'push' | 'deploy' }
    /** Posted while a refresh runs. */
    'rc.loading': { loading: boolean }
  }
}
