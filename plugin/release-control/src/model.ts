// Pure data rules shared by the worker, the board and the sidebar panel: no Orca, no Node, no DOM.
import type { AgentRow, ProjectWork } from './work'

export interface DirtyWorktree {
  path: string
  branch: string
  dirty: number
}

/** One project as `dashboard.py --json` reports it, plus the Orca workspace that holds it. */
export interface Project {
  name: string
  path: string
  missing: boolean
  branch?: string
  dirty?: number
  ahead?: number
  /** Commits on the upstream not yet in the branch, as of the last fetch. */
  behind?: number
  no_upstream?: boolean
  local_only?: number
  worktrees?: number
  dirty_worktrees?: DirtyWorktree[]
  recipe?: string
  tag?: string | null
  tag_date?: string | null
  since?: number | null
  last_commit?: string | null
  targets?: string[]
  recipe_file?: string | null
  stack?: string[]
  compose?: boolean
  has_dev?: boolean
  remote?: string | null
  graphify?: boolean
  weeks?: number[]
  workspaceId?: string | null
  domain?: string | null
  domain_label?: string | null
  links?: { type: LinkType; target: string }[]
  /** Set by the board from the snapshot: an agent waits for the user here / something of it is running. */
  live?: { waiting: boolean; running: boolean }
  /** Direct dependencies shared with other projects: name -> version. */
  deps?: Record<string, string>
}

export type LinkType = 'uses-api' | 'follows' | 'replaces' | 'related'

export interface Snapshot {
  generated: string
  /** Epoch ms when the worker finished reading. */
  at: number
  root: string | null
  report: { name: string | null; items: string[] }
  projects: Project[]
  /** Workspace holding the data folder (recipes, board file), when Orca has one. */
  rootWorkspaceId: string | null
  error?: string
  /** Dependencies used by 2+ projects: name -> project path -> version. */
  shared_deps?: Record<string, Record<string, string>>
  /** Agents Orca runs in these projects (agent.status.changed), newest first. */
  agents?: AgentRow[]
  /** Per project path: PRs and CI (refreshed on fetch), what runs, what can be cleaned up. */
  work?: Record<string, ProjectWork>
}

export type ActionId =
  | 'push'
  | 'pr'
  | 'deploy'
  | 'dev'
  | 'compose'
  | 'align'
  | 'prompt'
  | 'graphify'
  | 'open'
  | 'recipe'
  | 'status'
  | 'pull'
  | 'fetch'
  | 'stop'
  | 'script'
  | 'agent'
  | 'kill'
  | 'cleanup'
  | 'pr-open'

export interface ActionRequest {
  action: ActionId
  /** Project path; absent for actions on the data folder (status). */
  path?: string
  target?: string
  text?: string
}

/** An action request Orca accepts: its bridge only carries JSON, so absent fields must be left out, not `undefined`. */
export function actionRequest(action: ActionId, fields: { path?: string; target?: string; text?: string } = {}): ActionRequest {
  const req: ActionRequest = { action }
  if (fields.path) req.path = fields.path
  if (fields.target) req.target = fields.target
  if (fields.text !== undefined) req.text = fields.text
  return req
}

/** Ring states come from git (states()); 'agent' and 'review' only appear in "Now" (work.ts). */
export type StateKey = 'dirty' | 'unpushed' | 'behind' | 'unreleased' | 'recipe' | 'missing' | 'agent' | 'review'

export interface Attention {
  project: string
  path: string
  state: StateKey
  text: string
  action?: { id: ActionId; label: string; target?: string }
  /** Higher sorts first. */
  weight: number
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** The states a project is in, in ring order. */
export function states(p: Project): StateKey[] {
  if (p.missing) return ['missing']
  const out: StateKey[] = []
  const wtDirty = (p.dirty_worktrees ?? []).reduce((n, w) => n + w.dirty, 0)
  if ((p.dirty ?? 0) > 0 || wtDirty > 0) out.push('dirty')
  if ((p.ahead ?? 0) > 0) out.push('unpushed')
  if ((p.behind ?? 0) > 0) out.push('behind')
  if ((p.since ?? 0) > 0) out.push('unreleased')
  if (p.recipe === 'update') out.push('recipe')
  return out
}

export function attention(projects: Project[]): Attention[] {
  const out: Attention[] = []
  for (const p of projects) {
    const base = { project: p.name, path: p.path }
    if (p.missing) {
      out.push({ ...base, state: 'missing', text: 'folder not found', weight: 1 })
      continue
    }
    if (p.ahead) {
      out.push({
        ...base,
        state: 'unpushed',
        text: p.no_upstream
          ? `${plural(p.ahead, 'commit never pushed', 'commits never pushed')} on ${p.branch}`
          : `${plural(p.ahead, 'commit to push', 'commits to push')} on ${p.branch}`,
        action: { id: 'push', label: 'Push' },
        weight: 50 + p.ahead
      })
    }
    if (p.behind) {
      out.push({
        ...base,
        state: 'behind',
        text: `${plural(p.behind, 'commit to pull', 'commits to pull')} on ${p.branch}`,
        action: { id: 'pull', label: 'Pull' },
        weight: 45 + Math.min(p.behind, 30)
      })
    }
    if (p.dirty) {
      out.push({
        ...base,
        state: 'dirty',
        text: `${plural(p.dirty, 'uncommitted file', 'uncommitted files')} on ${p.branch}`,
        action: p.recipe_file ? { id: 'push', label: 'Push' } : undefined,
        weight: 30 + Math.min(p.dirty, 20)
      })
    }
    for (const w of p.dirty_worktrees ?? []) {
      out.push({
        ...base,
        state: 'dirty',
        text: `${plural(w.dirty, 'uncommitted file', 'uncommitted files')} in worktree ${w.branch}`,
        weight: 20 + Math.min(w.dirty, 20)
      })
    }
    if ((p.since ?? 0) > 0 && p.tag) {
      const target = p.targets?.[0]
      out.push({
        ...base,
        state: 'unreleased',
        text: `${plural(p.since ?? 0, 'commit', 'commits')} since ${p.tag}`,
        action: target ? { id: 'deploy', label: `Deploy ${target}`, target } : undefined,
        weight: 40 + Math.min(p.since ?? 0, 30)
      })
    }
    if (p.recipe === 'update') {
      out.push({ ...base, state: 'recipe', text: 'recipe out of date', action: { id: 'align', label: 'Align' }, weight: 35 })
    }
  }
  return out.sort((a, b) => b.weight - a.weight || a.project.localeCompare(b.project))
}

export interface Counts {
  all: number
  attention: number
  dirty: number
  unpushed: number
  behind: number
  unreleased: number
  recipe: number
}

export function counts(projects: Project[]): Counts {
  const c: Counts = { all: 0, attention: 0, dirty: 0, unpushed: 0, behind: 0, unreleased: 0, recipe: 0 }
  for (const p of projects) {
    if (p.missing) continue
    c.all++
    const s = states(p)
    if (s.length) c.attention++
    for (const k of s) if (k !== 'missing' && k !== 'agent' && k !== 'review') c[k]++
  }
  return c
}

/** The prompt an agent receives for an action; null for actions that open something instead.
 * `hasGraph`: the project already has a graphify graph, so an incremental update is enough. */
export function promptFor(req: ActionRequest, hasGraph = false): string | null {
  switch (req.action) {
    case 'push':
      return '/push'
    case 'pr':
      return '/pr'
    case 'deploy':
      // a rollback names the tag to go back to; the deploy skill confirms it and runs the target's steps for that tag
      if (req.text && /^[\w][\w.+-]{0,79}$/.test(req.text)) return `/deploy ${req.target ?? ''} rollback ${req.text}`.replace('  ', ' ')
      return req.target ? `/deploy ${req.target}` : '/deploy'
    case 'dev':
      return '/dev'
    case 'compose':
      return '/compose up'
    case 'align':
      return '/align'
    case 'status':
      return '/status'
    case 'stop':
      return '/compose stop'
    case 'graphify':
      return hasGraph ? '/graphify . --update' : '/graphify .'
    case 'prompt': {
      const text = (req.text ?? '').trim()
      return text ? `/prompt ${text}` : null
    }
    default:
      return null
  }
}

export const ACTION_LABEL: Record<ActionId, string> = {
  push: 'Push',
  pr: 'PR',
  deploy: 'Deploy',
  dev: 'Dev',
  compose: 'Services',
  align: 'Align',
  prompt: 'New task',
  graphify: 'Graphify',
  open: 'Open',
  recipe: 'Recipe',
  status: 'Status',
  pull: 'Pull',
  fetch: 'Fetch',
  stop: 'Stop services',
  script: 'Run',
  agent: 'Open',
  kill: 'Stop',
  cleanup: 'Clean up',
  'pr-open': 'Open PR'
}

export interface Workspace {
  id: string
  kind: 'worktree' | 'folder'
  name: string
  path: string
  branch: string | null
  hostId: string | null
}

const norm = (p: string) => p.replace(/\/+$/, '')

/** Workspace whose folder is exactly `path`; otherwise the closest one that contains it. */
export function workspaceFor(path: string, workspaces: Workspace[]): Workspace | null {
  const target = norm(path)
  let best: Workspace | null = null
  for (const w of workspaces) {
    const wp = norm(w.path)
    if (wp === target) return w
    if (target.startsWith(wp + '/') && (!best || wp.length > norm(best.path).length)) best = w
  }
  return best
}

// ---- graphify ----

export interface GraphCommunity {
  id: number
  label: string
  size: number
}

export interface GraphSummary {
  nodes: number
  links: number
  communities: number
  top: GraphCommunity[]
  /** Links between the communities in `top`: [a, b, count]. */
  bridges: [number, number, number][]
  builtAt: string | null
}

interface RawGraph {
  nodes?: { id: string; label?: string; community?: number }[]
  links?: { source: string; target: string }[]
  built_at_commit?: string
}

/** Community labels from GRAPH_REPORT.md: `### Community 3 - "Card piste e news"`. */
export function reportLabels(report: string): Map<number, string> {
  const out = new Map<number, string>()
  for (const m of report.matchAll(/^### Community (\d+) - "(.+)"\s*$/gm)) out.set(Number(m[1]), m[2])
  return out
}

export function summarizeGraph(graph: RawGraph, labels: Map<number, string>, limit = 24): GraphSummary {
  const nodes = graph.nodes ?? []
  const links = graph.links ?? []
  const size = new Map<number, number>()
  const commOf = new Map<string, number>()
  const degree = new Map<string, number>()
  for (const n of nodes) {
    if (typeof n.community !== 'number') continue
    commOf.set(n.id, n.community)
    size.set(n.community, (size.get(n.community) ?? 0) + 1)
  }
  for (const l of links) {
    degree.set(l.source, (degree.get(l.source) ?? 0) + 1)
    degree.set(l.target, (degree.get(l.target) ?? 0) + 1)
  }
  const top = [...size.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, limit)
  const keep = new Set(top.map(([id]) => id))
  const hub = new Map<number, { label: string; deg: number }>()
  for (const n of nodes) {
    const c = n.community
    if (typeof c !== 'number' || !keep.has(c)) continue
    const d = degree.get(n.id) ?? 0
    const cur = hub.get(c)
    if (!cur || d > cur.deg) hub.set(c, { label: n.label ?? n.id, deg: d })
  }
  const bridgeCount = new Map<string, number>()
  for (const l of links) {
    const a = commOf.get(l.source)
    const b = commOf.get(l.target)
    if (a === undefined || b === undefined || a === b || !keep.has(a) || !keep.has(b)) continue
    const key = a < b ? `${a}|${b}` : `${b}|${a}`
    bridgeCount.set(key, (bridgeCount.get(key) ?? 0) + 1)
  }
  return {
    nodes: nodes.length,
    links: links.length,
    communities: size.size,
    top: top.map(([id, n]) => ({ id, size: n, label: labels.get(id) ?? hub.get(id)?.label ?? `Community ${id}` })),
    bridges: [...bridgeCount.entries()]
      .map(([k, n]) => {
        const [a, b] = k.split('|').map(Number)
        return [a, b, n] as [number, number, number]
      })
      .sort((x, y) => y[2] - x[2]),
    builtAt: graph.built_at_commit ?? null
  }
}

/** `repo list` lines for dashboard.py from Orca's workspaces: one per repository main checkout. */
export function repoListFrom(mains: { path: string; name: string }[]): string {
  return mains.map((m, i) => `ws-${i}  ${m.name.replace(/\s+/g, '-')}  ${m.path}`).join('\n') + '\n'
}

// ---- Actions that need no agent -------------------------------------------------------------
// /status, /compose up and /dev only run commands the recipe already spells out. The board runs
// those commands in Orca terminals itself, so they cost no model tokens; an agent is launched only
// when something needs judgement (no recipe section yet, or steps still marked "inferred: confirm").

/** The body of a recipe's `## <name>` section (until the next `## `), or null when it has none. */
export function recipeSection(recipe: string, name: string): string | null {
  const lines = recipe.split('\n')
  const start = lines.findIndex((l) => l.trimEnd() === `## ${name}`)
  if (start < 0) return null
  const end = lines.findIndex((l, i) => i > start && l.startsWith('## '))
  return lines.slice(start + 1, end < 0 ? undefined : end).join('\n')
}

/** True when a section still has steps the user has not confirmed: those need an agent to ask first. */
export function needsConfirmation(section: string): boolean {
  return /inferred\s*:\s*confirm/i.test(section)
}

/** Single-quote for a POSIX shell (bash, zsh). */
export function shq(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

/** Printed by the services terminal when compose is done. Built from two strings so the command line the
 * shell echoes never contains the finished marker. */
export const SERVICES_OK = 'release-control: services ready'
export const SERVICES_FAILED = 'release-control: services failed'
export function servicesCommand(composeCmds: string[]): string {
  const [okA, okB] = [SERVICES_OK.slice(0, 20), SERVICES_OK.slice(20)]
  const [noA, noB] = [SERVICES_FAILED.slice(0, 20), SERVICES_FAILED.slice(20)]
  return `{ ${composeCmds.join(' && ')}; } && printf '%s%s\\n' ${shq(okA)} ${shq(okB)} || printf '%s%s\\n' ${shq(noA)} ${shq(noB)}`
}

/** "dev: api" from "npm run start:dev --workspace api"-like commands: short, stable terminal titles. */
export function devTitle(cmd: string): string {
  const short = cmd.replace(/\s+/g, ' ').trim()
  return `dev: ${short.length > 40 ? short.slice(0, 39) + '…' : short}`
}

/** `git pull` that never merges or rebases: it only moves the branch forward, or stops and says why. */
export const PULL_COMMAND = 'git pull --ff-only'

/** The project a board file asks to show: `{"select": "/path"}`. */
export function boardFile(select: string | null): string {
  return JSON.stringify(select ? { select } : {}) + '\n'
}

/** The workspace Orca has focused, from what `workspace.changed` reports (name and branch). */
export function focusedWorkspace(ctx: { displayName: string; branch: string } | null, workspaces: Workspace[]): Workspace | null {
  if (!ctx) return null
  const named = workspaces.filter((w) => w.name === ctx.displayName)
  return named.find((w) => (w.branch ?? '') === ctx.branch) ?? named[0] ?? null
}

/** Why a background `git fetch` failed, in words a person can act on. */
export function fetchFailure(stderr: string): string {
  const e = stderr.toLowerCase()
  if (/could not resolve host|name or service not known|nodename nor servname/.test(e)) return 'server not reachable (VPN off?)'
  if (/timed out|timeout|connection refused|network is unreachable/.test(e)) return 'server not answering'
  if (/authentication failed|could not read username|permission denied|access denied|403|401/.test(e)) return 'login needed'
  if (/host key verification failed/.test(e)) return 'unknown SSH host key'
  if (/repository not found|does not appear to be a git repository/.test(e)) return 'remote not found'
  return 'fetch failed'
}

/** "Fetched 5 of 8 projects · server not reachable (VPN off?): a, b · login needed: c" */
export function fetchSummary(total: number, failures: { name: string; reason: string }[], behind: number): string {
  const head = `Fetched ${total - failures.length} of ${total} projects`
  if (!failures.length) return head + (behind ? ` · ${behind} with commits to pull` : ' · nothing to pull')
  const by = new Map<string, string[]>()
  for (const f of failures) by.set(f.reason, [...(by.get(f.reason) ?? []), f.name])
  return head + [...by].map(([r, names]) => ` · ${r}: ${names.join(', ')}`).join('')
}

// ---- Project page (docs, API, setup) ---------------------------------------------------------

export interface DocEntry {
  path: string
  title: string
  headings: { level: number; text: string }[]
  words: number
  group: string
}
export interface Endpoint {
  method: string
  path: string
  group: string
  file: string
  line?: number
  handler?: string | null
  summary?: string | null
  approx?: boolean
}
export interface ProjectInfo {
  path: string
  docs: DocEntry[]
  api: Endpoint[]
  scripts: { source: string; name: string; run: string; command: string }[]
  env: { name: string; file: string }[]
  urls: string[]
  commits: { hash: string; subject: string; author: string; when: string }[]
}

/** Endpoints grouped by controller/file, groups sorted by size, endpoints by path then method. */
export function groupEndpoints(api: Endpoint[], query = '', method = ''): { group: string; items: Endpoint[] }[] {
  const q = query.trim().toLowerCase()
  const order = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
  const keep = api.filter(
    (e) =>
      (!method || e.method === method) &&
      (!q || e.path.toLowerCase().includes(q) || e.group.toLowerCase().includes(q) || (e.handler ?? '').toLowerCase().includes(q))
  )
  const by = new Map<string, Endpoint[]>()
  for (const e of keep) by.set(e.group, [...(by.get(e.group) ?? []), e])
  return [...by]
    .map(([group, items]) => ({
      group,
      items: items.sort((a, b) => a.path.localeCompare(b.path) || order.indexOf(a.method) - order.indexOf(b.method))
    }))
    .sort((a, b) => b.items.length - a.items.length || a.group.localeCompare(b.group))
}

/** How many endpoints per HTTP method, in a stable order: the API tab's stacked bar. */
export function methodCounts(api: Endpoint[]): { method: string; n: number }[] {
  const order = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
  const c = new Map<string, number>()
  for (const e of api) c.set(e.method, (c.get(e.method) ?? 0) + 1)
  return [...c].map(([method, n]) => ({ method, n })).sort((a, b) => {
    const ia = order.indexOf(a.method), ib = order.indexOf(b.method)
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.method.localeCompare(b.method)
  })
}

/** What a project looked like when Push or Deploy was pressed. */
export interface Launch {
  kind: 'push' | 'deploy'
  at: number
  ahead: number
  dirty: number
  tag: string | null
  since: number
}

/** A push lands when nothing is left to push and it had commits or files to send; a deploy when a new
 * tag appears or nothing is left to release. */
export function landed(l: Launch, p: Project): boolean {
  return l.kind === 'push'
    ? (p.ahead ?? 0) === 0 && (l.ahead > 0 || (p.dirty ?? 0) < l.dirty)
    : (!!p.tag && p.tag !== l.tag) || (l.since > 0 && (p.since ?? 0) === 0)
}
