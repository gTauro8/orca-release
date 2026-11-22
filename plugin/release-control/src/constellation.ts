// The constellation: projects as stars, grouped by domain, linked to each other (typed arrows), to
// external systems and — on the chosen layer — to their technologies or shared dependencies.
// State is light: a project with release work waiting carries a corona; every project with pending
// work carries a segmented ring. Positions are kept between sessions; hovering focuses a neighbourhood.
import { curveControl, domains as domainsOf, edges as edgesOf, keepsPlace, neighbourhood, type Domain, type Edge } from './graph'
import { states, type LinkType, type Project, type Snapshot, type StateKey } from './model'

type Kind = 'project' | 'tech' | 'dep' | 'ext'

export interface Node {
  id: string
  kind: Kind
  label: string
  x: number
  y: number
  vx: number
  vy: number
  r: number
  fixed: boolean
  /** Kept in place during the first settle because it has a saved position. */
  pinned: boolean
  /** Half the label width: labels collide too, not just the dots. */
  half: number
  project?: Project
  states: StateKey[]
  /** Dependency nodes: the shared versions differ between projects. */
  split?: boolean
}

interface Spoke {
  a: Node
  b: Node
  /** Dependency spokes: this project's version differs from the most common one. */
  odd?: boolean
}

interface Arrow {
  a: Node
  b: Node
  type: LinkType
  bend: number
}

/** cubic-bezier(0.23, 1, 0.32, 1): the strong ease-out the board uses for everything that enters. */
function easeOut(t: number): number {
  const [x1, y1, x2, y2] = [0.23, 1, 0.32, 1]
  const bx = (u: number) => 3 * x1 * u * (1 - u) ** 2 + 3 * x2 * u * u * (1 - u) + u ** 3
  const by = (u: number) => 3 * y1 * u * (1 - u) ** 2 + 3 * y2 * u * u * (1 - u) + u ** 3
  let lo = 0, hi = 1, u = t
  for (let i = 0; i < 20; i++) {
    u = (lo + hi) / 2
    if (bx(u) < t) lo = u
    else hi = u
  }
  return by(u)
}
const clamp01 = (t: number) => Math.max(0, Math.min(1, t))

interface Fx {
  id: string
  kind: 'launch' | 'land'
  color: string
  t0: number
}
const LAUNCH_MS = 700
const LAND_MS = 1300
const ORBIT_MS = 1600

const TECH_LABEL: Record<string, string> = {
  'gh-actions': 'GitHub Actions',
  node: 'Node',
  flutter: 'Flutter',
  ios: 'iOS',
  android: 'Android',
  docker: 'Docker',
  python: 'Python',
  go: 'Go',
  make: 'Make',
  rust: 'Rust',
  java: 'Java',
  swift: 'Swift',
  php: 'PHP',
  cmake: 'CMake'
}
export const techLabel = (t: string) => TECH_LABEL[t] ?? t

const LINK_WORD: Record<LinkType, string> = {
  'uses-api': 'uses API',
  follows: 'follows',
  replaces: 'replaces',
  related: 'related'
}

export type Layer = 'tech' | 'deps'
export type Positions = Record<string, [number, number]>

export interface DataOptions {
  layer: Layer
  showTech: boolean
  shared?: Snapshot['shared_deps']
  positions?: Positions
}

export interface Options {
  onSelect: (project: Project | null) => void
  /** A press on a technology: show only its projects. */
  onPickTech: (tech: string) => void
  onPickDep: (name: string) => void
  onPickDomain: (id: string) => void
  /** Positions changed (after the first settle or a drag): save them. */
  onLayout: (positions: Positions) => void
}

export class Constellation {
  private ctx: CanvasRenderingContext2D
  private nodes: Node[] = []
  private spokes: Spoke[] = []
  private arrows: Arrow[] = []
  private edgeList: Edge[] = []
  private domainList: Domain[] = []
  private hulls: { d: Domain; pts: [number, number][] }[] = []
  private w = 0
  private h = 0
  private dpr = 1
  private alpha = 0
  private raf = 0
  /** A slow frame for the orbit alone: nothing else moves, ~15 fps is plenty. */
  private idle = 0
  /** The body font, read once per theme instead of on every frame. */
  private fontFamily = ''
  private hover: Node | null = null
  private hoverDomain: string | null = null
  private focus: Set<string> | null = null
  private focusMix = 0
  private focusTarget = 0
  private drag: { node: Node; id: number; moved: boolean; sx: number; sy: number } | null = null
  private colors: Record<string, string> = {}
  private saved: Positions = {}
  private layoutTimer = 0
  selected: string | null = null
  /** Projects matching the active filter; others are dimmed. Null means every project. */
  visible: Set<string> | null = null
  private reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
  /** Release effects: a launch when Push/Deploy is pressed, a landing when it shows up in the data. */
  private fx: Fx[] = []
  /** Projects with a push or deploy under way: a dot orbits their star until it lands. */
  private pending = new Map<string, { color: string; t0: number }>()
  /** Layout scale from the canvas size, so the constellation fills the map at any width. */
  private get scale(): number {
    return Math.max(0.8, Math.min(2.2, Math.min(this.w || 800, (this.h || 600) * 1.25) / 560))
  }

  constructor(
    private canvas: HTMLCanvasElement,
    private opts: Options
  ) {
    this.ctx = canvas.getContext('2d')!
    new ResizeObserver(() => this.resize()).observe(canvas)
    canvas.addEventListener('pointermove', (e) => this.onMove(e))
    canvas.addEventListener('pointerdown', (e) => this.onDown(e))
    canvas.addEventListener('pointerup', (e) => this.onUp(e))
    canvas.addEventListener('pointercancel', () => this.endDrag())
    canvas.addEventListener('pointerleave', () => {
      if (!this.drag) this.setHover(null, null)
    })
    this.readColors()
  }

  readColors(): void {
    this.fontFamily = getComputedStyle(document.body).fontFamily
    const cs = getComputedStyle(document.documentElement)
    const v = (n: string, fb: string) => toRgb(cs.getPropertyValue(n).trim() || fb)
    this.colors = {
      fg: v('--orca-foreground', '#222'),
      muted: v('--orca-muted-foreground', '#777'),
      quiet: v('--orca-muted', '#eee'),
      border: v('--orca-border', '#ddd'),
      card: v('--orca-card', '#fff'),
      bg: v('--orca-background', '#fff'),
      dirty: v('--rc-dirty', '#b98110'),
      unpushed: v('--rc-unpushed', '#d9541e'),
      behind: v('--rc-behind', '#0e8a8a'),
      agent: v('--rc-agent', '#d6409f'),
      review: v('--rc-review', '#6e56cf'),
      unreleased: v('--rc-unreleased', '#3a6be0'),
      recipe: v('--rc-recipe', '#8a55d6'),
      clean: v('--rc-clean', '#2c8a57'),
      missing: v('--rc-missing', '#8a8f98')
    }
    this.draw()
  }

  /** True when there are confirmed links between projects (the board then hides technologies by default). */
  hasLinks(projects: Project[]): boolean {
    return edgesOf(projects).length > 0
  }

  setData(projects: Project[], data: DataOptions): void {
    if (data.positions) this.saved = data.positions
    const old = new Map(this.nodes.map((n) => [n.id, n]))
    const live = projects.filter((p) => !p.missing)
    const cx = this.w / 2 || 400
    const cy = this.h / 2 || 300
    const R = Math.min(cx, cy) * 0.7 || 200
    const nodes: Node[] = []
    const byId = new Map<string, Node>()
    const make = (id: string, kind: Kind, label: string, r: number, extra: Partial<Node> = {}): Node => {
      const prev = old.get(id)
      const s = this.saved[id]
      const pos = prev ? [prev.x, prev.y] : s && this.w ? [s[0] * this.w, s[1] * this.h] : [cx + (Math.random() - 0.5) * 60, cy + (Math.random() - 0.5) * 60]
      const weight = kind === 'project' ? 600 : 500
      const size = kind === 'project' ? 12 : 11
      const n: Node = {
        id, kind, label, x: pos[0], y: pos[1], vx: 0, vy: 0, r, fixed: false,
        pinned: keepsPlace({ existed: !!prev, saved: !!s, firstLayout: old.size === 0 }), half: this.labelHalf(label, weight, size) + (kind === 'project' ? 0 : 6), states: [], ...extra
      }
      nodes.push(n)
      byId.set(id, n)
      return n
    }
    live.forEach((p, i) => {
      const activity = (p.weeks ?? []).reduce((a, b) => a + b, 0)
      const a = (i / Math.max(1, live.length)) * Math.PI * 2
      const n = make(`p:${p.path}`, 'project', p.name, Math.max(9, Math.min(24, 8 + Math.sqrt(activity) * 1.6)), {
        project: p,
        states: states(p)
      })
      if (!old.has(n.id) && !n.pinned) {
        n.x = cx + Math.cos(a) * R
        n.y = cy + Math.sin(a) * R
      }
    })

    this.edgeList = edgesOf(projects)
    this.domainList = domainsOf(projects)
    const arrows: Arrow[] = []
    for (const e of this.edgeList) {
      const from = byId.get(e.from)
      if (!from) continue
      const to = byId.get(e.to) ?? (e.external ? make(e.to, 'ext', e.to.slice(2), 4) : undefined)
      if (to) arrows.push({ a: from, b: to, type: e.type, bend: e.bend })
    }

    const spokes: Spoke[] = []
    if (data.layer === 'tech' && data.showTech) {
      for (const n of nodes.filter((x) => x.kind === 'project')) {
        for (const t of n.project?.stack ?? []) {
          const tn = byId.get(`t:${t}`) ?? make(`t:${t}`, 'tech', techLabel(t), 3.5)
          spokes.push({ a: n, b: tn })
        }
      }
    }
    if (data.layer === 'deps') {
      for (const [name, versions] of Object.entries(data.shared ?? {})) {
        const users = Object.keys(versions)
        const count = new Map<string, number>()
        for (const v of Object.values(versions)) count.set(v, (count.get(v) ?? 0) + 1)
        const common = [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
        const split = count.size > 1
        // the map shows only what needs a decision (versions that differ); the drawer table lists them all
        if (!split) continue
        if (this.w && this.w < 600) continue // too small for a readable dependency map: the table has it all
        const dn = make(`d:${name}`, 'dep', split ? `${name} · ${count.size} versions` : name, 2.5 + Math.min(6, users.length * 1.2), { split })
        for (const path of users) {
          const pn = byId.get(`p:${path}`)
          if (pn) spokes.push({ a: pn, b: dn, odd: split && versions[path] !== common })
        }
      }
    }

    const fresh = nodes.some((n) => !old.has(n.id))
    this.nodes = nodes
    this.spokes = spokes
    this.arrows = arrows
    if (fresh || !old.size) this.settle()
    this.kick(this.reduced ? 0 : 0.12)
    this.draw()
  }

  /** Forget saved positions and lay everything out again. */
  rearrange(): void {
    this.saved = {}
    for (const n of this.nodes) n.pinned = false
    this.settle(true)
    this.kick(this.reduced ? 0 : 0.2)
    this.draw()
    this.saveLayout()
  }

  /** Settle most of the layout off-screen so opening the board never plays a long intro. */
  private settle(force = false): void {
    if (!this.w) return
    const cx = this.w / 2
    const cy = this.h / 2
    const R = Math.min(cx, cy) * 0.75
    const projects = this.nodes.filter((n) => n.kind === 'project')
    projects.forEach((n, i) => {
      if (n.pinned && !force) return
      const a = (i / Math.max(1, projects.length)) * Math.PI * 2 - Math.PI / 2
      n.x = cx + Math.cos(a) * R
      n.y = cy + Math.sin(a) * R
    })
    for (const n of this.nodes) {
      if (n.kind === 'project' || (n.pinned && !force)) continue
      const linked = [...this.spokes.filter((l) => l.b === n).map((l) => l.a), ...this.arrows.filter((l) => l.b === n).map((l) => l.a)]
      n.x = linked.reduce((s, p) => s + p.x, 0) / Math.max(1, linked.length) + (Math.random() - 0.5) * 20
      n.y = linked.reduce((s, p) => s + p.y, 0) / Math.max(1, linked.length) + (Math.random() - 0.5) * 20
    }
    const pinned = this.nodes.filter((n) => n.pinned && !force)
    for (const n of pinned) n.fixed = true
    this.alpha = 1
    for (let i = 0; i < (this.reduced ? 420 : 300); i++) this.tick()
    for (const n of pinned) {
      n.fixed = false
      n.pinned = false
    }
    this.alpha = 0.05
    this.saveLayout()
  }

  private saveLayout(): void {
    if (!this.w) return
    clearTimeout(this.layoutTimer)
    this.layoutTimer = window.setTimeout(() => {
      const out: Positions = {}
      for (const n of this.nodes) out[n.id] = [+(n.x / this.w).toFixed(4), +(n.y / this.h).toFixed(4)]
      this.saved = { ...this.saved, ...out }
      this.opts.onLayout(this.saved)
    }, 1000)
  }

  private labelHalf(text: string, weight: number, size: number): number {
    this.ctx.font = `${weight} ${size}px ${this.fontFamily || getComputedStyle(document.body).fontFamily}`
    return this.ctx.measureText(text).width / 2
  }

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect()
    const ow = this.w
    const oh = this.h
    this.dpr = window.devicePixelRatio || 1
    this.w = rect.width
    this.h = rect.height
    this.canvas.width = Math.round(rect.width * this.dpr)
    this.canvas.height = Math.round(rect.height * this.dpr)
    if (ow && oh) {
      for (const n of this.nodes) {
        n.x = (n.x / ow) * this.w
        n.y = (n.y / oh) * this.h
      }
    } else if (this.nodes.length) {
      // first real size: place saved stars where they were, settle the rest
      for (const n of this.nodes) {
        const s = this.saved[n.id]
        if (s) {
          n.x = s[0] * this.w
          n.y = s[1] * this.h
          n.pinned = true
        }
      }
      this.settle()
    }
    this.kick(0.1)
    this.draw()
  }

  /** Push or Deploy pressed for a project: pulse, a comet leaving the star, then an orbit while it runs. */
  launch(path: string, kind: 'push' | 'deploy'): void {
    const id = `p:${path}`
    const color = kind === 'push' ? this.colors.unpushed : this.colors.unreleased
    const t0 = performance.now()
    this.pending.set(id, { color, t0 })
    this.fx.push({ id, kind: 'launch', color, t0 })
    this.loop()
  }

  /** The push or deploy shows up in the data: two waves and a check in the clean colour. */
  land(path: string): void {
    const id = `p:${path}`
    this.pending.delete(id)
    this.fx.push({ id, kind: 'land', color: this.colors.clean, t0: performance.now() })
    this.loop()
  }

  /** Stop waiting without a landing (it failed, or nothing changed for too long). */
  cancel(path: string): void {
    if (this.pending.delete(`p:${path}`)) this.draw()
  }

  private get animating(): boolean {
    return this.fx.length > 0 || (this.pending.size > 0 && !this.reduced)
  }

  private kick(alpha: number): void {
    if (this.reduced) {
      this.draw()
      return
    }
    this.alpha = Math.max(this.alpha, alpha)
    this.loop()
  }

  private loop(): void {
    if (!this.raf) this.raf = requestAnimationFrame(() => this.frame())
  }

  private frame(): void {
    this.raf = 0
    if (this.alpha > 0.004) this.tick()
    // focus fades in/out over ~120 ms; reduced motion switches at once
    const step = this.reduced ? 1 : 1 / 7
    if (this.focusMix !== this.focusTarget) {
      this.focusMix = this.focusTarget > this.focusMix ? Math.min(this.focusTarget, this.focusMix + step) : Math.max(this.focusTarget, this.focusMix - step)
    }
    this.draw()
    const moving = this.alpha > 0.004 || !!this.drag || this.focusMix !== this.focusTarget || this.fx.length > 0
    if (moving) this.loop()
    else if (this.animating && !this.idle) {
      this.idle = window.setTimeout(() => {
        this.idle = 0
        this.loop()
      }, 66)
    }
  }

  private tick(): void {
    const n = this.nodes
    const cx = this.w / 2 || 400
    const cy = this.h / 2 || 300
    const a = this.alpha
    const s = this.scale
    for (let i = 0; i < n.length; i++) {
      const p = n[i]
      for (let j = i + 1; j < n.length; j++) {
        const q = n[j]
        let dx = q.x - p.x
        let dy = q.y - p.y
        let d2 = dx * dx + dy * dy
        if (d2 < 0.01) {
          dx = Math.random() - 0.5
          dy = Math.random() - 0.5
          d2 = 0.25
        }
        const d = Math.sqrt(d2)
        const both = p.kind === 'project' && q.kind === 'project'
        const strength = (both ? 2600 : 1100) * s * s * a
        const f = strength / d2
        const min = Math.max(p.r, p.half * 0.8) + Math.max(q.r, q.half * 0.8) + (both ? 30 : 18) * s
        const push = d < min ? ((min - d) / d) * 0.5 : 0
        const fx = (dx / d) * f + dx * push
        const fy = (dy / d) * f + dy * push
        p.vx -= fx
        p.vy -= fy
        q.vx += fx
        q.vy += fy
      }
    }
    const spring = (x: Node, y: Node, target: number, k0: number) => {
      const dx = y.x - x.x
      const dy = y.y - x.y
      const d = Math.sqrt(dx * dx + dy * dy) || 1
      const k = ((d - target) / d) * k0 * a
      x.vx += dx * k
      x.vy += dy * k
      y.vx -= dx * k
      y.vy -= dy * k
    }
    for (const l of this.spokes) spring(l.a, l.b, (70 + l.a.r * 1.4) * s, 0.06)
    for (const l of this.arrows) spring(l.a, l.b, (l.b.kind === 'ext' ? 130 : 150) * s, 0.05)
    // domains: members drift toward their centroid
    for (const d of this.domainList) {
      const members = d.members.map((m) => n.find((x) => x.id === `p:${m}`)).filter(Boolean) as Node[]
      if (members.length < 2) continue
      const mx = members.reduce((t, m) => t + m.x, 0) / members.length
      const my = members.reduce((t, m) => t + m.y, 0) / members.length
      for (const m of members) {
        m.vx += (mx - m.x) * 0.03 * a
        m.vy += (my - m.y) * 0.03 * a
      }
      // projects outside the domain are pushed out of its zone, so the zone never claims a stranger
      const reach = Math.max(...members.map((m) => Math.hypot(m.x - mx, m.y - my) + m.r)) + 48 * s
      for (const o of n) {
        if (o.kind !== 'project' || members.includes(o)) continue
        const dx = o.x - mx
        const dy = o.y - my
        const d = Math.hypot(dx, dy) || 1
        if (d < reach + o.r) {
          const k = ((reach + o.r - d) / d) * 0.12 * Math.max(a, 0.05)
          o.vx += dx * k
          o.vy += dy * k
        }
      }
    }
    for (const p of n) {
      p.vx += (cx - p.x) * 0.006 * a
      p.vy += (cy - p.y) * 0.009 * a
      if (p.fixed) {
        p.vx = p.vy = 0
        continue
      }
      p.vx *= 0.62
      p.vy *= 0.62
      p.x += p.vx
      p.y += p.vy
      if (this.w) {
        const left = p.kind === 'project' ? Math.max(32, p.half + 12) : 16
        const right = p.kind === 'project' ? Math.max(32, p.half + 12) : p.half * 2 + 8
        p.x = Math.max(left, Math.min(this.w - right, p.x))
        p.y = Math.max(40, Math.min(this.h - 80, p.y))
      }
    }
    this.alpha *= 0.965
  }

  private stateColor(s: StateKey): string {
    return this.colors[s] ?? this.colors.muted
  }

  /** Padded convex hull around a domain's stars (8 points on a circle around each, then monotone chain). */
  private hull(members: Node[]): [number, number][] {
    const pts: [number, number][] = []
    for (const m of members) {
      const pad = m.r + 22
      for (let k = 0; k < 12; k++) {
        const t = (k / 12) * Math.PI * 2
        pts.push([m.x + Math.cos(t) * pad, m.y + Math.sin(t) * pad])
      }
      pts.push([m.x - m.half - 4, m.y + m.r + 24], [m.x + m.half + 4, m.y + m.r + 24])
    }
    pts.sort((p, q) => p[0] - q[0] || p[1] - q[1])
    const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    const lower: [number, number][] = []
    for (const p of pts) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop()
      lower.push(p)
    }
    const upper: [number, number][] = []
    for (const p of pts.slice().reverse()) {
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop()
      upper.push(p)
    }
    return lower.slice(0, -1).concat(upper.slice(0, -1))
  }

  draw(): void {
    const { ctx, colors: c } = this
    if (!this.w) return
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    ctx.clearRect(0, 0, this.w, this.h)
    const font = this.fontFamily || getComputedStyle(document.body).fontFamily
    const hoverSpokeHub = this.hover && (this.hover.kind === 'tech' || this.hover.kind === 'dep') ? this.hover : null
    // hubs linked to a visible project: computed once per frame, not once per node
    let shownHubs: Set<Node> | null = null
    const filtered = (node: Node): boolean => {
      if (!this.visible) return true
      if (node.kind === 'project') return this.visible.has(node.id)
      if (!shownHubs) {
        shownHubs = new Set()
        for (const l of this.spokes) if (this.visible.has(l.a.id)) shownHubs.add(l.b)
        for (const l of this.arrows) if (this.visible.has(l.a.id)) shownHubs.add(l.b)
      }
      return shownHubs.has(node)
    }
    // alpha for a node: filter dims to 0.28, focus dims what is outside the neighbourhood
    const dim = (id: string, base: number): number => {
      if (!this.focus || this.focusMix === 0) return base
      return this.focus.has(id) ? base : base * (1 - 0.72 * this.focusMix)
    }
    const nodeAlpha = (n: Node) => dim(n.id, filtered(n) ? 1 : 0.28)

    // domain zones
    this.hulls = []
    ctx.textBaseline = 'middle'
    for (const d of this.domainList) {
      const members = d.members.map((m) => this.nodes.find((x) => x.id === `p:${m}`)).filter(Boolean) as Node[]
      if (!members.length) continue
      const pts = this.hull(members)
      this.hulls.push({ d, pts })
      const hot = this.hoverDomain === d.id
      ctx.globalAlpha = dim(`d:${d.id}`, 1)
      ctx.beginPath()
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
      ctx.closePath()
      ctx.lineJoin = 'round'
      ctx.lineWidth = 16
      ctx.strokeStyle = withAlpha(c.quiet, hot ? 0.55 : 0.32)
      ctx.fillStyle = withAlpha(c.quiet, hot ? 0.55 : 0.32)
      ctx.stroke()
      ctx.fill()
      ctx.lineWidth = 1
      ctx.strokeStyle = withAlpha(c.border, hot ? 1 : 0.55)
      ctx.stroke()
      // label sits just above the zone's highest point
      const top = pts.reduce((m, p) => (p[1] < m[1] ? p : m), pts[0])
      ctx.font = `600 12px ${font}`
      ctx.textAlign = 'center'
      ctx.lineWidth = 4
      ctx.strokeStyle = c.bg
      ctx.strokeText(d.label, top[0], top[1] - 18)
      ctx.fillStyle = hot ? c.fg : c.muted
      ctx.fillText(d.label, top[0], top[1] - 18)
    }

    // spokes to technologies or dependencies
    for (const l of this.spokes) {
      const on = hoverSpokeHub ? l.b === hoverSpokeHub : filtered(l.a)
      const sel = this.selected === l.a.id
      ctx.globalAlpha = dim(l.a.id, sel || (hoverSpokeHub && on) ? 0.6 : on ? 0.85 : 0.3)
      ctx.strokeStyle = sel || (hoverSpokeHub && on) ? c.fg : c.border
      ctx.lineWidth = 1
      ctx.setLineDash(l.odd ? [4, 3] : [])
      ctx.beginPath()
      ctx.moveTo(l.a.x, l.a.y)
      ctx.lineTo(l.b.x, l.b.y)
      ctx.stroke()
    }
    ctx.setLineDash([])

    // typed links between projects (and to external systems)
    for (const l of this.arrows) {
      const end = this.hover === l.a || this.hover === l.b || this.selected === l.a.id || this.selected === l.b.id
      ctx.globalAlpha = Math.min(nodeAlpha(l.a), nodeAlpha(l.b)) * (end ? 1 : 0.85)
      ctx.strokeStyle = end ? c.fg : c.muted
      ctx.lineWidth = l.type === 'related' ? 1 : 1.5
      ctx.setLineDash(l.type === 'follows' ? [1.5, 4] : l.type === 'replaces' ? [6, 4] : [])
      ctx.lineCap = l.type === 'follows' ? 'round' : 'butt'
      const { sx, sy, ex, ey, qx, qy } = this.arrowPath(l)
      ctx.beginPath()
      ctx.moveTo(sx, sy)
      ctx.quadraticCurveTo(qx, qy, ex, ey)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.lineCap = 'butt'
      // arrowhead along the curve's end tangent
      const ang = Math.atan2(ey - qy, ex - qx)
      ctx.fillStyle = end ? c.fg : c.muted
      ctx.beginPath()
      ctx.moveTo(ex, ey)
      ctx.lineTo(ex - 7 * Math.cos(ang - 0.4), ey - 7 * Math.sin(ang - 0.4))
      ctx.lineTo(ex - 7 * Math.cos(ang + 0.4), ey - 7 * Math.sin(ang + 0.4))
      ctx.closePath()
      ctx.fill()
      if (end) {
        const mx = 0.25 * sx + 0.5 * qx + 0.25 * ex
        const my = 0.25 * sy + 0.5 * qy + 0.25 * ey
        ctx.font = `500 11px ${font}`
        ctx.textAlign = 'center'
        ctx.lineWidth = 4
        ctx.lineJoin = 'round'
        ctx.strokeStyle = c.bg
        ctx.strokeText(LINK_WORD[l.type], mx, my)
        ctx.fillStyle = c.fg
        ctx.fillText(LINK_WORD[l.type], mx, my)
      }
    }

    // technologies, dependencies, external systems
    for (const n of this.nodes) {
      if (n.kind === 'project') continue
      const hot = n === this.hover
      ctx.globalAlpha = nodeAlpha(n)
      if (n.kind === 'ext') {
        ctx.strokeStyle = hot ? c.fg : c.muted
        ctx.lineWidth = 1.25
        ctx.beginPath()
        ctx.arc(n.x, n.y, hot ? 5 : n.r, 0, Math.PI * 2)
        ctx.stroke()
      } else {
        ctx.fillStyle = hot ? c.fg : c.muted
        ctx.beginPath()
        ctx.arc(n.x, n.y, hot ? n.r + 1 : n.r, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.font = `${n.kind === 'ext' ? 'italic ' : ''}500 11px ${font}`
      ctx.textAlign = 'left'
      ctx.lineWidth = 4
      ctx.lineJoin = 'round'
      ctx.strokeStyle = c.bg
      ctx.strokeText(n.label, n.x + n.r + 5, n.y)
      ctx.fillStyle = hot ? c.fg : c.muted
      ctx.fillText(n.label, n.x + n.r + 5, n.y)
    }

    // projects
    ctx.font = `600 12px ${font}`
    for (const n of this.nodes) {
      if (n.kind !== 'project') continue
      const sel = this.selected === n.id
      const hot = n === this.hover
      const waiting = n.states.length > 0
      ctx.globalAlpha = nodeAlpha(n)

      const release = n.states.filter((s) => s !== 'dirty')
      if (release.length) {
        // corona: only release work (unpushed, unreleased, stale recipe) burns; unsaved files are
        // everyday work and keep just their ring, so the stars that need a release stand out
        const lead = this.stateColor(release[0])
        const g = ctx.createRadialGradient(n.x, n.y, n.r, n.x, n.y, n.r * 2.6)
        g.addColorStop(0, withAlpha(lead, 0.22))
        g.addColorStop(1, withAlpha(lead, 0))
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.arc(n.x, n.y, n.r * 2.6, 0, Math.PI * 2)
        ctx.fill()
      }

      ctx.fillStyle = c.card
      ctx.strokeStyle = waiting ? c.fg : c.border
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2)
      ctx.fill()
      if (!waiting) {
        ctx.stroke()
        ctx.fillStyle = withAlpha(c.clean, 0.9)
        ctx.beginPath()
        ctx.arc(n.x, n.y, Math.max(2.5, n.r * 0.22), 0, Math.PI * 2)
        ctx.fill()
      } else {
        ctx.fillStyle = withAlpha(c.fg, 0.08)
        ctx.fill()
      }

      if (waiting) {
        const seg = (Math.PI * 2) / n.states.length
        const gap = n.states.length > 1 ? 0.22 : 0
        ctx.lineWidth = 3.5
        ctx.lineCap = 'round'
        n.states.forEach((s, i) => {
          ctx.strokeStyle = this.stateColor(s)
          ctx.beginPath()
          const start = -Math.PI / 2 + i * seg + gap / 2
          ctx.arc(n.x, n.y, n.r + 4, start, start + seg - gap)
          ctx.stroke()
        })
        ctx.lineCap = 'butt'
      }

      if (sel || hot) {
        ctx.strokeStyle = c.fg
        ctx.lineWidth = sel ? 1.5 : 1
        ctx.setLineDash(sel ? [] : [3, 3])
        ctx.beginPath()
        ctx.arc(n.x, n.y, n.r + 9, 0, Math.PI * 2)
        ctx.stroke()
        ctx.setLineDash([])
      }

      // badges: an agent waiting for the user (top right), something running (bottom right)
      const live = n.project?.live
      if (live?.waiting) {
        const bx = n.x + n.r * 0.78, by = n.y - n.r * 0.78
        ctx.fillStyle = c.bg
        ctx.beginPath()
        ctx.arc(bx, by, 6.5, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = this.colors.agent
        ctx.beginPath()
        ctx.arc(bx, by, 5, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = c.bg
        ctx.fillRect(bx - 0.9, by - 3, 1.8, 3.6)
        ctx.fillRect(bx - 0.9, by + 1.4, 1.8, 1.6)
      }
      if (live?.running) {
        const bx = n.x + n.r * 0.78, by = n.y + n.r * 0.78
        ctx.fillStyle = c.bg
        ctx.beginPath()
        ctx.arc(bx, by, 5, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = c.clean
        ctx.beginPath()
        ctx.arc(bx, by, 3.5, 0, Math.PI * 2)
        ctx.fill()
      }

      ctx.textAlign = 'center'
      const ly = n.y + n.r + (waiting ? 18 : 14)
      ctx.lineWidth = 4
      ctx.strokeStyle = c.bg
      ctx.lineJoin = 'round'
      ctx.strokeText(n.label, n.x, ly)
      ctx.fillStyle = waiting || sel ? c.fg : c.muted
      ctx.fillText(n.label, n.x, ly)
    }
    ctx.globalAlpha = 1
    this.drawEffects()
  }

  private drawEffects(): void {
    const { ctx } = this
    const now = performance.now()
    this.fx = this.fx.filter((f) => now - f.t0 < (f.kind === 'launch' ? LAUNCH_MS : LAND_MS))
    for (const [id, p] of this.pending) {
      const n = this.nodes.find((x) => x.id === id)
      if (!n) continue
      // under way: constant motion, so linear; reduced motion keeps a still marker at the top
      const a = this.reduced ? -Math.PI / 2 : -Math.PI / 2 + (((now - p.t0) % ORBIT_MS) / ORBIT_MS) * Math.PI * 2
      const R = n.r + 9
      ctx.fillStyle = p.color
      ctx.globalAlpha = 0.95
      ctx.beginPath()
      ctx.arc(n.x + Math.cos(a) * R, n.y + Math.sin(a) * R, 3, 0, Math.PI * 2)
      ctx.fill()
      if (!this.reduced) {
        ctx.strokeStyle = p.color
        ctx.lineWidth = 2
        ctx.lineCap = 'round'
        ctx.globalAlpha = 0.35
        ctx.beginPath()
        ctx.arc(n.x, n.y, R, a - 0.9, a)
        ctx.stroke()
        ctx.lineCap = 'butt'
      }
    }
    for (const f of this.fx) {
      const n = this.nodes.find((x) => x.id === f.id)
      if (!n) continue
      const t = now - f.t0
      if (f.kind === 'launch') {
        if (this.reduced) {
          // feedback without movement: the ring brightens and fades in place
          ctx.globalAlpha = 0.8 * (1 - clamp01(t / 300))
          ctx.strokeStyle = f.color
          ctx.lineWidth = 2
          ctx.beginPath()
          ctx.arc(n.x, n.y, n.r + 6, 0, Math.PI * 2)
          ctx.stroke()
          continue
        }
        // pulse: 600 ms, ease-out, from the ring outwards (never from nothing)
        const pk = easeOut(clamp01(t / 600))
        ctx.globalAlpha = 0.7 * (1 - pk)
        ctx.strokeStyle = f.color
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.arc(n.x, n.y, n.r + 4 + pk * 22, 0, Math.PI * 2)
        ctx.stroke()
        // comet: leaves the top of the star and rises, its trail fading behind it
        const ck = easeOut(clamp01(t / LAUNCH_MS))
        const y0 = n.y - n.r - 4
        const y = y0 - ck * (46 + n.r)
        const fade = 1 - clamp01((t - LAUNCH_MS * 0.55) / (LAUNCH_MS * 0.45))
        const g = ctx.createLinearGradient(n.x, y0, n.x, y)
        g.addColorStop(0, withAlpha(f.color, 0))
        g.addColorStop(1, withAlpha(f.color, 0.9))
        ctx.globalAlpha = fade
        ctx.strokeStyle = g
        ctx.lineWidth = 2.5
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.moveTo(n.x, Math.min(y0, y + 26))
        ctx.lineTo(n.x, y)
        ctx.stroke()
        ctx.lineCap = 'butt'
        ctx.fillStyle = f.color
        ctx.beginPath()
        ctx.arc(n.x, y, 3.2, 0, Math.PI * 2)
        ctx.fill()
      } else {
        // landing: two waves 90 ms apart, then a check that draws itself and fades
        if (!this.reduced) {
          for (const delay of [0, 90]) {
            const k = easeOut(clamp01((t - delay) / 900))
            if (t < delay) continue
            ctx.globalAlpha = 0.65 * (1 - k)
            ctx.strokeStyle = f.color
            ctx.lineWidth = 2
            ctx.beginPath()
            ctx.arc(n.x, n.y, n.r + 4 + k * 38, 0, Math.PI * 2)
            ctx.stroke()
          }
        }
        const draw = this.reduced ? 1 : easeOut(clamp01((t - 120) / 300))
        const out = 1 - clamp01((t - 900) / 400)
        if (draw <= 0) continue
        const s = Math.max(5, n.r * 0.45)
        const pts: [number, number][] = [
          [n.x - s, n.y],
          [n.x - s * 0.3, n.y + s * 0.65],
          [n.x + s, n.y - s * 0.6]
        ]
        const l1 = Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1])
        const l2 = Math.hypot(pts[2][0] - pts[1][0], pts[2][1] - pts[1][1])
        let left = draw * (l1 + l2)
        ctx.globalAlpha = out
        ctx.strokeStyle = f.color
        ctx.lineWidth = 2.5
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.beginPath()
        ctx.moveTo(pts[0][0], pts[0][1])
        const k1 = Math.min(1, left / l1)
        ctx.lineTo(pts[0][0] + (pts[1][0] - pts[0][0]) * k1, pts[0][1] + (pts[1][1] - pts[0][1]) * k1)
        left -= l1
        if (left > 0) {
          const k2 = Math.min(1, left / l2)
          ctx.lineTo(pts[1][0] + (pts[2][0] - pts[1][0]) * k2, pts[1][1] + (pts[2][1] - pts[1][1]) * k2)
        }
        ctx.stroke()
        ctx.lineCap = 'butt'
      }
    }
    ctx.globalAlpha = 1
  }

  /** Start/end on the circles' rims, control point offset by `bend` for mutual pairs. */
  private arrowPath(l: Arrow) {
    const dx = l.b.x - l.a.x
    const dy = l.b.y - l.a.y
    const d = Math.hypot(dx, dy) || 1
    const ux = dx / d
    const uy = dy / d
    const sx = l.a.x + ux * (l.a.r + 6)
    const sy = l.a.y + uy * (l.a.r + 6)
    const ex = l.b.x - ux * (l.b.r + (l.b.kind === 'project' ? 9 : 4))
    const ey = l.b.y - uy * (l.b.r + (l.b.kind === 'project' ? 9 : 4))
    const q = curveControl({ x: sx, y: sy }, { x: ex, y: ey }, l.bend)
    return { sx, sy, ex, ey, qx: q.x, qy: q.y }
  }

  private point(e: PointerEvent): [number, number] {
    const rect = this.canvas.getBoundingClientRect()
    return [e.clientX - rect.left, e.clientY - rect.top]
  }

  private at(e: PointerEvent): Node | null {
    const [x, y] = this.point(e)
    let best: Node | null = null
    let bestD = Infinity
    for (const n of this.nodes) {
      const reach = n.kind === 'project' ? n.r + 8 : 10
      const d = Math.hypot(n.x - x, n.y - y)
      if (d < reach && d < bestD) {
        best = n
        bestD = d
      }
    }
    return best
  }

  private domainAt(e: PointerEvent): string | null {
    const [x, y] = this.point(e)
    for (const { d, pts } of this.hulls) {
      let inside = false
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i]
        const [xj, yj] = pts[j]
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
      }
      if (inside) return d.id
    }
    return null
  }

  private setHover(n: Node | null, domain: string | null): void {
    if (n === this.hover && domain === this.hoverDomain) return
    this.hover = n
    this.hoverDomain = n ? null : domain
    this.canvas.classList.toggle('hot', !!n || !!domain)
    const focusId = n && (n.kind === 'project' || n.kind === 'ext') ? n.id : !n && domain ? `d:${domain}` : null
    if (focusId) {
      this.focus = neighbourhood(this.edgeList, focusId, this.domainList)
      if (n?.kind === 'project') for (const s of this.spokes) if (s.a === n) this.focus.add(s.b.id)
      this.focusTarget = 1
    } else {
      this.focusTarget = 0
    }
    this.loop()
  }

  private onMove(e: PointerEvent): void {
    if (this.drag && e.pointerId === this.drag.id) {
      const [x, y] = this.point(e)
      const n = this.drag.node
      if (Math.hypot(x - this.drag.sx, y - this.drag.sy) > 3) {
        this.drag.moved = true
        this.canvas.classList.add('dragging')
      }
      n.x = x
      n.y = y
      this.kick(0.25)
      return
    }
    const n = this.at(e)
    this.setHover(n, n ? null : this.domainAt(e))
  }

  private onDown(e: PointerEvent): void {
    if (this.drag || e.button !== 0) return
    const n = this.at(e)
    if (!n) return
    const [sx, sy] = this.point(e)
    this.drag = { node: n, id: e.pointerId, moved: false, sx, sy }
    n.fixed = true
    this.canvas.setPointerCapture(e.pointerId)
  }

  private onUp(e: PointerEvent): void {
    if (!this.drag || e.pointerId !== this.drag.id) {
      if (this.at(e)) return
      const d = this.domainAt(e)
      if (d) this.opts.onPickDomain(d)
      else this.opts.onSelect(null)
      return
    }
    const { node, moved } = this.drag
    this.endDrag()
    if (moved) return
    if (node.kind === 'project') this.opts.onSelect(node.project ?? null)
    if (node.kind === 'tech') this.opts.onPickTech(node.id.slice(2))
    if (node.kind === 'dep') this.opts.onPickDep(node.id.slice(2))
  }

  private endDrag(): void {
    if (!this.drag) return
    const moved = this.drag.moved
    this.drag.node.fixed = false
    try {
      this.canvas.releasePointerCapture(this.drag.id)
    } catch {
      // already released
    }
    this.drag = null
    this.canvas.classList.remove('dragging')
    this.kick(0.35) // let go: the star springs back into the settled layout
    if (moved) this.saveLayout()
  }
}

const probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!
probe.canvas.width = probe.canvas.height = 1

/** Any CSS colour (hsl, oklch, named…) as `#rrggbb`, read back from a 1px canvas. */
function toRgb(color: string): string {
  probe.clearRect(0, 0, 1, 1)
  probe.fillStyle = '#000'
  probe.fillStyle = color
  probe.fillRect(0, 0, 1, 1)
  const [r, g, b] = probe.getImageData(0, 0, 1, 1).data
  return '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('')
}

/** `#rrggbb` plus alpha for canvas fills and gradients. */
function withAlpha(color: string, a: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(color.trim())
  if (m) {
    const v = parseInt(m[1], 16)
    return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${a})`
  }
  return color
}
