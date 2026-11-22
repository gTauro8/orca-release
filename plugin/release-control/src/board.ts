// Release Control board: the full-width editor tab. Talks only to its own worker
// (orca.plugin.request); the worker launches agents and opens workspaces.
import { activityChart, esc, weekBars } from './charts'
import { Constellation, techLabel, type Layer, type Positions } from './constellation'
import { depGrid, depRows, domains, edges, INCOMING_LABEL, incoming, LINK_LABEL, recipeId } from './graph'
import { ACTION_LABEL, actionRequest, attention, counts, groupEndpoints, methodCounts, states, type ActionRequest, type Attention, type DocEntry, type GraphSummary, type Project, type ProjectInfo, type Snapshot, type StateKey, type Launch, landed } from './model'
import { renderMarkdown } from './markdown'
import { allAttention, cleanupCount, isRunning, LOG_ERROR, needsYou, standupText, type Hit, type StandupRow } from './work'
import { CSS } from './styles'
import './protocol'

declare const orca: any

type Filter = 'all' | 'attention' | 'dirty' | 'unpushed' | 'behind' | 'unreleased' | 'recipe'

const STATE_NAME: Record<StateKey, string> = {
  dirty: 'Uncommitted',
  unpushed: 'To push',
  behind: 'To pull',
  unreleased: 'To release',
  recipe: 'Recipe out of date',
  missing: 'Folder not found',
  agent: 'Agent waiting',
  review: 'Review or CI'
}
const STATE_VAR: Record<StateKey, string> = {
  dirty: 'var(--rc-dirty)',
  unpushed: 'var(--rc-unpushed)',
  behind: 'var(--rc-behind)',
  unreleased: 'var(--rc-unreleased)',
  recipe: 'var(--rc-recipe)',
  missing: 'var(--rc-missing)',
  agent: 'var(--rc-agent)',
  review: 'var(--rc-review)'
}

const ICON = {
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5v6h-6"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  open: '<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  back: '<path d="M15 6l-6 6 6 6"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a1 1 0 0 1 1-1h10"/>',
  expand: '<path d="M4 9V4h5M20 15v5h-5M4 4l6 6M20 20l-6-6"/>',
  logs: '<path d="M4 6h16M4 12h10M4 18h13"/>'
}
const icon = (k: keyof typeof ICON, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICON[k]}</svg>`

const state = {
  snap: null as Snapshot | null,
  loading: false,
  filter: 'all' as Filter,
  tech: '' as string,
  selected: null as string | null,
  lit: null as string | null,
  graph: new Map<string, GraphSummary | null | 'loading'>(),
  /** New-task text per project: what you typed for one never goes to another. */
  drafts: new Map<string, string>(),
  busy: new Set<string>(),
  layer: 'tech' as Layer,
  showTech: false,
  positions: {} as Positions,
  /** Drawer focus other than a project: a domain or a shared dependency. */
  domain: null as string | null,
  dep: null as string | null,
  /** Project page: which tab, the loaded info per project, the open document, API search. */
  tab: 'overview' as Tab,
  info: new Map<string, ProjectInfo | null | 'loading'>(),
  doc: null as { path: string; rel: string; text: string | null | 'loading' } | null,
  apiQuery: '',
  apiMethod: '',
  /** Push/deploy presses waiting to land: project path -> what it looked like at the press. */
  launches: new Map<string, Launch>(),
  /** Global search. */
  query: '',
  hits: null as Hit[] | null | 'loading',
  /** Standup. */
  standup: null as { rows: StandupRow[]; since: string } | 'loading' | null,
  standupSince: 'yesterday 00:00',
  /** A destructive button pressed once: the key waiting for the second press. */
  confirm: null as string | null,
  /** Open log viewer: which project and source, the last lines, errors only or everything. */
  logs: null as { path: string; source: string; title: string; lines: string[] | null; error: string | null; onlyErrors: boolean } | null
}
type Tab = 'overview' | 'docs' | 'api' | 'setup'

// ---------- shell ----------
const style = document.createElement('style')
style.textContent = CSS
document.head.append(style)
document.body.innerHTML = `
<div class="app">
  <header class="bar">
    <h1>Release Control</h1>
    <div class="chips" role="toolbar" aria-label="Filter the projects"></div>
    <div class="spacer"></div>
    <input class="search top" type="search" id="q" placeholder="Search docs, endpoints, scripts, env… (/)" aria-label="Search every project" autocomplete="off">
    <select class="select" aria-label="Technology or domain"></select>
    <div class="fresh"><span class="muted num" id="ago"></span>
      <button class="btn sm ghost" id="refresh" aria-label="Refresh data">${icon('refresh')}</button>
      <button class="btn sm" id="fetch" title="git fetch every project, so “to pull” and “to push” are current">Fetch</button>
      <button class="btn sm" id="status" title="Print the status table in a terminal of the data folder">Status</button>
    </div>
  </header>
  <div class="main">
    <section class="map" aria-label="Project constellation">
      <canvas role="img"></canvas>
      <div class="maphint" hidden></div>
      <div class="seg" role="group" aria-label="Map layer">
        <button data-layer="tech" aria-pressed="true">Technologies</button><button data-layer="deps" aria-pressed="false">Dependencies</button>
      </div>
      <div class="mapnote muted" hidden></div>
      <div class="mapctl">
        <button class="btn sm ghost" id="techtoggle" hidden aria-pressed="false">Show technologies</button>
        <button class="btn sm ghost" id="rearrange" title="Forget the saved positions and lay the map out again">Re-arrange</button>
      </div>
      <div class="legend" aria-hidden="true">
        <span style="--c:var(--rc-dirty)"><i></i>uncommitted</span>
        <span style="--c:var(--rc-unpushed)"><i></i>to push</span>
        <span style="--c:var(--rc-behind)"><i></i>to pull</span>
        <span style="--c:var(--rc-unreleased)"><i></i>to release</span>
        <span style="--c:var(--rc-recipe)"><i></i>recipe</span>
        <span style="--c:var(--rc-clean)"><i></i>clean</span>
      </div>
      <div class="toast" role="status" aria-live="polite" hidden></div>
    </section>
    <aside class="drawer" aria-label="Details"><div class="drawer-inner"></div></aside>
  </div>
</div>`

const $ = <T extends Element>(s: string) => document.querySelector(s) as T
const chipsEl = $<HTMLDivElement>('.chips')
const techEl = $<HTMLSelectElement>('.select')
const agoEl = $<HTMLSpanElement>('#ago')
const refreshBtn = $<HTMLButtonElement>('#refresh')
const drawer = $<HTMLDivElement>('.drawer-inner')
const hint = $<HTMLDivElement>('.maphint')
const toastEl = $<HTMLDivElement>('.toast')
const canvas = $<HTMLCanvasElement>('canvas')

let positionsTimer = 0
const sky = new Constellation(canvas, {
  onSelect: (p) => select(p?.path ?? null),
  onPickTech: (t) => {
    state.tech = state.tech === t ? '' : t
    applyFilter()
  },
  onPickDep: (name) => focusOther('dep', name),
  onPickDomain: (id) => focusOther('domain', id),
  onLayout: (positions) => {
    state.positions = positions
    clearTimeout(positionsTimer)
    positionsTimer = window.setTimeout(() => void orca.plugin.request('rc.positions.set', positions).catch(() => undefined), 300)
  }
})
const techToggle = $<HTMLButtonElement>('#techtoggle')
const segEl = $<HTMLDivElement>('.seg')
const mapNote = $<HTMLDivElement>('.mapnote')

function syncSeg(): void {
  for (const b of segEl.querySelectorAll<HTMLButtonElement>('[data-layer]')) b.setAttribute('aria-pressed', String(b.dataset.layer === state.layer))
}

function refreshSky(): void {
  const ps = projects()
  const linked = sky.hasLinks(ps)
  techToggle.hidden = !linked || state.layer !== 'tech'
  techToggle.setAttribute('aria-pressed', String(state.showTech))
  techToggle.textContent = state.showTech ? 'Hide technologies' : 'Show technologies'
  syncSeg()
  sky.setData(ps, { layer: state.layer, showTech: state.showTech || !linked, shared: state.snap?.shared_deps, positions: state.positions })
  const shared = state.snap?.shared_deps ?? {}
  const split = Object.values(shared).filter((v) => new Set(Object.values(v)).size > 1).length
  mapNote.hidden = state.layer !== 'deps'
  mapNote.textContent = split
    ? `Showing the ${split} shared dependencies whose versions differ · all ${Object.keys(shared).length} are in the table`
    : `All ${Object.keys(shared).length} shared dependencies are on the same versions`
}

function focusOther(kind: 'domain' | 'dep', id: string): void {
  state.selected = null
  sky.selected = null
  state.domain = kind === 'domain' ? id : null
  state.dep = kind === 'dep' ? id : null
  sky.draw()
  renderDrawer(true)
}

segEl.addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLButtonElement>('[data-layer]')
  if (!b || b.dataset.layer === state.layer) return
  state.layer = b.dataset.layer as Layer
  state.dep = null
  refreshSky()
  renderDrawer(false)
})
techToggle.addEventListener('click', () => {
  state.showTech = !state.showTech
  void orca.storage.set('showTech', state.showTech).catch(() => undefined)
  refreshSky()
})
$<HTMLButtonElement>('#rearrange').addEventListener('click', () => sky.rearrange())

// ---------- helpers ----------
const projects = () => state.snap?.projects ?? []
const live = () => projects().filter((p) => !p.missing)
const byPath = (path: string | null) => projects().find((p) => p.path === path) ?? null

function matches(p: Project): boolean {
  if (p.missing) return false
  if (state.tech.startsWith('domain:')) {
    if (p.domain !== state.tech.slice(7)) return false
  } else if (state.tech && !(p.stack ?? []).includes(state.tech)) return false
  const s = states(p)
  switch (state.filter) {
    case 'all':
      return true
    case 'attention':
      return s.length > 0
    default:
      return s.includes(state.filter)
  }
}

let toastTimer = 0
function toast(msg: string, ok = true): void {
  toastEl.textContent = msg
  toastEl.classList.toggle('bad', !ok)
  toastEl.hidden = false
  clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => (toastEl.hidden = true), ok ? 3200 : 6000)
}

function relTime(ms: number): string {
  const s = Math.round((Date.now() - ms) / 1000)
  if (s < 45) return 'updated just now'
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
  if (s < 3600) return 'updated ' + rtf.format(-Math.round(s / 60), 'minute')
  if (s < 86400) return 'updated ' + rtf.format(-Math.round(s / 3600), 'hour')
  return 'updated ' + rtf.format(-Math.round(s / 86400), 'day')
}

function inline(md: string): string {
  return esc(md)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/(^|[^\w*])\*([^*\s][^*]*?)\*(?![\w*])/g, '$1<em>$2</em>')
}

async function run(req: ActionRequest, key: string): Promise<void> {
  if (state.busy.has(key)) return
  state.busy.add(key)
  renderDrawer(false)
  try {
    const res = await orca.plugin.request('rc.action', req, { timeoutMs: req.action === 'fetch' ? 120_000 : 60_000 })
    toast(res.message, res.ok)
    const p = byPath(req.path ?? null)
    // a rollback brings no new tag and nothing to release: it would orbit until the 20-minute timeout
    if (res.ok && p && (req.action === 'push' || (req.action === 'deploy' && !req.text))) {
      state.launches.set(p.path, { kind: req.action, at: Date.now(), ahead: p.ahead ?? 0, dirty: p.dirty ?? 0, tag: p.tag ?? null, since: p.since ?? 0 })
      sky.launch(p.path, req.action)
    }
    if (res.ok && req.action === 'prompt' && req.path) state.drafts.delete(req.path)
  } catch (err: any) {
    toast(`Did not start: ${err?.message ?? err}`, false)
  } finally {
    state.busy.delete(key)
    renderDrawer(false)
  }
}

// ---------- header ----------
function renderBar(): void {
  const c = counts(projects())
  const chip = (f: Filter, label: string, n: number, color?: string) =>
    `<button class="chip" data-filter="${f}" aria-pressed="${state.filter === f}" ${n || f === 'all' ? '' : 'disabled'}>` +
    `${color ? `<span class="dot" style="--c:${color}"></span>` : ''}${label} <b>${n}</b></button>`
  chipsEl.innerHTML =
    chip('all', 'All', c.all) +
    chip('attention', 'Needs attention', c.attention, 'var(--orca-foreground)') +
    chip('dirty', 'Uncommitted', c.dirty, STATE_VAR.dirty) +
    chip('unpushed', 'To push', c.unpushed, STATE_VAR.unpushed) +
    chip('behind', 'To pull', c.behind, STATE_VAR.behind) +
    chip('unreleased', 'To release', c.unreleased, STATE_VAR.unreleased) +
    chip('recipe', 'Recipes', c.recipe, STATE_VAR.recipe)
  const techs = [...new Set(live().flatMap((p) => p.stack ?? []))].sort()
  const doms = domains(projects())
  const opt = (v: string, label: string) => `<option value="${esc(v)}" ${v === state.tech ? 'selected' : ''}>${esc(label)}</option>`
  techEl.innerHTML =
    `<option value="">All projects</option>` +
    (doms.length ? `<optgroup label="Domains">${doms.map((d) => opt(`domain:${d.id}`, d.label)).join('')}</optgroup>` : '') +
    (techs.length ? `<optgroup label="Technologies">${techs.map((x) => opt(x, techLabel(x))).join('')}</optgroup>` : '')
  techEl.hidden = techs.length === 0 && doms.length === 0
  syncSeg()
  renderAgo()
}

function renderAgo(): void {
  agoEl.textContent = state.loading ? 'updating…' : state.snap ? relTime(state.snap.at) : ''
  refreshBtn.innerHTML = icon('refresh', state.loading ? 'spin' : '')
  refreshBtn.setAttribute('aria-busy', String(state.loading))
}

chipsEl.addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLButtonElement>('[data-filter]')
  if (!b || b.disabled) return
  state.filter = b.dataset.filter as Filter
  applyFilter()
})
techEl.addEventListener('change', () => {
  state.tech = techEl.value
  applyFilter()
})
refreshBtn.addEventListener('click', () => void load(true))
$<HTMLButtonElement>('#status').addEventListener('click', () => void run({ action: 'status' }, 'status'))
$<HTMLButtonElement>('#fetch').addEventListener('click', async (e) => {
  const b = e.currentTarget as HTMLButtonElement
  b.disabled = true
  b.setAttribute('aria-busy', 'true')
  try {
    await run({ action: 'fetch' }, 'fetch')
  } finally {
    b.disabled = false
    b.removeAttribute('aria-busy')
  }
})

function applyFilter(): void {
  const vis = state.filter === 'all' && !state.tech ? null : new Set(live().filter(matches).map((p) => `p:${p.path}`))
  sky.visible = vis
  sky.draw()
  renderBar()
  if (!state.selected) renderDrawer(false)
}

// ---------- drawer ----------
function select(path: string | null, animate = true): void {
  if (path === state.selected && !state.domain && !state.dep) return
  state.domain = null
  state.dep = null
  state.selected = path
  // the logs belong to the project that was open: picking another one shows it, not the old logs
  if (state.logs && state.logs.path !== path) {
    logsGen++
    window.clearTimeout(logsTimer)
    state.logs = null
  }
  sky.selected = path ? `p:${path}` : null
  sky.draw()
  renderDrawer(animate)
  const p = byPath(path)
  if (state.doc && state.doc.path !== path) state.doc = null
  layoutWide()
  if (p) loadInfo(p.path)
  if (p?.graphify && !state.graph.has(p.path)) {
    state.graph.set(p.path, 'loading')
    orca.plugin
      .request('rc.graph', { path: p.path }, { timeoutMs: 30_000 })
      .then((g: GraphSummary | null) => state.graph.set(p.path, g))
      .catch(() => state.graph.set(p.path, null))
      .finally(() => state.selected === p.path && renderDrawer(false))
  }
}

function attentionRows(items: Attention[], withProject: boolean): string {
  return items
    .map((a) => {
      const key = `${a.path}|${a.action?.id}|${a.action?.target ?? ''}`
      const btn = a.action
        ? `<button class="btn sm" data-run="${esc(a.action.id)}" data-path="${esc(a.path)}" ${a.action.target ? `data-target="${esc(a.action.target)}"` : ''} ${state.busy.has(key) ? 'aria-busy="true" disabled' : ''}>${esc(a.action.label)}</button>`
        : ''
      return `<div class="row${withProject ? ' link' : ''}" ${withProject ? `data-select="${esc(a.path)}"` : ''}>
        <span class="dot" style="--c:${STATE_VAR[a.state]}"></span>
        <div class="what">${withProject ? `<b>${esc(a.project)}</b>` : ''}<span>${esc(a.text)}</span></div>${btn}</div>`
    })
    .join('')
}

function overview(): string {
  const s = state.snap!
  const scoped = live().filter(matches)
  const items = allAttention(s, scoped)
  const now = items.length
    ? `<div class="rows">${attentionRows(items.slice(0, 8), true)}</div>${items.length > 8 ? `<p class="empty">and ${items.length - 8} more: filter or pick a project.</p>` : ''}`
    : `<p class="empty">${state.filter === 'all' && !state.tech ? 'Nothing pending: everything committed, pushed and released.' : 'No project matches this filter.'}</p>`
  const series = scoped
    .filter((p) => (p.weeks ?? []).some(Boolean))
    .map((p) => ({ key: p.path, label: p.name, values: p.weeks ?? [] }))
    .sort((a, b) => b.values.reduce((x, y) => x + y, 0) - a.values.reduce((x, y) => x + y, 0))
  const legend = series
    .slice(0, 8)
    .map((x) => `<button data-lit="${esc(x.key)}" aria-pressed="${state.lit === x.key}"><i></i>${esc(x.label)}</button>`)
    .join('')
  const list = scoped
    .map(
      (p) => `<div class="row link" data-select="${esc(p.path)}" tabindex="0" role="button">
      <span class="dot" style="--c:${states(p).length ? STATE_VAR[states(p)[0]] : 'var(--rc-clean)'}"></span>
      <div class="what"><b>${esc(p.name)}</b><span class="mono">${esc(p.branch ?? '')}</span></div>
      <span class="statedots">${states(p).map((k) => `<i style="--c:${STATE_VAR[k]}" title="${STATE_NAME[k]}"></i>`).join('')}</span></div>`
    )
    .join('')
  const missing = projects().filter((p) => p.missing)
  const report = s.report.items.length
    ? `<ol class="report">${s.report.items.map((i) => `<li>${inline(i)}</li>`).join('')}</ol>`
    : `<p class="empty">No report yet: it arrives on Monday with the automation, or ask for “this week's report” (/weekly-report).</p>`
  const scope = state.filter === 'all' && !state.tech ? null : new Set(scoped.map((p) => p.path))
  return `
    <section class="sec"><h2>Now<span class="count num">${items.length || ''}</span></h2>${now}</section>
    ${agentsSection(scope)}
    ${prsSection(scope)}
    ${runningSection(scope)}
    ${standupSection()}
    ${cleanupSummary(scope)}
    ${state.layer === 'deps' ? gridSection() : ''}
    <section class="sec"><h2>Commits per week</h2>${series.length ? activityChart(series, state.lit) + `<div class="series">${legend}</div>` : '<p class="empty">No commits in the last 12 weeks.</p>'}</section>
    <section class="sec"><h2>Projects<span class="count num">${scoped.length}</span></h2><div class="rows">${list || '<p class="empty">No projects.</p>'}</div>
      ${missing.length ? `<p class="empty">Folders not found: ${missing.map((p) => esc(p.name)).join(', ')}.</p>` : ''}</section>
    <section class="sec"><h2>Monday report${s.report.name ? ` <span class="count">${esc(s.report.name)}</span>` : ''}</h2>${report}</section>`
}

function actionBtn(p: Project, action: ActionRequest['action'], label: string, primary = false, target?: string): string {
  const key = `${p.path}|${action}|${target ?? ''}`
  return `<button class="btn${primary ? ' primary' : ''}" data-run="${action}" data-path="${esc(p.path)}" ${target ? `data-target="${esc(target)}"` : ''} ${state.busy.has(key) ? 'aria-busy="true" disabled' : ''}>${esc(label)}</button>`
}

function detail(p: Project): string {
  const st = states(p)
  const items = state.snap ? allAttention(state.snap, [p]) : attention([p])
  const lead = items[0]?.action?.id
  const acts = [
    (p.behind ?? 0) > 0 ? actionBtn(p, 'pull', ACTION_LABEL.pull, lead === 'pull') : '',
    actionBtn(p, 'push', ACTION_LABEL.push, lead === 'push'),
    actionBtn(p, 'pr', ACTION_LABEL.pr),
    ...(p.targets ?? []).map((t) => actionBtn(p, 'deploy', `Deploy ${t}`, lead === 'deploy' && items[0]?.action?.target === t, t)),
    p.has_dev ? actionBtn(p, 'dev', 'Dev') : '',
    p.compose ? actionBtn(p, 'compose', 'Services') : '',
    p.compose ? actionBtn(p, 'stop', ACTION_LABEL.stop) : '',
    actionBtn(p, 'align', 'Align', lead === 'align')
  ].join('')
  const g = state.graph.get(p.path)
  const graph = !p.graphify
    ? `<p class="empty">No graph for this project yet. Graphify maps files, classes and concepts into communities you can explore.</p><div class="actions">${actionBtn(p, 'graphify', 'Build the graph')}</div>`
    : g === 'loading' || g === undefined
      ? '<div class="skel" style="width:70%"></div><div class="skel" style="width:55%"></div>'
      : g === null
        ? '<p class="empty">Could not read the graph.</p>'
        : graphView(p, g)
  const wt = (p.dirty_worktrees ?? []).length
    ? `<dt>Worktree</dt><dd>${(p.dirty_worktrees ?? []).map((w) => `<span class="mono">${esc(w.branch)}</span> · ${w.dirty} uncommitted`).join('<br>')}</dd>`
    : ''
  const head = `<div class="head"><div class="grow"><h2>${esc(p.name)}</h2><div class="path mono">${esc(p.path)}</div></div>
      <button class="btn sm ghost" data-close aria-label="Close (Esc)">${icon('close')}</button></div>`
  const info = state.info.get(p.path)
  const ready = info && info !== 'loading' ? info : null
  const tab = (id: Tab, label: string, n?: number) =>
    `<button role="tab" class="tab" data-tab="${id}" aria-selected="${state.tab === id}" ${state.tab === id ? '' : 'tabindex="-1"'}>${label}${n ? `<span class="count num">${n}</span>` : ''}</button>`
  const tabs = `<div class="tabs" role="tablist" aria-label="Project page">${tab('overview', 'Overview')}${tab('docs', 'Docs', ready?.docs.length)}${tab('api', 'API', ready?.api.length)}${tab('setup', 'Setup', ready ? ready.scripts.length + ready.env.length : undefined)}</div>`
  if (state.tab !== 'overview') {
    const body = info === undefined || info === 'loading'
      ? '<section class="sec"><div class="skel" style="width:70%"></div><div class="skel" style="width:52%"></div><div class="skel" style="width:64%"></div></section>'
      : info === null
        ? '<p class="empty">Could not read this project.</p>'
        : state.tab === 'docs' ? docsTab(p, info) : state.tab === 'api' ? apiTab(p, info) : setupTab(p, info)
    return head + tabs + `<div role="tabpanel">${body}</div>`
  }
  return head + tabs + `
    ${items.length ? `<section class="sec"><h2>Now</h2><div class="rows">${attentionRows(items, false)}</div></section>` : `<div class="callout" style="--c:var(--rc-clean)"><p>Everything committed and pushed on <span class="mono">${esc(p.branch ?? '')}</span>.</p></div>`}
    <section class="sec"><h2>Skills</h2><div class="actions">${acts}</div>
      <div class="task"><textarea id="draft" placeholder="New task: what should an agent do in ${esc(p.name)}?" aria-label="Describe the new task">${esc(state.drafts.get(p.path) ?? '')}</textarea>
        <div class="act"><span class="muted">Becomes a structured prompt in a new worktree.</span>${actionBtn(p, 'prompt', 'Start task')}</div></div></section>
    ${agentsSection(new Set([p.path]))}
    ${runningSection(new Set([p.path]))}
    ${ready ? glance(p, ready) : ''}
    ${envSection(p)}
    ${prsSection(new Set([p.path]))}
    ${releasesSection(p)}
    ${cleanupSection(p.path)}
    <section class="sec"><h2>State</h2><dl class="facts">
      <dt>Branch</dt><dd class="mono">${esc(p.branch ?? '—')}</dd>
      <dt>State</dt><dd>${st.length ? st.map((k) => `<span style="color:${STATE_VAR[k]}">●</span> ${STATE_NAME[k]}`).join(' · ') : 'clean'}</dd>
      <dt>Release</dt><dd>${p.tag ? `<span class="mono">${esc(p.tag)}</span> on ${esc(p.tag_date ?? '')}${p.since ? ` · ${p.since} commits since` : ' · nothing since'}` : 'no version tag'}</dd>
      <dt>Recipe</dt><dd>${p.recipe_file ? `${esc(p.recipe === 'update' ? 'out of date' : (p.recipe ?? ''))} · <button class="linkbtn" data-run="recipe" data-path="${esc(p.path)}">open</button>` : 'none: Push creates one'}</dd>
      <dt>Stack</dt><dd>${(p.stack ?? []).map(techLabel).map(esc).join(', ') || '—'}</dd>
      ${wt}
    </dl><div class="actions"><button class="btn sm" data-run="open" data-path="${esc(p.path)}">${icon('open')} Open the workspace</button></div></section>
    ${linksSection(p)}
    <section class="sec"><h2>Commits per week</h2>${weekBars(p.weeks ?? Array(12).fill(0))}</section>
    ${ready?.commits.length ? `<section class="sec"><h2>Latest commits</h2><ol class="commits">${ready.commits.map((c) => `<li><span class="mono hash">${esc(c.hash)}</span><span class="subj">${esc(c.subject)}</span><span class="muted">${esc(c.author)} · ${esc(c.when)}</span></li>`).join('')}</ol></section>` : ''}
    <section class="sec"><h2>Code map</h2>${graph}</section>`
}


// ---------- the work around the code ----------
const ago = (t: number) => relTime(t)
const workOf = (path: string) => state.snap?.work?.[path]

/** A button that runs an action, asking for a second press first when `confirm` is set. */
function workBtn(action: ActionRequest['action'], label: string, path: string, target?: string, confirm?: string, text?: string): string {
  const key = `${path}|${action}|${target ?? ''}`
  const armed = state.confirm === key
  return `<button class="btn sm${armed ? ' danger' : ''}" data-run="${action}" data-path="${esc(path)}" ${target ? `data-target="${esc(target)}"` : ''} ${text ? `data-text="${esc(text)}"` : ''} ${confirm ? `data-confirm="${esc(confirm)}"` : ''} ${state.busy.has(key) ? 'aria-busy="true" disabled' : ''}>${esc(armed ? confirm! : label)}</button>`
}

function agentsSection(paths: Set<string> | null): string {
  const rows = (state.snap?.agents ?? []).filter((a) => !paths || paths.has(a.path))
  if (!rows.length) return ''
  const name = (path: string) => byPath(path)?.name ?? ''
  return `<section class="sec"><h2>Agents<span class="count num">${rows.length}</span></h2><div class="rows">${rows
    .map(
      (a) => `<div class="row"><span class="dot${needsYou(a) ? ' pulse' : ''}" style="--c:${needsYou(a) ? 'var(--rc-agent)' : 'var(--rc-clean)'}"></span>
        <div class="what"><b>${esc(paths && paths.size === 1 ? (a.title ?? 'agent') : name(a.path))}</b><span>${esc(needsYou(a) ? (a.state === 'blocked' ? 'blocked: needs you' : 'waiting for you') : 'working')}${a.title && !(paths && paths.size === 1) ? ` · ${esc(a.title)}` : ''} · ${esc(ago(a.since))}</span></div>
        ${workBtn('agent', 'Open', a.path, a.paneKey)}</div>`
    )
    .join('')}</div></section>`
}

function prRows(path: string, withProject: boolean): string {
  const w = workOf(path)?.prs
  if (!w) return ''
  return (w.prs ?? [])
    .map((pr) => {
      const tag = pr.review_requested ? '<span class="tag" style="--c:var(--rc-review)">your review</span>' : pr.mine ? '<span class="tag">yours</span>' : ''
      const review = pr.review === 'approved' ? ' · approved' : pr.review === 'changes_requested' ? ' · changes requested' : ''
      return `<div class="row"><span class="dot" style="--c:${pr.review_requested ? 'var(--rc-review)' : 'var(--orca-muted-foreground)'}"></span>
        <div class="what"><b>${withProject ? `${esc(byPath(path)?.name ?? '')} · ` : ''}#${pr.number} ${esc(pr.title)}</b><span>${tag}${esc(pr.author)}${pr.branch ? ` · <span class="mono">${esc(pr.branch)}</span>` : ''}${pr.draft ? ' · draft' : ''}${review}</span></div>
        ${workBtn('pr-open', 'Open', path, pr.url)}</div>`
    })
    .join('')
}

function ciBadge(path: string): string {
  const ci = workOf(path)?.prs?.ci
  if (!ci) return ''
  const bad = /fail|error|cancel|timed_out/i.test(ci.state)
  const ok = /success/i.test(ci.state)
  return `<span class="tag" style="--c:${bad ? 'var(--rc-unpushed)' : ok ? 'var(--rc-clean)' : 'var(--rc-dirty)'}">CI ${esc(ci.state)}</span>`
}

function prsSection(paths: Set<string> | null): string {
  const all = Object.entries(state.snap?.work ?? {}).filter(([p]) => !paths || paths.has(p))
  const single = paths && paths.size === 1
  const rows = all
    .map(([p, w]) => (single ? prRows(p, false) : prRows(p, true).length && (w.prs?.prs ?? []).some((x) => x.mine || x.review_requested) ? prRows(p, true) : ''))
    .join('')
  const errs = all.filter(([, w]) => w.prs?.error).map(([p, w]) => `${byPath(p)?.name}: ${w.prs!.error}`)
  if (!rows && !single) return ''
  const ci = single ? ciBadge([...paths!][0]) : ''
  const when = single ? workOf([...paths!][0])?.prs?.at : undefined
  return `<section class="sec"><h2>Pull requests${ci ? ` ${ci}` : ''}</h2>${rows ? `<div class="rows">${rows}</div>` : `<p class="empty">${errs.length ? esc(errs[0].split(': ').slice(1).join(': ')) : 'No open pull requests.'}</p>`}
    ${when ? `<p class="muted small">Checked ${esc(ago(when))} · Fetch to update.</p>` : ''}</section>`
}

function runningSection(paths: Set<string> | null): string {
  const single = paths && paths.size === 1
  const entries = Object.entries(state.snap?.work ?? {}).filter(([p, w]) => (!paths || paths.has(p)) && isRunning(w))
  if (!entries.length) return single ? '' : ''
  return `<section class="sec"><h2>Running<span class="count num">${entries.length}</span></h2><div class="rows">${entries
    .map(([p, w]) => {
      const procs = (w.running?.processes ?? [])
        .map(
          (x) => `<div class="row"><span class="dot pulse" style="--c:var(--rc-clean)"></span><div class="what"><b>${single ? '' : `${esc(byPath(p)?.name ?? '')} · `}${esc(x.command)}</b><span>${x.ports.map((port) => `<a class="url mono" href="http://localhost:${port}" target="_blank" rel="noopener noreferrer">:${port}</a>`).join(' ')} · pid ${x.pid}</span></div>
          ${workBtn('kill', 'Stop', p, String(x.pid), `Stop ${x.command}?`)}</div>`
        )
        .join('')
      const svcs = (w.running?.services ?? []).filter((x) => x.state === 'running')
      const svcRow = svcs.length
        ? `<div class="row"><span class="dot" style="--c:var(--rc-clean)"></span><div class="what"><b>${single ? 'Services' : `${esc(byPath(p)?.name ?? '')} · services`}</b><span>${svcs.map((x) => `${esc(x.name)}${x.health ? ` (${esc(x.health)})` : ''}${x.ports.length ? ` <span class="mono">:${x.ports.join(',')}</span>` : ''}`).join(' · ')}</span></div>
          ${workBtn('stop', 'Stop', p)}</div>`
        : ''
      return procs + svcRow + logsButtons(p)
    })
    .join('')}</div></section>`
}

function cleanupSection(path: string): string {
  const c = workOf(path)?.cleanup
  if (!c || !cleanupCount(workOf(path))) return ''
  const b = c.merged_branches
  const wt = c.worktrees
  return `<section class="sec"><h2>Clean up<span class="count num">${b.length + wt.length}</span></h2>
    ${b.length ? `<div class="row"><span class="dot" style="--c:var(--orca-muted-foreground)"></span><div class="what"><b>${b.length} merged ${b.length === 1 ? 'branch' : 'branches'}</b><span class="mono">${b.slice(0, 6).map(esc).join(', ')}${b.length > 6 ? '…' : ''}</span></div>${workBtn('cleanup', 'Delete', path, 'branches', `Delete ${b.length}?`)}</div>` : ''}
    ${wt.length ? `<div class="row"><span class="dot" style="--c:var(--orca-muted-foreground)"></span><div class="what"><b>${wt.length} merged ${wt.length === 1 ? 'worktree' : 'worktrees'}, nothing uncommitted</b><span class="mono">${wt.slice(0, 4).map((w) => esc(w.branch)).join(', ')}</span></div>${workBtn('cleanup', 'Remove', path, 'worktrees', `Remove ${wt.length}?`)}</div>` : ''}
    <p class="muted small">Already merged into <span class="mono">${esc(c.base ?? '')}</span>. Git refuses anything not merged or with uncommitted files.</p></section>`
}

function cleanupSummary(paths: Set<string> | null): string {
  const list = live().filter((p) => (!paths || paths.has(p.path)) && cleanupCount(workOf(p.path)))
  if (!list.length) return ''
  const n = list.reduce((t, p) => t + cleanupCount(workOf(p.path)), 0)
  return `<section class="sec"><h2>Clean up<span class="count num">${n}</span></h2><div class="rows">${list
    .map((p) => `<div class="row link" data-select="${esc(p.path)}" tabindex="0" role="button"><span class="dot" style="--c:var(--orca-muted-foreground)"></span><div class="what"><b>${esc(p.name)}</b><span>${workOf(p.path)!.cleanup!.merged_branches.length} merged branches · ${workOf(p.path)!.cleanup!.worktrees.length} merged worktrees</span></div><span></span></div>`)
    .join('')}</div></section>`
}

function standupSection(): string {
  const sd = state.standup
  const choose = `<div class="seg inline" role="group" aria-label="Since">${[
    ['yesterday 00:00', 'Since yesterday'],
    ['last monday', 'This week'],
    ['7 days ago', '7 days']
  ]
    .map(([v, l]) => `<button data-since="${v}" aria-pressed="${state.standupSince === v}">${l}</button>`)
    .join('')}</div>`
  const body =
    sd === null
      ? `<p class="empty">What you committed, in every project and branch: ready to paste in a standup.</p><div class="actions"><button class="btn sm" data-standup>Show my day</button></div>`
      : sd === 'loading'
        ? '<div class="skel" style="width:70%"></div><div class="skel" style="width:50%"></div>'
        : sd.rows.length
          ? `<div class="standup">${sd.rows.map((r) => `<div><b>${esc(r.name)}</b><ul>${r.commits.slice(0, 12).map((c) => `<li>${esc(c.subject)}</li>`).join('')}${r.commits.length > 12 ? `<li class="muted">and ${r.commits.length - 12} more</li>` : ''}</ul></div>`).join('')}</div>
             <div class="actions"><button class="btn sm" data-copystandup>${icon('copy')} Copy as text</button></div>`
          : `<p class="empty">No commits of yours since ${esc(sd.since)}.</p>`
  return `<section class="sec"><h2>Your day</h2>${choose}${body}</section>`
}

function loadStandup(): void {
  state.standup = 'loading'
  renderDrawer(false)
  const since = state.standupSince
  // only the answer for the period still chosen: a slower earlier one must not overwrite it
  orca.plugin
    .request('rc.standup', { since }, { timeoutMs: 60_000 })
    .then((r: { rows: StandupRow[]; since: string }) => {
      if (state.standupSince === since) state.standup = r
    })
    .catch(() => {
      if (state.standupSince === since) state.standup = { rows: [], since }
    })
    .finally(() => state.standupSince === since && renderDrawer(false))
}

// ---------- search ----------
const HIT_LABEL: Record<Hit['kind'], string> = { project: 'Projects', doc: 'Documents', endpoint: 'Endpoints', script: 'Scripts', env: 'Environment' }

function searchView(): string {
  const h = state.hits
  const head = `<div class="head"><div class="grow"><h2>Search</h2><div class="path muted">“${esc(state.query)}” in every project</div></div>
    <button class="btn sm ghost" data-clearsearch aria-label="Clear the search (Esc)">${icon('close')}</button></div>`
  if (h === 'loading' || h === null) return head + '<div class="skel" style="width:70%"></div><div class="skel" style="width:55%"></div>'
  if (!h.length) return head + '<p class="empty">Nothing found. Try a path segment (“atleti”), a script (“dev”) or a variable (“DATABASE”).</p>'
  const groups = new Map<Hit['kind'], Hit[]>()
  for (const x of h) groups.set(x.kind, [...(groups.get(x.kind) ?? []), x])
  return (
    head +
    [...groups]
      .map(
        ([k, xs]) => `<section class="sec"><h2>${HIT_LABEL[k]}<span class="count num">${xs.length}</span></h2><div class="rows">${xs
          .slice(0, 20)
          .map(
            (x) => `<div class="row link" data-hit="${k}" data-hitpath="${esc(x.path)}" data-ref="${esc(x.ref)}" tabindex="0" role="button">
            <span class="dot" style="--c:var(--orca-muted-foreground)"></span>
            <div class="what"><b class="${k === 'endpoint' || k === 'env' || k === 'script' ? 'mono' : ''}">${esc(x.label)}</b><span>${esc(x.project)}${x.detail ? ` · ${esc(x.detail)}` : ''}</span></div><span></span></div>`
          )
          .join('')}</div></section>`
      )
      .join('')
  )
}

let searchTimer = 0
function runSearch(q: string): void {
  state.query = q
  clearTimeout(searchTimer)
  if (!q.trim()) {
    state.hits = null
    return renderDrawer(false)
  }
  state.hits = state.hits && state.hits !== 'loading' ? state.hits : 'loading'
  if (state.logs) {
    logsGen++
    window.clearTimeout(logsTimer)
    state.logs = null
    layoutWide()
  }
  renderDrawer(false)
  searchTimer = window.setTimeout(() => {
    orca.plugin
      .request('rc.search', { q }, { timeoutMs: 60_000 })
      .then((r: Hit[]) => {
        if (state.query === q) state.hits = r
      })
      .catch(() => {
        if (state.query === q) state.hits = []
      })
      .finally(() => state.query === q && renderDrawer(false))
  }, 160)
}

function openHit(el: HTMLElement): void {
  const kind = el.dataset.hit as Hit['kind']
  const path = el.dataset.hitpath!
  const ref = el.dataset.ref!
  state.query = ''
  state.hits = null
  $<HTMLInputElement>('#q').value = ''
  state.tab = kind === 'doc' ? 'docs' : kind === 'endpoint' ? 'api' : kind === 'script' || kind === 'env' ? 'setup' : 'overview'
  if (kind === 'endpoint') {
    state.apiQuery = ref
    state.apiMethod = ''
  }
  state.selected = null
  select(path)
  if (kind === 'doc') openDoc(path, ref)
}


// ---------- environments, releases, logs ----------
function envSection(p: Project): string {
  const e = workOf(p.path)?.envs
  const targets = p.targets ?? []
  if (!targets.length) return ''
  const rows = (e?.targets ?? targets.map((name) => ({ name, url: null, checked: false }) as any))
    .map((t: any) => {
      const color = !t.checked ? 'var(--orca-muted-foreground)' : t.up ? 'var(--rc-clean)' : 'var(--rc-unpushed)'
      const state = !t.checked
        ? t.url ? 'not checked yet' : 'no url in the recipe'
        : t.up
          ? `up · HTTP ${t.status}${t.ms != null ? ` · ${t.ms} ms` : ''}`
          : `down · ${esc(t.error ?? `HTTP ${t.status}`)}`
      const ver = t.version ? ` · <span class="mono">${esc(String(t.version).slice(0, 24))}</span>` : ''
      const behind = t.behind ? ` <span class="tag" style="--c:var(--rc-unreleased)">${t.behind} behind ${esc(e?.base ?? '')}</span>` : t.behind === 0 ? ' <span class="tag" style="--c:var(--rc-clean)">up to date</span>' : ''
      return `<div class="row"><span class="dot${t.checked && !t.up ? ' pulse' : ''}" style="--c:${color}"></span>
        <div class="what"><b>${esc(t.name)}</b><span>${t.url ? `<a class="url mono" href="${esc(t.url)}" target="_blank" rel="noopener noreferrer">${esc(t.url.replace(/^https?:\/\//, ''))}</a> · ` : ''}${state}${ver}${behind}</span></div>
        ${actionBtn(p, 'deploy', 'Deploy', false, t.name)}</div>`
    })
    .join('')
  const hint = !(e?.targets ?? []).some((t) => t.url)
    ? `<p class="muted small">Add <span class="mono">- url: https://…</span> (and optionally <span class="mono">- health: /health</span>) under each <span class="mono">### target</span> of the recipe to see whether it is up and which version it runs. <button class="linkbtn" data-run="recipe" data-path="${esc(p.path)}">Open the recipe</button></p>`
    : e?.at ? `<p class="muted small">Checked ${esc(relTime(e.at))}.</p>` : ''
  return `<section class="sec"><h2>Environments<span class="count num">${targets.length}</span></h2><div class="rows">${rows}</div>${hint}</section>`
}

function releasesSection(p: Project): string {
  const r = workOf(p.path)?.releases
  if (!r || !r.tags.length) return ''
  const targets = p.targets ?? []
  const prev = r.tags[1]
  const rows = r.tags
    .slice(0, 6)
    .map(
      (t, i) => `<div class="row"><span class="dot" style="--c:${i === 0 ? 'var(--rc-unreleased)' : 'var(--orca-muted-foreground)'}"></span>
        <div class="what"><b class="mono">${esc(t.tag)}</b><span>${esc(t.date.slice(0, 10))}${t.commits != null ? ` · ${t.commits} commits` : ''}${t.subject && t.subject !== t.tag ? ` · ${esc(t.subject)}` : ''}</span></div><span></span></div>`
    )
    .join('')
  const rollback = prev && targets.length
    ? `<div class="actions">${targets.map((tg) => workBtn('deploy', `Roll back ${tg} to ${prev.tag}`, p.path, tg, `Confirm rollback of ${tg} to ${prev.tag}?`, prev.tag)).join('')}</div>
       <p class="muted small">A rollback runs the target's own steps for that tag through the deploy skill, which asks before releasing.</p>`
    : ''
  return `<section class="sec"><h2>Releases${r.unreleased ? ` <span class="tag" style="--c:var(--rc-unreleased)">${r.unreleased} unreleased</span>` : ''}</h2><div class="rows">${rows}</div>${rollback}</section>`
}

function logsButtons(path: string): string {
  const w = workOf(path)
  const terms = (w?.terminals ?? []).slice(-6).reverse()
  const svcs = (w?.running?.services ?? []).filter((x) => x.state === 'running')
  if (!terms.length && !svcs.length) return ''
  return `<div class="actions logsrc">${terms.map((t) => `<button class="btn sm ghost" data-logs="terminal:${esc(t.id)}" data-path="${esc(path)}" data-title="${esc(t.title)}">${icon('logs')} ${esc(t.title)}</button>`).join('')}${svcs
    .map((x) => `<button class="btn sm ghost" data-logs="service:${esc(x.name)}" data-path="${esc(path)}" data-title="${esc(x.name)} (service)">${icon('logs')} ${esc(x.name)}</button>`)
    .join('')}</div>`
}

function logsView(): string {
  const l = state.logs!
  const lines = l.lines ?? []
  const errors = lines.filter((x) => LOG_ERROR.test(x)).length
  const shown = l.onlyErrors ? lines.filter((x) => LOG_ERROR.test(x)) : lines
  const body =
    l.lines === null
      ? '<div class="skel" style="width:80%"></div><div class="skel" style="width:60%"></div>'
      : l.error
        ? `<p class="empty">${esc(l.error)}</p>`
        : shown.length
          ? `<pre class="logbox" tabindex="0" aria-label="Log lines">${shown.map((x) => `<span class="${LOG_ERROR.test(x) ? 'err' : ''}">${esc(x)}</span>`).join('\n')}</pre>`
          : `<p class="empty">${l.onlyErrors ? 'No error lines.' : 'Nothing printed yet.'}</p>`
  return `<div class="head"><div class="grow"><h2>${esc(l.title)}</h2><div class="path muted">${esc(byPath(l.path)?.name ?? '')} · last ${lines.length} lines · refreshes every 3 s</div></div>
      <button class="btn sm ghost" data-closelogs aria-label="Close the logs (Esc)">${icon('close')}</button></div>
    <div class="actions"><button class="chip" data-onlyerrors aria-pressed="${l.onlyErrors}"><span class="dot" style="--c:var(--rc-unpushed)"></span>Errors <b>${errors}</b></button>
      <button class="btn sm" data-copylogs>${icon('copy')} Copy</button></div>
    ${body}`
}

let logsTimer = 0
/** Bumped on every open/close: a reply for logs that are no longer shown is dropped. */
let logsGen = 0
function openLogs(path: string, source: string, title: string): void {
  state.logs = { path, source, title, lines: null, error: null, onlyErrors: false }
  layoutWide()
  renderDrawer(false)
  const gen = ++logsGen
  window.clearTimeout(logsTimer)
  // one request at a time, the next 3 s after the last answer; nothing while the board is hidden
  const pull = (): void => {
    if (gen !== logsGen) return
    if (document.hidden) {
      logsTimer = window.setTimeout(pull, 3000)
      return
    }
    orca.plugin
      .request('rc.logs', { path, source }, { timeoutMs: 20_000 })
      .then((r: { lines: string[]; error: string | null }) => {
        const l = state.logs
        if (gen !== logsGen || !l) return
        const same = l.error === r.error && l.lines !== null && l.lines.length === r.lines.length && l.lines.every((x, i) => x === r.lines[i])
        if (same) return // nothing new: keep the reader's scroll and selection
        l.lines = r.lines
        l.error = r.error
        const box = drawer.querySelector('.logbox')
        const atEnd = !box || box.scrollTop + box.clientHeight >= box.scrollHeight - 8
        const top = box?.scrollTop ?? 0
        renderDrawer(false)
        const nb = drawer.querySelector('.logbox')
        if (nb) nb.scrollTop = atEnd ? nb.scrollHeight : top
      })
      .catch(() => undefined)
      .finally(() => {
        if (gen === logsGen) logsTimer = window.setTimeout(pull, 3000)
      })
  }
  pull()
}

function closeLogs(): void {
  logsGen++
  window.clearTimeout(logsTimer)
  if (!state.logs) return
  state.logs = null
  layoutWide()
  renderDrawer(false)
}

// ---------- project page tabs ----------
/** Docs and API read better wide: the drawer grows while one of those tabs is open. */
function layoutWide(): void {
  document.querySelector('.main')?.classList.toggle('wide', !!state.logs || (!!state.selected && (state.tab === 'docs' || state.tab === 'api')))
}

function loadInfo(path: string, fresh = false): void {
  if (!fresh && state.info.has(path) && state.info.get(path) !== null) return
  state.info.set(path, 'loading')
  orca.plugin
    .request('rc.project', { path }, { timeoutMs: 60_000 })
    .then((i: ProjectInfo | null) => state.info.set(path, i))
    .catch(() => state.info.set(path, null))
    .finally(() => state.selected === path && renderDrawer(false))
}

function openDoc(path: string, rel: string): void {
  state.doc = { path, rel, text: 'loading' }
  renderDrawer(false)
  drawer.parentElement!.scrollTop = 0
  orca.plugin
    .request('rc.doc', { path, doc: rel }, { timeoutMs: 30_000 })
    .then((r: { text: string } | null) => {
      if (state.doc?.rel === rel && state.doc.path === path) state.doc.text = r ? r.text : null
    })
    .catch(() => {
      if (state.doc?.rel === rel && state.doc.path === path) state.doc.text = null
    })
    .finally(() => state.doc?.rel === rel && state.doc.path === path && renderDrawer(false))
}

const METHOD_VAR: Record<string, string> = {
  GET: 'var(--rc-clean)',
  POST: 'var(--rc-unreleased)',
  PUT: 'var(--rc-dirty)',
  PATCH: 'var(--rc-dirty)',
  DELETE: 'var(--rc-unpushed)'
}
const methodVar = (m: string) => METHOD_VAR[m] ?? 'var(--orca-muted-foreground)'

/** Overview strip: what the project offers, each tile opens its tab. */
function glance(p: Project, info: ProjectInfo): string {
  const tile = (tab: Tab, n: number, label: string, sub: string) =>
    `<button class="tile" data-tab="${tab}"><b class="num">${n}</b><span>${label}</span><small class="muted">${esc(sub)}</small></button>`
  const readme = info.docs[0]?.title ?? 'no docs yet'
  const top = groupEndpoints(info.api)[0]
  return `<section class="sec"><h2>At a glance</h2><div class="tiles">
    ${tile('docs', info.docs.length, info.docs.length === 1 ? 'document' : 'documents', readme)}
    ${tile('api', info.api.length, info.api.length === 1 ? 'endpoint' : 'endpoints', top ? `most in ${top.group}` : 'none found')}
    ${tile('setup', info.scripts.length, info.scripts.length === 1 ? 'script' : 'scripts', info.urls[0] ?? `${info.env.length} env variables`)}
  </div></section>`
}

function docsTab(p: Project, info: ProjectInfo): string {
  if (state.doc && state.doc.path === p.path) return docReader(p, info)
  if (!info.docs.length) return '<p class="empty">No markdown documents in this project yet. A README.md or a docs/ folder shows up here.</p>'
  const groups = new Map<string, DocEntry[]>()
  for (const d of info.docs) groups.set(d.group, [...(groups.get(d.group) ?? []), d])
  return [...groups]
    .map(
      ([g, docs]) => `<section class="sec"><h2>${esc(g)}<span class="count num">${docs.length}</span></h2><div class="doclist">${docs
        .map(
          (d) => `<button class="doc" data-doc="${esc(d.path)}"><span class="doc-title">${esc(d.title)}</span>
            <span class="doc-meta mono">${esc(d.path)} · ${d.words.toLocaleString('en')} words</span>
            ${d.headings.length ? `<span class="doc-heads">${d.headings.filter((h) => h.level === 2).slice(0, 5).map((h) => `<i>${esc(h.text)}</i>`).join('')}</span>` : ''}</button>`
        )
        .join('')}</div></section>`
    )
    .join('')
}

function docReader(p: Project, info: ProjectInfo): string {
  const d = state.doc!
  const entry = info.docs.find((x) => x.path === d.rel)
  const bar = `<div class="reader-bar"><button class="btn sm ghost" data-docback>${icon('back')} All documents</button>
    <span class="grow mono muted">${esc(d.rel)}</span>
    <button class="btn sm" data-openfile="${esc(d.rel)}">${icon('open')} Open in editor</button></div>`
  if (d.text === 'loading') return bar + '<div class="skel" style="width:80%"></div><div class="skel" style="width:60%"></div>'
  if (d.text === null) return bar + '<p class="empty">Could not read this document.</p>'
  const r = renderMarkdown(d.text)
  const toc = r.outline.length > 2
    ? `<nav class="toc" aria-label="On this page">${r.outline.filter((o) => o.level <= 3).slice(0, 40).map((o) => `<a href="#${o.id}" data-jump="${o.id}" class="l${o.level}">${esc(o.text)}</a>`).join('')}</nav>`
    : ''
  return bar + `<div class="reader${toc ? ' with-toc' : ''}">${toc}<article class="md" aria-label="${esc(entry?.title ?? d.rel)}">${r.html}</article></div>`
}

function apiTab(p: Project, info: ProjectInfo): string {
  if (!info.api.length)
    return '<p class="empty">No endpoints found. Release Control reads OpenAPI/Swagger files and NestJS, Express, FastAPI and Spring routes.</p>'
  const counts = methodCounts(info.api)
  const total = info.api.length
  const bar = `<div class="mbar" role="img" aria-label="${counts.map((c) => `${c.n} ${c.method}`).join(', ')}">${counts
    .map((c) => `<i style="--c:${methodVar(c.method)};flex:${c.n}" title="${c.n} ${c.method}"></i>`)
    .join('')}</div>`
  const chips = `<div class="mchips">${['', ...counts.map((c) => c.method)]
    .map((m) => `<button class="chip" data-method="${m}" aria-pressed="${state.apiMethod === m}">${m ? `<span class="dot" style="--c:${methodVar(m)}"></span>${m} <b>${counts.find((c) => c.method === m)!.n}</b>` : `All <b>${total}</b>`}</button>`)
    .join('')}</div>`
  const groups = groupEndpoints(info.api, state.apiQuery, state.apiMethod)
  const approx = info.api.filter((e) => e.approx).length
  const list = groups.length
    ? groups
        .map(
          (g) => `<details class="apig" data-key="${esc(g.group)}" open><summary><span class="grow">${esc(g.group)}</span><span class="count num">${g.items.length}</span></summary>${g.items
            .map(
              (e) => `<button class="ep" data-openfile="${esc(e.file)}" title="${esc(e.file)}${e.line ? `:${e.line}` : ''}">
                <span class="verb" style="--c:${methodVar(e.method)}">${esc(e.method)}</span>
                <span class="epath mono">${esc(e.path).replace(/(:[\w]+|\{[^}]+\})/g, '<em>$1</em>')}${e.approx ? '<span class="approx" title="Built from code Release Control could not fully resolve">≈</span>' : ''}</span>
                <span class="muted handler">${esc(e.summary ?? e.handler ?? '')}</span></button>`
            )
            .join('')}</details>`
        )
        .join('')
    : '<p class="empty">No endpoint matches.</p>'
  return `<section class="sec"><h2>Endpoints<span class="count num">${total}</span></h2>${bar}${chips}
    <input class="search" type="search" id="apiq" placeholder="Filter by path, controller or handler" value="${esc(state.apiQuery)}" aria-label="Filter endpoints">
    ${approx ? `<p class="muted small">≈ ${approx} paths are approximate: their prefix comes from code that is not a plain string.</p>` : ''}
    <div class="eps">${list}</div></section>`
}

function setupTab(p: Project, info: ProjectInfo): string {
  const scripts = info.scripts.length
    ? `<div class="rows">${info.scripts
        .map(
          (sc) => `<div class="row script"><span class="dot" style="--c:var(--orca-muted-foreground)"></span><div class="what"><b class="mono">${esc(sc.run)}</b>${sc.command ? `<span class="mono muted">${esc(sc.command)}</span>` : ''}</div>
            <button class="btn sm" data-script="${esc(sc.run)}" data-path="${esc(p.path)}" title="Runs in a terminal of ${esc(p.name)}, no agent">Run</button></div>`
        )
        .join('')}</div>`
    : '<p class="empty">No package.json scripts or Makefile targets.</p>'
  const urls = info.urls.length
    ? `<div class="urls">${info.urls.map((u) => `<a class="url mono" href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(u)}</a>`).join('')}</div>`
    : '<p class="empty">No local URLs mentioned in the docs.</p>'
  const env = info.env.length
    ? `<div class="envs">${info.env.map((e) => `<button class="env mono" data-copy="${esc(e.name)}" title="${esc(e.file)} · click to copy">${esc(e.name)}</button>`).join('')}</div>
       <p class="muted small">Names only, from ${[...new Set(info.env.map((e) => e.file))].map(esc).join(', ')}. Values are never read.</p>`
    : '<p class="empty">No .env example files.</p>'
  return `<section class="sec"><h2>Scripts<span class="count num">${info.scripts.length}</span></h2>${scripts}</section>
    <section class="sec"><h2>Local URLs</h2>${urls}</section>
    <section class="sec"><h2>Environment<span class="count num">${info.env.length}</span></h2>${env}</section>`
}

function graphView(p: Project, g: GraphSummary & { behind?: number }): string {
  const max = g.top[0]?.size ?? 1
  const rows = g.top
    .slice(0, 8)
    .map((c) => `<span>${esc(c.label)}</span><span class="muted num">${c.size}</span><span class="barline"><i style="width:${((c.size / max) * 100).toFixed(1)}%"></i></span>`)
    .join('')
  const stale = g.behind ? `Built ${g.behind} commits ago.` : 'Up to date with the last commit.'
  return `<p class="muted num">${g.nodes.toLocaleString('en')} nodes · ${g.links.toLocaleString('en')} links · ${g.communities} communities. ${stale}</p>
    <div class="comm">${rows}</div>
    <div class="actions">${actionBtn(p, 'graphify', g.behind ? 'Update the graph' : 'Rebuild the graph', !!g.behind && g.behind > 20)}</div>`
}

const projectByRecipe = (id: string) => live().find((p) => recipeId(p) === id) ?? null

function linkRow(text: string, target: { path?: string; name: string }): string {
  return target.path
    ? `<div class="row link" data-select="${esc(target.path)}" tabindex="0" role="button"><span class="dot" style="--c:var(--orca-muted-foreground)"></span><div class="what"><span>${esc(text)}</span><b>${esc(target.name)}</b></div><span></span></div>`
    : `<div class="row"><span class="dot ext"></span><div class="what"><span>${esc(text)}</span><b>${esc(target.name)}</b> <span class="muted">(external)</span></div><span></span></div>`
}

function linksSection(p: Project): string {
  const out = (p.links ?? [])
    .map((l) => {
      if (l.target.startsWith('ext:')) return linkRow(LINK_LABEL[l.type], { name: l.target.slice(4) })
      const t = projectByRecipe(l.target)
      return t ? linkRow(LINK_LABEL[l.type], { path: t.path, name: t.name }) : ''
    })
    .join('')
  const inc = incoming(projects(), p.path).map((x) => linkRow(INCOMING_LABEL[x.type], { path: x.from.path, name: x.from.name })).join('')
  const dom = p.domain ? domains(projects()).find((d) => d.id === p.domain) : null
  if (!out && !inc && !dom) return ''
  return `<section class="sec"><h2>Links</h2>${dom ? `<p class="muted">Domain <button class="linkbtn" data-domain="${esc(dom.id)}">${esc(dom.label)}</button></p>` : ''}<div class="rows">${out}${inc}</div></section>`
}

function domainView(id: string): string {
  const d = domains(projects()).find((x) => x.id === id)
  if (!d) return overview()
  const members = live().filter((p) => p.domain === id)
  const pending = attention(members)
  const es = edges(projects()).filter((e) => d.members.some((m) => e.from === `p:${m}`))
  const name = (nodeId: string) => (nodeId.startsWith('x:') ? `${nodeId.slice(2)} (external)` : (byPath(nodeId.slice(2))?.name ?? nodeId))
  const shared = state.snap?.shared_deps ?? {}
  const common = Object.keys(shared).filter((k) => members.filter((m) => shared[k][m.path] !== undefined).length >= 2)
  const split = common.filter((k) => depRows(state.snap!, k).some((r) => r.odd && members.some((m) => m.name === r.project)))
  return `
    <div class="head"><div class="grow"><h2>${esc(d.label)}</h2><div class="path muted">Domain · ${members.length} projects</div></div>
      <button class="btn sm ghost" data-close aria-label="Close (Esc)">${icon('close')}</button></div>
    <section class="sec"><h2>Projects</h2><div class="rows">${members
      .map((p) => `<div class="row link" data-select="${esc(p.path)}" tabindex="0" role="button"><span class="dot" style="--c:${states(p).length ? STATE_VAR[states(p)[0]] : 'var(--rc-clean)'}"></span><div class="what"><b>${esc(p.name)}</b><span class="mono">${esc(p.branch ?? '')}</span></div><span class="statedots">${states(p).map((k) => `<i style="--c:${STATE_VAR[k]}"></i>`).join('')}</span></div>`)
      .join('')}</div></section>
    <section class="sec"><h2>Now<span class="count num">${pending.length || ''}</span></h2>${pending.length ? `<div class="rows">${attentionRows(pending, true)}</div>` : '<p class="empty">Nothing pending in this domain.</p>'}</section>
    <section class="sec"><h2>Links</h2>${es.length ? `<div class="rows">${es.map((e) => `<div class="row"><span class="dot" style="--c:var(--orca-muted-foreground)"></span><div class="what"><b>${esc(name(e.from))}</b><span>${esc(LINK_LABEL[e.type])} ${esc(name(e.to))}</span></div><span></span></div>`).join('')}</div>` : '<p class="empty">No links yet.</p>'}</section>
    <section class="sec"><h2>Shared dependencies<span class="count num">${common.length || ''}</span></h2>${common.length ? `<p class="muted">${split.length ? `${split.length} with different versions: ${split.slice(0, 6).map(esc).join(', ')}${split.length > 6 ? '…' : ''}` : 'All on the same versions.'}</p>` : '<p class="empty">None.</p>'}</section>`
}

function depView(name: string): string {
  const rows = depRows(state.snap!, name)
  return `
    <div class="head"><div class="grow"><h2 class="mono-title">${esc(name)}</h2><div class="path muted">Shared by ${rows.length} projects</div></div>
      <button class="btn sm ghost" data-close aria-label="Close (Esc)">${icon('close')}</button></div>
    <section class="sec"><h2>Versions</h2><div class="rows">${rows
      .map((r) => `<div class="row"><span class="dot" style="--c:var(--orca-muted-foreground)"></span><div class="what"><b>${esc(r.project)}</b></div><span class="mono${r.odd ? ' odd' : ''}" ${r.odd ? 'title="differs from most projects"' : ''}>${esc(r.version)}${r.odd ? ' · differs' : ''}</span></div>`)
      .join('')}</div></section>`
}

function gridSection(): string {
  const g = depGrid(state.snap!)
  if (!g.deps.length) return '<section class="sec"><h2>Shared dependencies</h2><p class="empty">No dependency is shared by two projects.</p></section>'
  const split = g.deps.filter((_, i) => g.rows.some((r) => r.odd[i])).length
  return `<section class="sec"><h2>Shared dependencies<span class="count num">${g.deps.length}</span></h2>
    <p class="muted">${split ? `${split} with different versions, underlined.` : 'Every project is on the same versions.'}</p>
    <div class="grid-wrap"><table class="depgrid"><thead><tr><th scope="col">Project</th>${g.deps.map((d) => `<th scope="col"><button class="linkbtn" data-dep="${esc(d)}">${esc(d)}</button></th>`).join('')}</tr></thead>
    <tbody>${g.rows.map((r) => `<tr><th scope="row">${esc(r.project)}</th>${r.cells.map((c, i) => `<td class="mono${r.odd[i] ? ' odd' : ''}" ${r.odd[i] ? 'title="differs from most projects"' : ''}>${c ? esc(c) : '<span class="muted">—</span>'}</td>`).join('')}</tr>`).join('')}</tbody></table></div></section>`
}

function loadingDrawer(): string {
  return `<section class="sec"><h2>Now</h2><div class="skel" style="width:80%"></div><div class="skel" style="width:64%"></div><div class="skel" style="width:72%"></div></section>
    <section class="sec"><h2>Commits per week</h2><div class="skel" style="height:120px"></div></section>`
}

function renderDrawer(swap: boolean): void {
  const draw = () => {
    const s = state.snap
    let html = ''
    if (s?.error) {
      html += `<div class="callout"><p>${esc(s.error)}</p><div><button class="btn sm" data-retry>Retry</button></div></div>`
    }
    if (!s) html += loadingDrawer()
    else {
      const p = byPath(state.selected)
      html += state.logs ? logsView() : state.query.trim() ? searchView() : p ? detail(p) : state.domain ? domainView(state.domain) : state.dep ? depView(state.dep) : overview()
    }
    // a refresh rebuilds the drawer: whatever had focus (the task box, the API filter…) keeps it, with its caret
    const active = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null
    const focusId = active && active.id && drawer.contains(active) ? active.id : null
    const caret = focusId && typeof active!.selectionStart === 'number' ? [active!.selectionStart, active!.selectionEnd ?? active!.selectionStart] : null
    const closed = new Set([...drawer.querySelectorAll<HTMLDetailsElement>('details[data-key]')].filter((d) => !d.open).map((d) => d.dataset.key))
    drawer.innerHTML = html
    for (const d of drawer.querySelectorAll<HTMLDetailsElement>('details[data-key]')) if (closed.has(d.dataset.key)) d.open = false
    if (focusId) {
      const t = drawer.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#${window.CSS.escape(focusId)}`)
      t?.focus()
      if (t && caret) {
        try {
          t.setSelectionRange(caret[0], caret[1])
        } catch {
          // inputs without a caret (buttons, checkboxes)
        }
      }
    }
  }
  if (!swap || matchMedia('(prefers-reduced-motion: reduce)').matches) return draw()
  drawer.classList.add('swap')
  setTimeout(() => {
    draw()
    drawer.parentElement!.scrollTop = 0
    drawer.classList.remove('swap')
  }, 120)
}

drawer.addEventListener('click', (e) => {
  const t = e.target as Element
  const runB = t.closest<HTMLButtonElement>('[data-run]')
  if (runB && !runB.disabled) {
    e.stopPropagation()
    const action = runB.dataset.run as ActionRequest['action']
    const req = actionRequest(action, { path: runB.dataset.path, target: runB.dataset.target, text: runB.dataset.text })
    const ckey = `${req.path}|${action}|${req.target ?? ''}`
    if (runB.dataset.confirm && state.confirm !== ckey) {
      // destructive: the first press arms the button, the second one runs it
      state.confirm = ckey
      renderDrawer(false)
      return
    }
    state.confirm = null
    if (action === 'prompt') {
      req.text = state.drafts.get(req.path ?? '') ?? ''
      if (!req.text.trim()) {
        $<HTMLTextAreaElement>('#draft')?.focus()
        return toast('First write what the new task should do.', false)
      }
    }
    return void run(req, `${req.path}|${action}|${req.target ?? ''}`)
  }
  if (t.closest('[data-close]')) {
    if (state.domain || state.dep) {
      state.domain = null
      state.dep = null
      return renderDrawer(true)
    }
    return select(null)
  }
  const dom = t.closest<HTMLElement>('[data-domain]')
  if (dom) return focusOther('domain', dom.dataset.domain!)
  const dep = t.closest<HTMLElement>('[data-dep]')
  if (dep) return focusOther('dep', dep.dataset.dep!)
  if (t.closest('[data-retry]')) return void load(true)
  const lit = t.closest<HTMLButtonElement>('[data-lit]')
  if (lit) {
    state.lit = state.lit === lit.dataset.lit ? null : lit.dataset.lit!
    return renderDrawer(false)
  }
  if (state.confirm && !t.closest('[data-confirm]')) {
    state.confirm = null
    renderDrawer(false)
  }
  const logB = t.closest<HTMLElement>('[data-logs]')
  if (logB) return openLogs(logB.dataset.path!, logB.dataset.logs!, logB.dataset.title ?? 'Logs')
  if (t.closest('[data-closelogs]')) return closeLogs()
  if (t.closest('[data-onlyerrors]') && state.logs) {
    state.logs.onlyErrors = !state.logs.onlyErrors
    return renderDrawer(false)
  }
  if (t.closest('[data-copylogs]') && state.logs?.lines) {
    void navigator.clipboard
      ?.writeText(state.logs.lines.join('\n'))
      .then(() => toast('Logs copied', true))
      .catch(() => toast('Copy is not allowed here', false))
    return
  }
  const hit = t.closest<HTMLElement>('[data-hit]')
  if (hit) return openHit(hit)
  if (t.closest('[data-clearsearch]')) {
    $<HTMLInputElement>('#q').value = ''
    return runSearch('')
  }
  const since = t.closest<HTMLElement>('[data-since]')
  if (since) {
    state.standupSince = since.dataset.since!
    return loadStandup()
  }
  if (t.closest('[data-standup]')) return loadStandup()
  if (t.closest('[data-copystandup]') && state.standup && state.standup !== 'loading') {
    void navigator.clipboard
      ?.writeText(standupText(state.standup.rows, state.standup.since))
      .then(() => toast('Copied: paste it in the standup', true))
      .catch(() => toast('Copy is not allowed here', false))
    return
  }
  const tabB = t.closest<HTMLElement>('[data-tab]')
  if (tabB) {
    state.tab = tabB.dataset.tab as Tab
    if (state.tab !== 'docs') state.doc = null
    layoutWide()
    renderDrawer(false)
    drawer.parentElement!.scrollTop = 0
    drawer.querySelector<HTMLElement>(`[data-tab="${state.tab}"][role="tab"]`)?.focus()
    return
  }
  const docB = t.closest<HTMLElement>('[data-doc]')
  if (docB && state.selected) return openDoc(state.selected, docB.dataset.doc!)
  if (t.closest('[data-docback]')) {
    state.doc = null
    return renderDrawer(false)
  }
  const jump = t.closest<HTMLElement>('[data-jump]')
  if (jump) {
    e.preventDefault()
    document.getElementById(jump.dataset.jump!)?.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
    return
  }
  const fileB = t.closest<HTMLElement>('[data-openfile]')
  if (fileB && state.selected) {
    void orca.plugin
      .request('rc.openFile', { path: state.selected, file: fileB.dataset.openfile! })
      .then((r: { ok: boolean; message: string }) => toast(r.message, r.ok))
      .catch((err: any) => toast(`Could not open: ${err?.message ?? err}`, false))
    return
  }
  const scriptB = t.closest<HTMLButtonElement>('[data-script]')
  if (scriptB && !scriptB.disabled) {
    const req = actionRequest('script', { path: scriptB.dataset.path, text: scriptB.dataset.script })
    return void run(req, `${req.path}|script|${req.text}`)
  }
  const m = t.closest<HTMLElement>('[data-method]')
  if (m) {
    state.apiMethod = m.dataset.method ?? ''
    return renderDrawer(false)
  }
  const copyB = t.closest<HTMLElement>('[data-copy]')
  if (copyB) {
    void navigator.clipboard
      ?.writeText(copyB.dataset.copy!)
      .then(() => toast(`${copyB.dataset.copy} copied`, true))
      .catch(() => toast('Copy is not allowed here', false))
    return
  }
  const sel = t.closest<HTMLElement>('[data-select]')
  if (sel) select(sel.dataset.select!)
})
drawer.addEventListener('keydown', (e) => {
  const hitEl = (e.target as Element).closest<HTMLElement>('[data-hit]')
  if (hitEl && (e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault()
    return openHit(hitEl)
  }
  const sel = (e.target as Element).closest<HTMLElement>('[data-select]')
  if (sel && (e.key === 'Enter' || e.key === ' ') && e.target === sel) {
    e.preventDefault()
    select(sel.dataset.select!)
  }
})
drawer.addEventListener('input', (e) => {
  const el = e.target as HTMLElement
  if (el.id === 'draft' && state.selected) state.drafts.set(state.selected, (el as HTMLTextAreaElement).value)
  if (el.id === 'apiq') {
    state.apiQuery = (el as HTMLInputElement).value
    const caret = (el as HTMLInputElement).selectionStart
    renderDrawer(false)
    const q = $<HTMLInputElement>('#apiq')
    q?.focus()
    q?.setSelectionRange(caret, caret)
  }
})
// Arrow keys move between tabs (WAI-ARIA tabs pattern).
drawer.addEventListener('keydown', (e) => {
  const t = (e.target as Element).closest<HTMLElement>('[role="tab"]')
  if (!t || (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft')) return
  const all = [...drawer.querySelectorAll<HTMLElement>('[role="tab"]')]
  const next = all[(all.indexOf(t) + (e.key === 'ArrowRight' ? 1 : all.length - 1)) % all.length]
  e.preventDefault()
  next.click()
})
drawer.addEventListener('pointerover', (e) => {
  const path = (e.target as Element).closest<HTMLElement>('[data-select]')?.dataset.select ?? null
  const id = path ? `p:${path}` : null
  if (!state.selected && sky.selected !== id) {
    sky.selected = id
    sky.draw()
  }
})
drawer.addEventListener('pointerleave', () => {
  if (!state.selected && sky.selected) {
    sky.selected = null
    sky.draw()
  }
})
const qEl = $<HTMLInputElement>('#q')
qEl.addEventListener('input', () => runSearch(qEl.value))
document.addEventListener('keydown', (e) => {
  const typing = (e.target as HTMLElement).closest('input, textarea, select')
  if (e.key === '/' && !typing) {
    e.preventDefault()
    qEl.focus()
    qEl.select()
  }
  if (e.key === 'Escape' && (e.target as HTMLElement).id === 'q') {
    qEl.value = ''
    runSearch('')
    qEl.blur()
  }
})
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || (e.target as HTMLElement).id === 'draft' || (e.target as HTMLElement).id === 'q') return
  if (state.logs) {
    closeLogs()
  } else if (state.doc) {
    state.doc = null
    renderDrawer(false)
  } else if (state.domain || state.dep) {
    state.domain = null
    state.dep = null
    renderDrawer(true)
  } else if (state.selected) select(null)
})

// ---------- data ----------
const LAUNCH_TIMEOUT = 20 * 60_000

/** A push lands when nothing is left to push (and it had commits or files to send); a deploy when a new
 * tag appears or nothing is left to release. Without either for 20 minutes, the wait is dropped. */
function landLaunches(s: Snapshot): void {
  for (const [path, l] of state.launches) {
    const p = s.projects.find((x) => x.path === path)
    if (!p || p.missing || Date.now() - l.at > LAUNCH_TIMEOUT) {
      state.launches.delete(path)
      sky.cancel(path)
      continue
    }
    if (landed(l, p)) {
      state.launches.delete(path)
      sky.land(path)
      toast(l.kind === 'push' ? `${p.name}: pushed` : `${p.name}: released${p.tag ? ` as ${p.tag}` : ''}`, true)
    }
    // the worker also reports landings (rc.landed): whichever arrives first lands the star, once
  }
}
function apply(s: Snapshot): void {
  // load(true) and rc.updated both deliver a refresh: an older snapshot never replaces a newer one
  if (state.snap && s !== state.snap && s.at < state.snap.at && !state.snap.error) return
  for (const p of s.projects)
    p.live = { waiting: (s.agents ?? []).some((a) => a.path === p.path && needsYou(a)), running: isRunning(s.work?.[p.path]) }
  landLaunches(s)
  state.snap = s
  if (state.selected && !byPath(state.selected)) state.selected = null
  for (const p of s.projects) if (state.graph.get(p.path) === null) state.graph.delete(p.path)
  refreshSky()
  const n = live().length
  hint.hidden = n > 0
  hint.textContent = s.error ? '' : 'No projects in Orca: add a repository and it will show up here.'
  canvas.setAttribute('aria-label', `${n} projects, ${counts(s.projects).attention} with pending work`)
  applyFilter()
  if (wanted && !state.selected && byPath(wanted)) {
    select(wanted, false)
    if (wantedDoc) openDoc(wanted, wantedDoc)
    wanted = null
    wantedDoc = null
  } else renderDrawer(false)
}

async function load(fresh: boolean): Promise<void> {
  try {
    const s = await orca.plugin.request('rc.snapshot', { refresh: fresh }, { timeoutMs: 120_000 })
    apply(s)
  } catch (err: any) {
    if (!state.snap) {
      state.snap = { generated: '', at: Date.now(), root: null, report: { name: null, items: [] }, projects: [], rootWorkspaceId: null, error: `The worker is not responding (${err?.message ?? err}).` }
      renderDrawer(false)
    } else toast(`Refresh failed: ${err?.message ?? err}`, false)
  }
}

orca.plugin.on('rc.updated', (s: Snapshot) => apply(s))
orca.plugin.on('rc.landed', ({ path }: { path: string; kind: 'push' | 'deploy' }) => {
  if (!state.launches.has(path)) return
  state.launches.delete(path)
  sky.land(path)
})
orca.plugin.on('rc.loading', ({ loading }: { loading: boolean }) => {
  state.loading = loading
  renderAgo()
})
orca.on('theme', () => requestAnimationFrame(() => sky.readColors()))
// A custom editor must ask for its document. The board never writes it; a file may name a
// project to open on (`{"select": "/path/to/repo"}`), which is how previews show the detail view.
let wanted: string | null = null
let wantedDoc: string | null = null
orca.document?.onDidChange?.((doc: { content?: { kind: string; text?: string } }) => {
  try {
    const parsed = JSON.parse(doc.content?.kind === 'text' ? (doc.content.text ?? '') : '{}')
    wanted = typeof parsed.select === 'string' ? parsed.select : null
    if ((parsed.layer === 'deps' || parsed.layer === 'tech') && parsed.layer !== state.layer) {
      state.layer = parsed.layer
      if (state.snap) refreshSky()
    }
    if (typeof parsed.domain === 'string') state.domain = parsed.domain
    if (['overview', 'docs', 'api', 'setup'].includes(parsed.tab)) state.tab = parsed.tab
    if (typeof parsed.doc === 'string') wantedDoc = parsed.doc
  } catch {
    wanted = null
  }
  if (wanted && byPath(wanted)) {
    select(wanted, false)
    if (wantedDoc) openDoc(wanted, wantedDoc)
    // done: the next refresh must not open it again after the user closed it
    wanted = null
    wantedDoc = null
  }
  layoutWide()
})
setInterval(renderAgo, 30_000)

hint.hidden = false
hint.textContent = 'Reading the projects…'
renderBar()
renderDrawer(false)
void Promise.all([
  orca.plugin.request('rc.positions.get', {}).catch(() => ({})),
  orca.storage.get('showTech').catch(() => null)
]).then(([positions, showTech]) => {
  state.positions = (positions as Positions) ?? {}
  state.showTech = showTech === true
}).finally(() => void load(false))
