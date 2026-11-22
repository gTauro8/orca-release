// Release Control worker: reads every project through the orca-release engine (dashboard.py --json),
// keeps the last snapshot, and turns board presses into work in the right workspace: plain terminals
// for what the recipe already spells out (status, services, dev — no model tokens), agents for the rest.
// Read-only on repositories: every change happens inside a skill, which asks before acting.
import type { OrcaWorkerApi } from 'orca/worker'
import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  ACTION_LABEL,
  PULL_COMMAND,
  SERVICES_FAILED,
  boardFile,
  focusedWorkspace,
  SERVICES_OK,
  attention,
  devTitle,
  fetchFailure,
  fetchSummary,
  needsConfirmation,
  promptFor,
  recipeSection,
  servicesCommand,
  shq,
  repoListFrom,
  reportLabels,
  summarizeGraph,
  workspaceFor,
  type ActionRequest,
  type GraphSummary,
  type Project,
  type ProjectInfo,
  type Snapshot,
  type Workspace,
  landed,
  type Launch
} from './model'
import { allAttention, needsYou, search, type AgentRow, type AgentState, type ProjectWork, type StandupRow } from './work'
import './protocol'

const BOARD_FILE = 'board.releasecontrol'
const AGENTS = new Set(['claude', 'codex', 'gemini', 'grok', 'opencode'])

function run(cmd: string, args: string[], timeoutMs = 90_000, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, env }, (err, stdout, stderr) => {
      if (err) reject(Object.assign(err, { stderr: String(stderr ?? '') }))
      else resolve(String(stdout))
    })
  })
}

async function readConfig(name: 'engine' | 'root'): Promise<string | null> {
  const env = name === 'engine' ? process.env.ORCA_RELEASE_ENGINE : process.env.ORCA_RELEASE_ROOT
  if (env) return env
  try {
    const v = (await fs.readFile(path.join(os.homedir(), '.config', 'orca-release', name), 'utf8')).trim()
    return v || null
  } catch {
    return null
  }
}

async function python(args: string[]): Promise<string> {
  let last: unknown
  for (const bin of ['python3', '/usr/bin/python3', '/opt/homebrew/bin/python3', '/usr/local/bin/python3']) {
    try {
      return await run(bin, ['-I', ...args])
    } catch (err) {
      last = err
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }
  }
  throw last ?? new Error('python3 not found')
}

/** Lines a bash engine script prints, or null when it exits non-zero (no section, bad recipe…). */
async function scriptLines(engine: string, script: string, args: string[]): Promise<string[] | null> {
  try {
    const out = await run('bash', [path.join(engine, 'scripts', script), ...args], 20_000)
    return out.split('\n').map((l) => l.trim()).filter(Boolean)
  } catch {
    return null
  }
}

/** `git fetch` in the background must never stop to ask for a password or a host key: it fails instead. */
const FETCH_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_TERMINAL_PROMPT: '0',
  GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND ?? 'ssh -o BatchMode=yes -o ConnectTimeout=10'
}

/** Runs `fn` over `items`, at most `limit` at a time. */
async function pool<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        out[i] = await fn(items[i])
      }
    })
  )
  return out
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Writes `text` to a temporary file only this call uses, runs `fn` with its path, then deletes it.
 * A fixed name per process let two overlapping reads (a refresh and a standup, or an old worker
 * still finishing after a reload) overwrite or delete each other's repo list.
 */
async function withTempFile<T>(prefix: string, text: string, fn: (file: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `release-control-${prefix}-`))
  const file = path.join(dir, 'repos.txt')
  try {
    await fs.writeFile(file, text, 'utf8')
    return await fn(file)
  } finally {
    void fs.rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}

const errorText = (err: unknown): string => {
  const e = err as { stderr?: string; message?: string }
  return ((e?.stderr || e?.message || String(err)) ?? '').trim().split('\n').pop() ?? ''
}

/** Stops the timers of the running worker: Orca may reload the plugin in the same process. */
let disposeWorker: (() => void) | null = null

async function listWorkspaces(orca: OrcaWorkerApi): Promise<Workspace[]> {
  const res = await orca.host.call('workspace.list', {})
  return res.workspaces as Workspace[]
}

/** The main checkout of every repository Orca has a workspace for. */
async function mainCheckouts(workspaces: Workspace[]): Promise<{ path: string; name: string }[]> {
  const seen = new Map<string, string>()
  await Promise.all(
    workspaces
      .filter((w) => w.kind === 'worktree' && !w.hostId?.startsWith('ssh'))
      .map(async (w) => {
        try {
          const common = (await run('git', ['-C', w.path, 'rev-parse', '--path-format=absolute', '--git-common-dir'], 10_000)).trim()
          if (common.endsWith('/.git')) {
            const root = common.slice(0, -5)
            if (!seen.has(root)) seen.set(root, path.basename(root))
          }
        } catch {
          // not a git folder (or gone): /status reports missing folders, the board only shows live repos
        }
      })
  )
  return [...seen.entries()].map(([p, name]) => ({ path: p, name })).sort((a, b) => a.name.localeCompare(b.name))
}

export default function activate(orca: OrcaWorkerApi): void {
  let snapshot: Snapshot | null = null
  let inflight: Promise<Snapshot> | null = null
  let timer: ReturnType<typeof setInterval> | null = null
  let debounce: ReturnType<typeof setTimeout> | null = null
  let disposed = false
  disposeWorker?.() // a previous activation in this process must not keep refreshing

  async function collect(): Promise<Snapshot> {
    const engine = await readConfig('engine')
    const rootCfg = await readConfig('root')
    const workspaces = await listWorkspaces(orca)
    const base: Snapshot = {
      generated: new Date().toISOString(),
      at: Date.now(),
      root: rootCfg,
      report: { name: null, items: [] },
      projects: [],
      rootWorkspaceId: rootCfg ? (workspaceFor(rootCfg, workspaces)?.id ?? null) : null
    }
    if (!engine) {
      return { ...base, error: 'The release skills are not set up on this machine: ask an agent to “set up the release skills” (/release-setup).' }
    }
    const mains = await mainCheckouts(workspaces)
    let data: { generated: string; root: string; report: Snapshot['report']; projects: Project[]; shared_deps?: Snapshot['shared_deps'] }
    try {
      data = await withTempFile('repos', repoListFrom(mains), async (listFile) => {
        const runningP = python([path.join(engine, 'scripts', 'work.py'), 'running', '--repo-list', listFile])
          .then((out) => JSON.parse(out) as Record<string, NonNullable<ProjectWork['running']>>)
          .catch(() => null)
        // wait for both before the list file goes away, even when the dashboard fails
        const [dash, running] = await Promise.all([python([path.join(engine, 'scripts', 'dashboard.py'), '--json', '--repo-list', listFile]).catch((e) => e as Error), runningP])
        if (dash instanceof Error) throw dash
        if (running) for (const [p, r] of Object.entries(running)) workOf(p).running = { processes: r.processes ?? [], services: r.services ?? [] }
        return JSON.parse(dash)
      })
      if (!Array.isArray(data?.projects)) throw new Error('the engine returned no project list')
    } catch (err) {
      const detail = errorText(err)
      const old = detail.includes('unrecognized arguments: --json')
      return {
        ...base,
        error: old
          ? 'The installed release skills are an older version: update them (./install.sh, or the share link) to use the board.'
          : `Could not read the projects (${detail}).`
      }
    }
    for (const p of data.projects) p.workspaceId = workspaceFor(p.path, workspaces)?.id ?? null
    await refreshCleanup(engine, data.projects)
    void refreshEnvs(engine, data.projects).then(() => publishWork())
    if (!prsLoaded) {
      prsLoaded = true
      void refreshPrs(data.projects).then(() => publishWork())
    }
    const root = data.root || rootCfg
    return {
      ...base,
      generated: data.generated,
      root,
      report: data.report,
      projects: data.projects,
      shared_deps: data.shared_deps ?? {},
      rootWorkspaceId: root ? (workspaceFor(root, workspaces)?.id ?? null) : null,
      agents: agentRows(),
      work: workSnapshot(data.projects)
    }
  }

  // ---------- the work around the code: PRs/CI, running, cleanup, agents ----------
  const work = new Map<string, ProjectWork>()
  const workOf = (p: string): ProjectWork => {
    let w = work.get(p)
    if (!w) work.set(p, (w = {}))
    return w
  }
  let prsLoaded = false
  const workSnapshot = (projects: Project[]) => Object.fromEntries(projects.filter((p) => work.has(p.path)).map((p) => [p.path, work.get(p.path)!]))

  /** Re-send the snapshot with the latest agents and work, without re-reading git. */
  function publishWork(): void {
    if (!snapshot) return
    snapshot = { ...snapshot, agents: agentRows(), work: workSnapshot(snapshot.projects) }
    orca.panels.post('rc.updated', snapshot)
    void updateStatusBar(snapshot)
  }

  async function refreshCleanup(engine: string, projects: Project[]): Promise<void> {
    await pool(projects.filter((p) => !p.missing), 4, async (p) => {
      const w = workOf(p.path)
      // independent: a failing cleanup scan must not hide the tags, and the other way round
      const [cleanup, releases] = await Promise.all(
        (['cleanup', 'releases'] as const).map((cmd) =>
          python([path.join(engine, 'scripts', 'work.py'), cmd, p.path])
            .then((out) => JSON.parse(out))
            .catch((err) => {
              orca.log(`${cmd} ${p.name}: ${errorText(err)}`)
              return null
            })
        )
      )
      // not a git repo or git failed: nothing to clean, no tags
      w.cleanup = cleanup ?? undefined
      w.releases = releases ?? undefined
    })
  }

  /** Health of every deploy target that has a url (network): on each refresh, in the background. */
  async function refreshEnvs(engine: string, projects: Project[]): Promise<void> {
    if ((await orca.settings.get('envCheck')) === false) return
    await pool(projects.filter((p) => !p.missing && (p.targets ?? []).length), 4, async (p) => {
      try {
        const r = JSON.parse(await python([path.join(engine, 'scripts', 'work.py'), 'health', p.path]))
        if ((r.targets ?? []).length) workOf(p.path).envs = { ...r, at: Date.now() }
      } catch {
        // recipe unreadable: keep the last result
      }
    })
  }

  /** Logs: a terminal the board started in this project, or one of its compose services. */
  async function logs(projectPath: string, source: string): Promise<{ lines: string[]; error: string | null }> {
    const w = work.get(projectPath)
    if (source.startsWith('terminal:')) {
      const id = source.slice(9)
      if (!w?.terminals?.some((t) => t.id === id)) return { lines: [], error: 'That terminal was not started by the board.' }
      try {
        const r = (await orca.host.call('terminal.read', { terminalId: id, maxLines: 200 })) as { lines: string[] }
        return { lines: r.lines, error: null }
      } catch {
        w.terminals = (w.terminals ?? []).filter((t) => t.id !== id)
        return { lines: [], error: 'That terminal is closed.' }
      }
    }
    if (source.startsWith('service:')) {
      const name = source.slice(8)
      if (!w?.running?.services.some((x) => x.name === name)) return { lines: [], error: 'Unknown service.' }
      const engine = await readConfig('engine')
      if (!engine) return { lines: [], error: 'Engine not configured.' }
      try {
        return JSON.parse(await python([path.join(engine, 'scripts', 'work.py'), 'logs', projectPath, name, '--lines', '200']))
      } catch {
        return { lines: [], error: 'docker compose logs failed.' }
      }
    }
    return { lines: [], error: 'Unknown log source.' }
  }

  /** Open PRs and the last CI run per project (network): on startup and with every fetch. */
  async function refreshPrs(projects: Project[]): Promise<void> {
    const engine = await readConfig('engine')
    if (!engine) return
    const gitea = (await orca.settings.get('giteaAuth')) === true
    await pool(projects.filter((p) => !p.missing), 3, async (p) => {
      try {
        const args = [path.join(engine, 'scripts', 'work.py'), 'prs', p.path, ...(gitea ? ['--gitea-auth'] : [])]
        workOf(p.path).prs = { ...JSON.parse(await python(args)), at: Date.now() }
      } catch {
        // gh missing or the script failed: keep what we had
      }
    })
  }

  const agents = new Map<string, AgentRow>()
  const wsProject = new Map<string, string | null>()
  const agentRows = () => [...agents.values()].sort((a, b) => Number(needsYou(b)) - Number(needsYou(a)) || b.since - a.since)

  /** The project (main checkout) a workspace belongs to, if the board knows it. */
  async function projectOfWorkspace(workspaceId: string): Promise<string | null> {
    const hit = wsProject.get(workspaceId)
    if (hit) return hit
    const ws = (await listWorkspaces(orca)).find((w) => w.id === workspaceId)
    const main = ws ? await mainCheckoutOf(ws.path) : null
    const known = main && (await current()).projects.some((p) => p.path === main) ? main : null
    // only a hit is remembered: a workspace the board does not know yet may belong to a project after the next refresh
    if (known) wsProject.set(workspaceId, known)
    return known
  }

  async function onAgent(e: { workspaceId: string | null; paneKey: string; terminalId?: string; title?: string; state: AgentState }): Promise<void> {
    const before = agents.get(e.paneKey)
    if (e.state === 'done') {
      agents.delete(e.paneKey)
      soon(4000)
    } else {
      const projectPath = e.workspaceId ? await projectOfWorkspace(e.workspaceId) : null
      if (!projectPath || !e.workspaceId) return
      const row: AgentRow = { paneKey: e.paneKey, path: projectPath, workspaceId: e.workspaceId, terminalId: e.terminalId, title: e.title, state: e.state, since: before?.state === e.state ? before.since : Date.now() }
      agents.set(e.paneKey, row)
      if (needsYou(row) && !(before && needsYou(before)) && (await orca.settings.get('notifyAgents')) !== false) {
        const name = (await current()).projects.find((p) => p.path === projectPath)?.name ?? 'A project'
        void notify(`${name}: an agent needs you`, row.title ? `${row.title} is ${row.state}.` : `It is ${row.state}: open it to answer.`)
      }
    }
    publishWork()
  }

  async function notify(title: string, body: string): Promise<void> {
    try {
      await orca.host.call('notifications.show', { title: title.slice(0, 120), body: body.slice(0, 400) })
    } catch {
      // headless or notifications refused: the board and status bar still show it
    }
  }

  /** Push/deploy presses waiting to show up in the data (the board animates; this notifies). */
  const launches = new Map<string, Launch>()
  async function checkLaunches(s: Snapshot): Promise<void> {
    for (const [p, l] of launches) {
      const proj = s.projects.find((x) => x.path === p)
      if (!proj || Date.now() - l.at > 20 * 60_000) {
        launches.delete(p)
        continue
      }
      if (landed(l, proj)) {
        launches.delete(p)
        orca.panels.post('rc.landed', { path: p, kind: l.kind })
        if ((await orca.settings.get('notifyReleases')) !== false)
          void notify(l.kind === 'push' ? `${proj.name}: pushed` : `${proj.name}: released`, l.kind === 'push' ? `${proj.branch ?? ''} is on the remote.` : proj.tag ? `New tag ${proj.tag}.` : 'Nothing left to release.')
      }
    }
  }

  function openUrl(url: string): Promise<string> {
    const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open'
    return run(cmd, [url], 10_000)
  }

  async function standup(since: string): Promise<{ rows: StandupRow[]; since: string }> {
    const engine = await readConfig('engine')
    const s = await current()
    if (!engine) return { rows: [], since }
    const list = repoListFrom(s.projects.filter((p) => !p.missing).map((p) => ({ path: p.path, name: p.name })))
    try {
      const rows = await withTempFile('standup', list, async (f) => JSON.parse(await python([path.join(engine, 'scripts', 'work.py'), 'standup', '--repo-list', f, '--since', since])))
      return { rows: Array.isArray(rows) ? rows : [], since }
    } catch (err) {
      orca.log(`standup: ${errorText(err)}`)
      return { rows: [], since }
    }
  }

  async function refresh(): Promise<Snapshot> {
    if (inflight) return inflight
    orca.panels.post('rc.loading', { loading: true })
    inflight = collect()
      .then(async (s) => {
        if (s.error && snapshot && !snapshot.error) s = { ...snapshot, error: s.error, at: Date.now() }
        snapshot = s
        void checkLaunches(s)
        await orca.storage.set('snapshot', s as never)
        orca.panels.post('rc.updated', s)
        void updateStatusBar(s)
        return s
      })
      .finally(() => {
        inflight = null
        orca.panels.post('rc.loading', { loading: false })
      })
    return inflight
  }

  async function updateStatusBar(s: Snapshot): Promise<void> {
    const items = allAttention(s).filter((a) => a.state !== 'missing')
    const n = new Set(items.map((a) => a.project)).size
    const waiting = items.filter((a) => a.state === 'agent').length
    try {
      await orca.host.call('statusBar.update', {
        id: 'attention',
        text: s.error ? 'Release Control' : waiting ? `${waiting} agent${waiting === 1 ? '' : 's'} waiting` : n ? `${n} need attention` : 'all clean',
        tone: s.error ? 'danger' : n ? 'warning' : 'success',
        tooltip: n ? `${n} projects have pending work: open the board` : 'No pending work'
      })
    } catch {
      // status bar is desktop-only; nothing to do elsewhere
    }
  }

  function soon(ms = 2500): void {
    if (disposed) return
    if (debounce) clearTimeout(debounce)
    debounce = setTimeout(() => void refresh().catch((e) => orca.log(`refresh: ${e}`)), ms)
    debounce.unref?.()
  }

  async function current(): Promise<Snapshot> {
    if (snapshot) return snapshot
    const stored = (await orca.storage.get('snapshot')) as Snapshot | null
    if (stored && stored.projects) {
      snapshot = stored
      soon(50)
      return stored
    }
    return refresh()
  }

  async function agentName(): Promise<string> {
    const v = await orca.settings.get('agent')
    return typeof v === 'string' && AGENTS.has(v) ? v : 'claude'
  }

  /** Is `pid` alive with its working folder still at `cwd`? (lsof, as work.py found it.) */
  async function sameProcess(pid: number, cwd: string): Promise<boolean> {
    try {
      const out = await run('lsof', ['-a', '-d', 'cwd', '-p', String(pid), '-Fn'], 10_000)
      return out.split('\n').some((l) => l.startsWith('n') && l.slice(1) === cwd)
    } catch {
      return false
    }
  }

  /** Every press answers with a message: a failure in a script or an Orca call never reaches the board as a crash. */
  async function act(req: ActionRequest): Promise<{ ok: boolean; message: string }> {
    try {
      return await actUnsafe(req)
    } catch (err) {
      orca.log(`action ${req.action}: ${errorText(err)}`)
      return { ok: false, message: `${ACTION_LABEL[req.action] ?? 'That'} failed: ${errorText(err) || 'unknown error'}` }
    }
  }

  async function actUnsafe(req: ActionRequest): Promise<{ ok: boolean; message: string }> {
    const s = await current()
    const project = req.path ? s.projects.find((p) => p.path === req.path) : undefined
    const label = req.action === 'deploy' && req.text ? `Rollback ${req.target ?? ''} to ${req.text}` : req.action === 'deploy' && req.target ? `Deploy ${req.target}` : ACTION_LABEL[req.action]
    if (req.action === 'fetch') return fetchAll()
    if (req.action === 'pr-open') {
      if (!req.target || !/^https:\/\//.test(req.target)) return { ok: false, message: 'Not a web link.' }
      const known = Object.values((await current()).work ?? {}).some(
        (w) => w.prs?.ci?.url === req.target || w.prs?.prs.some((x) => x.url === req.target) || w.envs?.targets.some((t) => t.url === req.target)
      )
      if (!known) return { ok: false, message: 'Unknown link: fetch again.' }
      await openUrl(req.target)
      return { ok: true, message: 'Opened in the browser' }
    }
    if (req.action === 'agent') {
      const a = req.target ? agents.get(req.target) : undefined
      if (!a) return { ok: false, message: 'That agent is gone.' }
      await orca.host.call('workspace.open', { workspaceId: a.workspaceId })
      return { ok: true, message: `Opened the workspace of ${(s.projects.find((p) => p.path === a.path)?.name) ?? 'the agent'}: its tab is “${a.title ?? 'agent'}”` }
    }
    if (req.action === 'status') {
      if (!s.rootWorkspaceId) return { ok: false, message: 'The data folder is not an Orca workspace: add it to Orca to run /status.' }
      const engine = await readConfig('engine')
      if (engine) {
        // The status table is a script: no agent needed to print it.
        await terminal(s.rootWorkspaceId, 'status', `python3 -I ${shq(path.join(engine, 'scripts', 'status.py'))}`)
        await orca.host.call('workspace.open', { workspaceId: s.rootWorkspaceId })
        return { ok: true, message: 'Status shown in a terminal of the data folder' }
      }
      await launchAgent(s.rootWorkspaceId, '/status')
      return { ok: true, message: 'Status started in the data folder' }
    }
    if (!project) return { ok: false, message: 'Project not found: refresh the data.' }
    if (!project.workspaceId) return { ok: false, message: `${project.name} has no workspace in Orca.` }
    const workspaceId = project.workspaceId
    if (req.action === 'open') {
      await orca.host.call('workspace.open', { workspaceId })
      return { ok: true, message: `${project.name} opened` }
    }
    if (req.action === 'recipe') {
      if (!project.recipe_file) return { ok: false, message: `${project.name} has no recipe yet: press Push to create one.` }
      if (!s.rootWorkspaceId) return { ok: false, message: 'The data folder is not an Orca workspace.' }
      await openFile(s.rootWorkspaceId, project.recipe_file)
      return { ok: true, message: `Recipe of ${project.name} opened` }
    }
    if (req.action === 'kill') {
      // Only a process the board found listening inside this project; SIGTERM lets it shut down cleanly.
      const pid = Number(req.target)
      const proc = Number.isInteger(pid) && pid > 1 ? work.get(project.path)?.running?.processes.find((x) => x.pid === pid) : undefined
      if (!proc) return { ok: false, message: 'That process is not running in this project any more.' }
      // the list can be minutes old and pids get reused: it must still be the same process in the same folder
      if (!(await sameProcess(pid, proc.cwd))) {
        soon(200)
        return { ok: false, message: `${proc.command} is not running there any more: refreshing.` }
      }
      try {
        process.kill(pid, 'SIGTERM')
      } catch (err) {
        return { ok: false, message: `Could not stop it: ${(err as Error).message}` }
      }
      soon(1500)
      return { ok: true, message: `Stopped ${proc.command} (port ${proc.ports.join(', ')})` }
    }
    if (req.action === 'cleanup') {
      const what = req.target === 'worktrees' ? 'worktrees' : req.target === 'branches' ? 'branches' : null
      const engine = await readConfig('engine')
      if (!what || !engine) return { ok: false, message: 'Nothing to clean up.' }
      const res = JSON.parse(await python([path.join(engine, 'scripts', 'work.py'), 'cleanup', project.path, '--apply', what])) as { done: string[]; failed: string[] }
      await refreshCleanup(engine, [project])
      soon(500)
      const label = what === 'branches' ? 'merged branches' : 'merged worktrees'
      return {
        ok: res.failed.length === 0,
        message: `${project.name}: removed ${res.done.length} ${label}${res.failed.length ? `, kept ${res.failed.length} git refused to delete` : ''}`
      }
    }
    if (req.action === 'script') {
      // Only a script the project itself declares (package.json, Makefile): never arbitrary text from the board.
      const info = await projectInfo(project.path, true)
      const sc = info?.scripts.find((x) => x.run === req.text)
      if (!sc) return { ok: false, message: 'Unknown script for this project: refresh the page.' }
      await terminal(workspaceId, `run: ${sc.name}`, sc.run, project.path)
      await orca.host.call('workspace.open', { workspaceId })
      return { ok: true, message: `${sc.run} started in ${project.name} (terminal, no agent)` }
    }
    if (req.action === 'pull') {
      // Fast-forward only: never a merge or a rebase the user did not ask for. Git stops and says why otherwise.
      await terminal(workspaceId, 'pull', PULL_COMMAND, project.path)
      await orca.host.call('workspace.open', { workspaceId })
      soon(8000)
      return { ok: true, message: `Pulling ${project.name} (fast-forward only)` }
    }
    if (req.action === 'stop') {
      const engine = await readConfig('engine')
      const recipe = project.recipe_file ? await fs.readFile(project.recipe_file, 'utf8').catch(() => null) : null
      const section = recipe == null ? null : recipeSection(recipe, 'compose')
      const cmds = engine && project.recipe_file && section != null && !needsConfirmation(section)
        ? await scriptLines(engine, 'compose-cmd.sh', [project.recipe_file, 'stop'])
        : null
      if (cmds?.length) {
        await terminal(workspaceId, 'services: stop', cmds.join(' && '), project.path)
        started.delete(`compose:${project.path}`)
        started.delete(`dev:${project.path}`)
        await orca.host.call('workspace.open', { workspaceId })
        return { ok: true, message: `Stopping the services of ${project.name} (terminal, no agent)` }
      }
    }
    if (req.action === 'compose' || req.action === 'dev') {
      const direct = await runDirect(req.action, project, workspaceId)
      if (direct) return direct
    }
    if (req.action === 'deploy' && req.text && !work.get(project.path)?.releases?.tags.some((t) => t.tag === req.text))
      return { ok: false, message: `${req.text} is not a tag of ${project.name}.` }
    const prompt = promptFor(req, project.graphify === true)
    if (!prompt) return { ok: false, message: 'Write what the new task should do.' }
    await launchAgent(workspaceId, prompt)
    if (req.action === 'push' || req.action === 'deploy')
      launches.set(project.path, { kind: req.action, at: Date.now(), ahead: project.ahead ?? 0, dirty: project.dirty ?? 0, tag: project.tag ?? null, since: project.since ?? 0 })
    return { ok: true, message: `${label} started in ${project.name}` }
  }

  /**
   * Starts the agent with the skill as its first message, and makes sure the message arrives.
   * Orca's agent.launch sends the prompt right after starting the CLI and drops it when the agent is not
   * up yet ("agent_launch_terminal_not_running_agent"). So once the agent's screen settles, if the prompt
   * is not on it, type it and press Enter. Returns at once; the check runs in the background.
   */
  async function launchAgent(workspaceId: string, prompt: string): Promise<void> {
    const res = (await orca.host.call('agent.launch', { workspaceId, agent: await agentName(), prompt })) as { terminalId: string }
    await orca.host.call('workspace.open', { workspaceId })
    void ensurePrompt(res.terminalId, prompt).catch((e) => orca.log(`prompt check ${res.terminalId}: ${e}`))
  }

  async function ensurePrompt(terminalId: string, prompt: string): Promise<void> {
    const step = Number(process.env.RC_AGENT_POLL_MS) || 1500
    const until = Date.now() + 40 * step
    // only the agent's input line counts ("❯ /push", "> /push", "› /push"): its startup screen may list the
    // skills too ("skill: /push /pr …"), and that is not the prompt arriving
    const head = prompt.slice(0, 60)
    const shown = (lines: string[]) => lines.some((l) => l.trim().replace(/^[❯>›»]\s*/, '').startsWith(head))
    let last = ''
    let stable = 0
    while (Date.now() < until) {
      await sleep(step)
      const lines = ((await orca.host.call('terminal.read', { terminalId, maxLines: 60 })) as { lines: string[] }).lines
      if (shown(lines)) return
      const now = lines.join('\n').trim()
      stable = now && now === last ? stable + 1 : 0
      last = now
      // the agent's screen has drawn and stopped changing for two reads: it is waiting for input
      if (stable >= 2) {
        await orca.host.call('terminal.sendText', { terminalId, text: prompt, enter: true })
        orca.log(`prompt typed into ${terminalId} (Orca had not delivered it)`)
        return
      }
    }
    orca.log(`prompt check ${terminalId}: the agent never settled; prompt not typed`)
  }

  async function terminal(workspaceId: string, title: string, command: string, projectPath?: string): Promise<string> {
    const res = await orca.host.call('terminal.create', { workspaceId, title, command })
    const id = res.terminalId as string
    if (projectPath) {
      // remembered so the board can show its logs; the newest 12 per project
      const w = workOf(projectPath)
      w.terminals = [...(w.terminals ?? []).filter((t) => t.id !== id), { id, title }].slice(-12)
    }
    return id
  }

  /** Terminals this worker started per project (services, dev), so a second press doesn't start them twice. */
  const started = new Map<string, string[]>()

  async function alive(ids: string[]): Promise<boolean> {
    for (const id of ids) {
      try {
        await orca.host.call('terminal.read', { terminalId: id, maxLines: 1 })
        return true
      } catch {
        // closed
      }
    }
    return false
  }

  /**
   * /compose up and /dev without an agent, when the recipe already has confirmed commands for them.
   * Returns null when an agent is needed instead (no section yet, unconfirmed steps, unreadable recipe).
   */
  async function runDirect(action: 'compose' | 'dev', project: Project, workspaceId: string): Promise<{ ok: boolean; message: string } | null> {
    const engine = await readConfig('engine')
    if (!engine || !project.recipe_file) return null
    const recipe = await fs.readFile(project.recipe_file, 'utf8').catch(() => null)
    if (recipe == null) return null
    const compose = recipeSection(recipe, 'compose')
    const dev = recipeSection(recipe, 'dev')
    if (compose != null && needsConfirmation(compose)) return null
    if (action === 'dev' && (dev == null || needsConfirmation(dev))) return null
    if (action === 'compose' && compose == null) return null

    const composeCmds = compose != null ? await scriptLines(engine, 'compose-cmd.sh', [project.recipe_file, 'up']) : []
    if (composeCmds == null) return null
    const devCmds = action === 'dev' ? await scriptLines(engine, 'dev-cmds.sh', [project.recipe_file]) : []
    if (devCmds == null || (action === 'dev' && devCmds.length === 0 && composeCmds.length === 0)) return null

    const key = `${action}:${project.path}`
    const before = started.get(key)
    if (before && (await alive(before))) {
      await orca.host.call('workspace.open', { workspaceId })
      return { ok: true, message: `${ACTION_LABEL[action]} is already running in ${project.name}` }
    }

    const ids: string[] = []
    const startDev = async () => {
      for (const cmd of devCmds) ids.push(await terminal(workspaceId, devTitle(cmd), cmd, project.path))
    }
    if (composeCmds.length) {
      const svc = await terminal(workspaceId, 'services', servicesCommand(composeCmds), project.path)
      ids.push(svc)
      if (devCmds.length) void waitForServices(svc).then(async (ok) => {
        if (ok) await startDev()
        else orca.log(`dev ${project.name}: services did not come up, dev processes not started`)
      })
    } else {
      await startDev()
    }
    started.set(key, ids)
    await orca.host.call('workspace.open', { workspaceId })
    const what = action === 'compose' ? 'Services starting' : composeCmds.length ? 'Services starting, then dev' : 'Dev started'
    return { ok: true, message: `${what} in ${project.name} (terminals, no agent)` }
  }

  /** Waits for the services terminal to print its marker; false on failure or after 5 minutes. */
  async function waitForServices(terminalId: string): Promise<boolean> {
    const until = Date.now() + 5 * 60_000
    while (Date.now() < until) {
      await sleep(2000)
      let lines: string[]
      try {
        lines = ((await orca.host.call('terminal.read', { terminalId, maxLines: 40 })) as { lines: string[] }).lines
      } catch {
        return false
      }
      if (lines.some((l) => l.includes(SERVICES_OK))) return true
      if (lines.some((l) => l.includes(SERVICES_FAILED))) return false
    }
    return false
  }

  let fetching: Promise<{ ok: boolean; message: string }> | null = null

  /** `git fetch --all --prune` in every project, a few at a time, then a refresh: "to pull" and "to push" become current. */
  function fetchAll(): Promise<{ ok: boolean; message: string }> {
    if (fetching) return fetching
    fetching = (async () => {
      const repos = (await current()).projects.filter((p) => !p.missing)
      const failed: { name: string; reason: string }[] = []
      await pool(repos, 4, async (p) => {
        try {
          await run('git', ['-C', p.path, 'fetch', '--all', '--prune', '--quiet'], 45_000, FETCH_ENV)
        } catch (err) {
          const e = err as { stderr?: string; killed?: boolean }
          failed.push({ name: p.name, reason: e.killed ? 'server not answering' : fetchFailure(e.stderr ?? '') })
        }
      })
      await refreshPrs(repos)
      const s = await refresh()
      const behind = s.projects.filter((p) => (p.behind ?? 0) > 0).length
      return { ok: failed.length === 0, message: fetchSummary(repos.length, failed, behind) }
    })().finally(() => {
      fetching = null
    })
    return fetching
  }

  /** What Orca reports as focused (name and branch); the board opens there. */
  let focused: { displayName: string; branch: string } | null = null
  orca.events.on('workspace.changed', (e) => {
    focused = (e as { context: typeof focused }).context ?? null
  })

  /** Keeps the board file out of git without touching the project's .gitignore (local exclude only). */
  async function excludeLocally(dir: string, rel: string): Promise<void> {
    try {
      const out = (await run('git', ['-C', dir, 'rev-parse', '--git-path', 'info/exclude'], 10_000)).trim()
      const file = path.isAbsolute(out) ? out : path.join(dir, out)
      const line = '/' + rel
      const text = await fs.readFile(file, 'utf8').catch(() => '')
      if (text.split('\n').some((l) => l.trim() === line)) return
      await fs.mkdir(path.dirname(file), { recursive: true })
      await fs.appendFile(file, `${text && !text.endsWith('\n') ? '\n' : ''}# Release Control board (local only)\n${line}\n`)
    } catch {
      // not a git folder: nothing to hide
    }
  }

  /** The main checkout a workspace belongs to: the board shows projects by their main checkout. */
  async function mainCheckoutOf(dir: string): Promise<string> {
    try {
      const common = (await run('git', ['-C', dir, 'rev-parse', '--path-format=absolute', '--git-common-dir'], 10_000)).trim()
      return common.endsWith('/.git') ? common.slice(0, -5) : dir
    } catch {
      return dir
    }
  }

  const infoCache = new Map<string, { at: number; head: string; info: ProjectInfo | null }>()

  /** project_info.py for one project, cached until HEAD moves or a minute passes. */
  async function projectInfo(projectPath: string, fresh = false): Promise<ProjectInfo | null> {
    const s = await current()
    if (!s.projects.some((p) => p.path === projectPath && !p.missing)) return null
    const engine = await readConfig('engine')
    if (!engine) return null
    const head = (await run('git', ['-C', projectPath, 'rev-parse', 'HEAD'], 10_000).catch(() => '')).trim()
    const hit = infoCache.get(projectPath)
    if (!fresh && hit && hit.head === head && Date.now() - hit.at < 60_000) return hit.info
    let info: ProjectInfo | null = null
    try {
      info = JSON.parse(await python([path.join(engine, 'scripts', 'project_info.py'), projectPath]))
    } catch (err) {
      orca.log(`project_info ${projectPath}: ${(err as Error).message}`)
    }
    infoCache.set(projectPath, { at: Date.now(), head, info })
    return info
  }

  async function docText(projectPath: string, doc: string): Promise<{ text: string } | null> {
    const s = await current()
    const engine = await readConfig('engine')
    if (!engine || !s.projects.some((p) => p.path === projectPath)) return null
    try {
      return { text: await python([path.join(engine, 'scripts', 'project_info.py'), projectPath, '--doc', doc]) }
    } catch {
      return null
    }
  }

  async function openProjectFile(projectPath: string, file: string): Promise<{ ok: boolean; message: string }> {
    const p = (await current()).projects.find((x) => x.path === projectPath)
    if (!p?.workspaceId) return { ok: false, message: 'This project has no workspace in Orca.' }
    const rel = path.normalize(file)
    if (path.isAbsolute(rel) || rel.startsWith('..')) return { ok: false, message: 'That file is outside the project.' }
    await orca.host.call('editor.open', { workspaceId: p.workspaceId, path: rel.split(path.sep).join('/') })
    return { ok: true, message: `${rel} opened` }
  }

  /** editor.open takes a path relative to the workspace folder. */
  async function openFile(workspaceId: string, file: string): Promise<void> {
    const ws = (await listWorkspaces(orca)).find((w) => w.id === workspaceId)
    const base = (ws?.path ?? '').replace(/\/+$/, '')
    const rel = base && file.startsWith(base + '/') ? file.slice(base.length + 1) : file
    await orca.host.call('editor.open', { workspaceId, path: rel })
  }

  async function openBoard(): Promise<{ ok: boolean; message: string }> {
    const s = await current()
    const here = focusedWorkspace(focused, await listWorkspaces(orca))
    if (here && here.id !== s.rootWorkspaceId && !here.hostId?.startsWith('ssh')) {
      // Open the board right in the project being worked on, focused on it.
      const rel = path.join('.orca', BOARD_FILE)
      const file = path.join(here.path, rel)
      const main = await mainCheckoutOf(here.path)
      const known = s.projects.some((p) => p.path === main)
      await fs.mkdir(path.dirname(file), { recursive: true })
      await fs.writeFile(file, boardFile(known ? main : null))
      await excludeLocally(here.path, rel)
      await orca.host.call('editor.open', { workspaceId: here.id, path: rel })
      return { ok: true, message: `Board opened in ${here.name}` }
    }
    const root = s.root ?? (await readConfig('root'))
    if (!root) return { ok: false, message: 'No data folder configured: ask an agent to “set up the release skills” (/release-setup).' }
    const wsId = s.rootWorkspaceId ?? workspaceFor(root, await listWorkspaces(orca))?.id ?? null
    if (!wsId) return { ok: false, message: `Add the data folder (${root}) to Orca as a project to open the board.` }
    const file = path.join(root, 'dashboard', BOARD_FILE)
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, '{}\n', { flag: 'wx' }).catch(() => undefined)
    await openFile(wsId, file)
    return { ok: true, message: 'Board opened' }
  }

  async function graph(projectPath: string): Promise<GraphSummary | null> {
    // only the projects on the board: the frame never picks an arbitrary folder to read
    if (!(await current()).projects.some((p) => p.path === projectPath && !p.missing)) return null
    const dir = path.join(projectPath, 'graphify-out')
    let parsed: Parameters<typeof summarizeGraph>[0]
    try {
      parsed = JSON.parse(await fs.readFile(path.join(dir, 'graph.json'), 'utf8'))
    } catch {
      return null // no graph, or one being rewritten right now
    }
    if (!parsed || typeof parsed !== 'object') return null
    const report = await fs.readFile(path.join(dir, 'GRAPH_REPORT.md'), 'utf8').catch(() => '')
    const summary = summarizeGraph(parsed, reportLabels(report))
    // a commit hash only: the value comes from a file in the repo and goes on a git command line
    if (summary.builtAt && /^[0-9a-f]{7,64}$/i.test(summary.builtAt)) {
      const behind = await run('git', ['-C', projectPath, 'rev-list', '--count', `${summary.builtAt}..HEAD`], 10_000).catch(() => '')
      ;(summary as GraphSummary & { behind?: number }).behind = behind.trim() ? Number(behind) : undefined
    }
    return summary
  }

  orca.panels.handle('rc.snapshot', async ({ refresh: fresh }) => (fresh ? refresh() : current()))
  orca.panels.handle('rc.action', (req) => act(req))
  orca.panels.handle('rc.graph', ({ path: p }) => graph(p))
  orca.panels.handle('rc.openBoard', () => openBoard())
  orca.panels.handle('rc.project', ({ path: p }) => projectInfo(p))
  orca.panels.handle('rc.logs', ({ path: p, source }) => logs(p, source))
  orca.panels.handle('rc.standup', ({ since }) => standup(since || 'yesterday 00:00'))
  orca.panels.handle('rc.search', async ({ q }) => {
    const s = await current()
    const infos = new Map<string, ProjectInfo>()
    await pool(s.projects.filter((p) => !p.missing), 4, async (p) => {
      const i = await projectInfo(p.path)
      if (i) infos.set(p.path, i)
    })
    return search(q, s.projects, infos)
  })
  orca.panels.handle('rc.doc', ({ path: p, doc }) => docText(p, doc))
  orca.panels.handle('rc.openFile', ({ path: p, file }) => openProjectFile(p, file))
  orca.panels.handle('rc.positions.get', async () => ((await orca.storage.get('positions')) as Record<string, [number, number]> | null) ?? {})
  orca.panels.handle('rc.positions.set', async (positions) => {
    await orca.storage.set('positions', positions as never)
    return { ok: true }
  })

  orca.commands.register('open', async () => (await openBoard()).message)
  orca.commands.register('fetch', async () => (await fetchAll()).message)
  orca.commands.register('refresh', async () => {
    const s = await refresh()
    return s.error ?? `Updated: ${s.projects.length} projects`
  })

  orca.events.on('workspace.created', () => soon())
  orca.events.on('workspace.removed', (e) => {
    // its agents will never send "done": drop them with the workspace
    const id = (e as { workspaceId?: string }).workspaceId
    wsProject.clear()
    let gone = false
    for (const [k, a] of agents) if (a.workspaceId === id) gone = agents.delete(k) || gone
    if (gone) publishWork()
    soon()
  })
  // one at a time: two quick events for the same agent must not both look like "it just started waiting"
  let agentQueue: Promise<void> = Promise.resolve()
  orca.events.on('agent.status.changed', (e) => {
    agentQueue = agentQueue.then(() => onAgent(e as Parameters<typeof onAgent>[0])).catch((err) => orca.log(`agent event: ${err}`))
  })

  // Optional background fetch (0 = off), so "to pull" stays true without anyone pressing Fetch.
  let fetchTimer: ReturnType<typeof setInterval> | null = null
  async function scheduleFetch(): Promise<void> {
    if (fetchTimer) clearInterval(fetchTimer)
    fetchTimer = null
    const m = Number(await orca.settings.get('fetchMinutes'))
    if (disposed || !Number.isFinite(m) || m <= 0) return
    fetchTimer = setInterval(() => void fetchAll().catch(() => undefined), Math.max(5, m) * 60_000)
    fetchTimer.unref?.()
  }

  void (async () => {
    await scheduleFetch()
    const minutes = Number(await orca.settings.get('refreshMinutes')) || 5
    if (disposed) return
    timer = setInterval(() => void refresh().catch(() => undefined), Math.max(1, minutes) * 60_000)
    timer.unref?.()
    void updateStatusBar(await current())
  })().catch((e) => orca.log(`startup: ${e}`))

  orca.settings.onDidChange(({ key }) => {
    if (disposed) return
    if (key === 'fetchMinutes') return void scheduleFetch()
    // what the snapshot shows changes with these: read again instead of waiting for the next tick
    if (key === 'envCheck' || key === 'giteaAuth') {
      if (key === 'giteaAuth') prsLoaded = false
      return soon(300)
    }
    if (key !== 'refreshMinutes') return
    void orca.settings.get('refreshMinutes').then((v) => {
      if (disposed) return
      if (timer) clearInterval(timer)
      timer = setInterval(() => void refresh().catch(() => undefined), Math.max(1, Number(v) || 5) * 60_000)
      timer.unref?.()
    })
  })

  disposeWorker = () => {
    disposed = true
    if (timer) clearInterval(timer)
    if (fetchTimer) clearInterval(fetchTimer)
    if (debounce) clearTimeout(debounce)
    timer = fetchTimer = debounce = null
  }
}

export function deactivate(): void {
  disposeWorker?.()
  disposeWorker = null
}
