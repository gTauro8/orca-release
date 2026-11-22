// The work around the code: agents, pull requests and CI, what runs, what can be cleaned up, search,
// standup. Pure rules shared by the worker, the board and the panel: no Orca, no Node, no DOM.
import { attention, type Attention, type Project, type ProjectInfo, type Snapshot } from './model'

export type AgentState = 'working' | 'blocked' | 'waiting' | 'done'
export interface AgentRow {
  paneKey: string
  path: string
  workspaceId: string
  terminalId?: string
  title?: string
  state: AgentState
  since: number
}
export interface PullRequest {
  number: number
  title: string
  url: string
  author: string
  branch?: string | null
  draft: boolean
  review: string | null
  mine: boolean
  review_requested: boolean
}
export interface Ci {
  state: string
  url: string | null
  name: string | null
  branch: string | null
}
export interface Process {
  pid: number
  command: string
  ports: number[]
  cwd: string
}
export interface Service {
  name: string
  state: string
  health: string | null
  ports: number[]
}
export interface EnvTarget {
  name: string
  url: string | null
  health: string | null
  checked: boolean
  checked_url?: string
  up?: boolean
  status?: number | null
  ms?: number | null
  version?: string | null
  behind?: number | null
  error?: string | null
}
export interface Release {
  tag: string
  date: string
  subject: string
  by: string
  commits: number | null
}
export interface ProjectWork {
  prs?: { host: string | null; prs: PullRequest[]; ci: Ci | null; error?: string; at: number }
  running?: { processes: Process[]; services: Service[] }
  /** Terminals the board started in this project (services, dev, scripts, pull), newest last: their logs can be read. */
  terminals?: { id: string; title: string }[]
  /** Deploy targets with a url: up/down, latency, deployed version, commits behind (network, on refresh). */
  envs?: { targets: EnvTarget[]; base: string | null; at: number }
  releases?: { tags: Release[]; unreleased: number | null; base: string | null }
  cleanup?: { base: string | null; merged_branches: string[]; gone_branches: string[]; worktrees: { path: string; branch: string }[] }
}

/** An agent that stopped to ask the user something. */
export const needsYou = (a: AgentRow) => a.state === 'waiting' || a.state === 'blocked'

/** Is anything of this project running (a dev process with a port, or a compose service up)? */
export function isRunning(w: ProjectWork | undefined): boolean {
  return !!w?.running && (w.running.processes.length > 0 || w.running.services.some((s) => s.state === 'running'))
}

export function cleanupCount(w: ProjectWork | undefined): number {
  return (w?.cleanup?.merged_branches.length ?? 0) + (w?.cleanup?.worktrees.length ?? 0)
}

const failed = (ci: Ci | null | undefined) => !!ci && /fail|error|cancel|timed_out/i.test(ci.state)

/** "Now" items from the work around the code: agents waiting, reviews asked of you, changes asked on yours, red CI. */
export function workAttention(s: Snapshot): Attention[] {
  const out: Attention[] = []
  const byPath = new Map(s.projects.map((p) => [p.path, p]))
  for (const a of s.agents ?? []) {
    const p = byPath.get(a.path)
    if (!p || !needsYou(a)) continue
    out.push({
      project: p.name,
      path: p.path,
      state: 'agent',
      text: `agent ${a.state === 'blocked' ? 'blocked, needs you' : 'waiting for you'}${a.title ? ` · ${a.title}` : ''}`,
      action: { id: 'agent', label: 'Open', target: a.paneKey },
      weight: 90
    })
  }
  for (const [path, w] of Object.entries(s.work ?? {})) {
    const p = byPath.get(path)
    if (!p) continue
    for (const pr of w.prs?.prs ?? []) {
      if (pr.review_requested)
        out.push({ project: p.name, path, state: 'review', text: `review asked: #${pr.number} ${pr.title}`, action: { id: 'pr-open', label: 'Open PR', target: pr.url }, weight: 70 })
      else if (pr.mine && pr.review === 'changes_requested')
        out.push({ project: p.name, path, state: 'review', text: `changes requested on #${pr.number} ${pr.title}`, action: { id: 'pr-open', label: 'Open PR', target: pr.url }, weight: 65 })
    }
    for (const t of w.envs?.targets ?? []) {
      if (t.checked && t.up === false)
        out.push({ project: p.name, path, state: 'review', text: `${t.name} is down${t.error ? ` · ${t.error}` : t.status ? ` · HTTP ${t.status}` : ''}`, action: t.url ? { id: 'pr-open', label: 'Open', target: t.url } : undefined, weight: 80 })
    }
    const ci = w.prs?.ci
    if (failed(ci))
      out.push({
        project: p.name,
        path,
        state: 'review',
        text: `CI ${ci!.state}${ci!.name ? ` · ${ci!.name}` : ''}${ci!.branch ? ` on ${ci!.branch}` : ''}`,
        action: ci!.url ? { id: 'pr-open', label: 'Open run', target: ci!.url } : undefined,
        weight: 60
      })
  }
  return out
}

/** Everything that needs the user, release work and the work around it, most urgent first. */
export function allAttention(s: Snapshot, projects: Project[] = s.projects): Attention[] {
  const paths = new Set(projects.map((p) => p.path))
  return [...attention(projects), ...workAttention(s).filter((a) => paths.has(a.path))].sort(
    (a, b) => b.weight - a.weight || a.project.localeCompare(b.project)
  )
}

// ---- search ----

export type HitKind = 'project' | 'doc' | 'endpoint' | 'script' | 'env'
export interface Hit {
  kind: HitKind
  path: string
  project: string
  label: string
  detail: string
  /** What a click opens: the project path, a doc path, an endpoint path, a script, an env name. */
  ref: string
  score: number
}

const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Ranked matches across project names, docs (titles, sections, paths), endpoints, scripts and env names. */
export function search(query: string, projects: Project[], infos: Map<string, ProjectInfo>): Hit[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) return []
  const score = (text: string): number => {
    const t = text.toLowerCase()
    if (!terms.every((x) => t.includes(x))) return 0
    return terms.reduce((n, x) => n + (t.startsWith(x) ? 3 : new RegExp(`[^a-z0-9]${escRe(x)}`).test(t) ? 2 : 1), 0)
  }
  const hits: Hit[] = []
  for (const p of projects) {
    if (p.missing) continue
    const sp = score(`${p.name} ${(p.stack ?? []).join(' ')}`)
    if (sp) hits.push({ kind: 'project', path: p.path, project: p.name, label: p.name, detail: p.branch ?? '', ref: p.path, score: sp + 4 })
    const info = infos.get(p.path)
    if (!info) continue
    for (const d of info.docs) {
      const best = Math.max(score(d.title) * 2, ...d.headings.map((h) => score(h.text)), score(d.path))
      if (best) hits.push({ kind: 'doc', path: p.path, project: p.name, label: d.title, detail: d.path, ref: d.path, score: best })
    }
    for (const e of info.api) {
      const se = score(`${e.method} ${e.path} ${e.handler ?? ''} ${e.group}`)
      if (se) hits.push({ kind: 'endpoint', path: p.path, project: p.name, label: `${e.method} ${e.path}`, detail: e.handler ? `${e.group} · ${e.handler}` : e.group, ref: e.path, score: se + 1 })
    }
    for (const sc of info.scripts) {
      const ss = score(`${sc.run} ${sc.command}`)
      if (ss) hits.push({ kind: 'script', path: p.path, project: p.name, label: sc.run, detail: sc.command, ref: sc.run, score: ss })
    }
    for (const v of info.env) {
      const sv = score(v.name)
      if (sv) hits.push({ kind: 'env', path: p.path, project: p.name, label: v.name, detail: v.file, ref: v.name, score: sv })
    }
  }
  return hits.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label)).slice(0, 80)
}

// ---- standup ----

export interface StandupRow {
  name: string
  path: string
  commits: { hash: string; subject: string; date: string }[]
}

/** Markdown ready to paste in a standup or a chat. */
export function standupText(rows: StandupRow[], since: string): string {
  if (!rows.length) return `No commits of mine since ${since}.`
  return rows.map((r) => `**${r.name}**\n${r.commits.map((c) => `- ${c.subject}`).join('\n')}`).join('\n\n')
}

/** Lines that look like trouble in a log: shown in colour, counted in the header. */
export const LOG_ERROR = /\b(error|exception|fatal|failed|failure|panic|traceback|unhandled|ERR!)\b/i

/** A version tag the board can offer a rollback to (the deploy skill gets it verbatim). */
export const TAG_RE = /^[\w][\w.+-]{0,79}$/
