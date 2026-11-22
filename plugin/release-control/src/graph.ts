// Pure graph rules for the board: domains, typed links between projects, shared dependencies.
import type { LinkType, Project, Snapshot } from './model'

export const LINK_LABEL: Record<LinkType, string> = {
  'uses-api': 'uses the API of',
  follows: 'follows the conventions of',
  replaces: 'replaces',
  related: 'related to'
}

export const INCOMING_LABEL: Record<LinkType, string> = {
  'uses-api': 'used by',
  follows: 'followed by',
  replaces: 'replaced by',
  related: 'related to'
}

export interface Domain {
  id: string
  label: string
  members: string[]
}

export interface Edge {
  from: string
  to: string
  type: LinkType
  external: boolean
  bend: number
}

const titleCase = (id: string) =>
  id
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ')

export const recipeId = (p: Project): string | null => {
  const f = p.recipe_file
  if (!f) return null
  const base = f.split('/').pop() ?? ''
  return base.endsWith('.md') ? base.slice(0, -3) : base
}

export function domains(projects: Project[]): Domain[] {
  const out = new Map<string, Domain>()
  for (const p of projects) {
    if (p.missing || !p.domain) continue
    const d = out.get(p.domain) ?? { id: p.domain, label: '', members: [] }
    if (!d.label && p.domain_label) d.label = p.domain_label
    d.members.push(p.path)
    out.set(p.domain, d)
  }
  return [...out.values()].map((d) => ({ ...d, label: d.label || titleCase(d.id) }))
}

export function edges(projects: Project[]): Edge[] {
  const live = projects.filter((p) => !p.missing)
  const byId = new Map<string, Project>()
  for (const p of live) {
    const id = recipeId(p)
    if (id) byId.set(id, p)
  }
  const out: Edge[] = []
  for (const p of live) {
    for (const l of p.links ?? []) {
      if (l.target.startsWith('ext:')) {
        out.push({ from: `p:${p.path}`, to: `x:${l.target.slice(4)}`, type: l.type, external: true, bend: 0 })
        continue
      }
      const t = byId.get(l.target)
      if (!t || t === p) continue
      out.push({ from: `p:${p.path}`, to: `p:${t.path}`, type: l.type, external: false, bend: 0 })
    }
  }
  const pairs = new Set(out.map((e) => `${e.from}>${e.to}`))
  // same sign for both: the bend is applied along each edge's own perpendicular, which already points
  // the opposite way for the reverse edge, so the pair curves to opposite sides
  for (const e of out) if (pairs.has(`${e.to}>${e.from}`)) e.bend = 0.25
  return out
}

export function incoming(projects: Project[], path: string): { from: Project; type: LinkType }[] {
  const target = projects.find((p) => p.path === path)
  const id = target ? recipeId(target) : null
  if (!id) return []
  const out: { from: Project; type: LinkType }[] = []
  for (const p of projects) {
    if (p.missing || p.path === path) continue
    for (const l of p.links ?? []) if (l.target === id) out.push({ from: p, type: l.type })
  }
  return out
}

export function depRows(snapshot: Snapshot, name: string): { project: string; version: string; odd: boolean }[] {
  const versions = snapshot.shared_deps?.[name] ?? {}
  const count = new Map<string, number>()
  for (const v of Object.values(versions)) count.set(v, (count.get(v) ?? 0) + 1)
  const common = [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
  return snapshot.projects
    .filter((p) => versions[p.path] !== undefined)
    .map((p) => ({ project: p.name, version: versions[p.path], odd: count.size > 1 && versions[p.path] !== common }))
}

/** The node plus everything it links to (a domain `d:<id>`: its members and their links). */
export function neighbourhood(edgeList: Edge[], nodeId: string, domainList: Domain[] = []): Set<string> {
  const out = new Set<string>([nodeId])
  const seeds = nodeId.startsWith('d:')
    ? (domainList.find((d) => `d:${d.id}` === nodeId)?.members ?? []).map((m) => `p:${m}`)
    : [nodeId]
  for (const s of seeds) out.add(s)
  for (const e of edgeList) {
    if (seeds.includes(e.from)) out.add(e.to)
    if (seeds.includes(e.to)) out.add(e.from)
  }
  return out
}

export interface DepGrid {
  deps: string[]
  rows: { project: string; path: string; cells: (string | null)[]; odd: boolean[] }[]
}

/** Projects × shared dependencies, deps sorted by how many projects use them, then by name. */
export function depGrid(snapshot: Snapshot): DepGrid {
  const shared = snapshot.shared_deps ?? {}
  const deps = Object.keys(shared).sort((a, b) => Object.keys(shared[b]).length - Object.keys(shared[a]).length || a.localeCompare(b))
  const oddOf = new Map(deps.map((d) => [d, new Set(depRows(snapshot, d).filter((r) => r.odd).map((r) => r.project))]))
  const rows = snapshot.projects
    .filter((p) => !p.missing && deps.some((d) => shared[d][p.path] !== undefined))
    .map((p) => ({
      project: p.name,
      path: p.path,
      cells: deps.map((d) => shared[d][p.path] ?? null),
      odd: deps.map((d) => oddOf.get(d)!.has(p.name))
    }))
  return { deps, rows }
}

/** Control point of a link's quadratic curve: the midpoint pushed along the a→b perpendicular by bend × length. */
export function curveControl(a: { x: number; y: number }, b: { x: number; y: number }, bend: number): { x: number; y: number } {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const d = Math.hypot(dx, dy) || 1
  return { x: (a.x + b.x) / 2 - (dy / d) * bend * d, y: (a.y + b.y) / 2 + (dx / d) * bend * d }
}

/** Whether a star keeps its position through a re-layout: on the first layout only saved stars do; later every
 *  star that already existed (or was saved) stays, so adding a layer or a node never reshuffles the map. */
export function keepsPlace(o: { existed: boolean; saved: boolean; firstLayout: boolean }): boolean {
  return o.firstLayout ? o.saved : o.existed || o.saved
}
