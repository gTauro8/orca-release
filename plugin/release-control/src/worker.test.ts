// Runs the real worker over a mock Orca host, a throwaway git repo and a fake engine whose
// dashboard.py echoes the repo list it was given, so the whole read -> act path is exercised.
import { afterEach, assert, mockHost, mountWorker, test, type TestWorker } from 'orca/testing'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as main from './worker'

process.env.RC_AGENT_POLL_MS = '15'
let worker: TestWorker | undefined
let dir = ''
const HOME = process.env.HOME
afterEach(async () => {
  await worker?.deactivate()
  worker = undefined
  if (dir) rmSync(dir, { recursive: true, force: true })
  delete process.env.ORCA_RELEASE_ENGINE
  delete process.env.ORCA_RELEASE_ROOT
  process.env.HOME = HOME
})

const FAKE_DASHBOARD = `
import json, sys
lst = open(sys.argv[sys.argv.index("--repo-list") + 1]).read().split("\\n")
projects = []
for line in lst:
    parts = line.split(None, 2)
    if len(parts) == 3:
        projects.append({"name": parts[1], "path": parts[2], "missing": False, "branch": "main", "dirty": 2,
                         "ahead": 1, "recipe": "ok", "recipe_file": "RECIPE", "targets": ["prod"], "weeks": [0]*12})
print(json.dumps({"generated": "2026-11-20T10:00:00", "root": "ROOT",
                  "report": {"name": "2026-11-16", "items": ["uno"]}, "projects": projects,
                  "shared_deps": {"left-pad": {"/a": "1.0.0", "/b": "1.3.0"}}}))
`

let RECIPE = '# my-app\n\n## compose\nfile: compose.yml\nproject: app\n\n## dev\n- [ ] `npm run dev`\n- [ ] `npm run worker`\n'

function setup(terminalLines: string[] = ['release-control: services ready']) {
  dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'rc-test-')))
  const repo = path.join(dir, 'my app')
  const root = path.join(dir, 'data')
  mkdirSync(repo)
  mkdirSync(path.join(root, 'dashboard'), { recursive: true })
  execFileSync('git', ['init', '-q', '-b', 'main', repo])
  const engine = path.join(dir, 'engine')
  mkdirSync(path.join(engine, 'scripts'), { recursive: true })
  const recipe = path.join(root, 'recipes', 'my-app.md')
  mkdirSync(path.dirname(recipe), { recursive: true })
  writeFileSync(recipe, RECIPE)
  writeFileSync(path.join(engine, 'scripts', 'dashboard.py'), FAKE_DASHBOARD.replace('ROOT', root).replace('RECIPE', recipe))
  for (const f of ['work.py', 'status.py', 'lib.sh', 'find-recipe.sh'])
    writeFileSync(path.join(engine, 'scripts', f), readFileSync(path.resolve('..', '..', 'skills', 'orca-release', 'scripts', f)))
  writeFileSync(path.join(engine, 'scripts', 'project_info.py'), readFileSync(path.resolve('..', '..', 'skills', 'orca-release', 'scripts', 'project_info.py')))
  writeFileSync(path.join(repo, 'README.md'), '# My app\n\n## Run\n')
  writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ scripts: { 'start:dev': 'nest start --watch' } }))
  writeFileSync(path.join(engine, 'scripts', 'compose-cmd.sh'), 'grep -q "^## compose" "$1" || exit 2; echo "docker compose -p app up -d --wait db"\n')
  writeFileSync(path.join(engine, 'scripts', 'dev-cmds.sh'), 'grep -q "^## dev" "$1" || exit 2; echo "npm run dev"; echo "npm run worker"\n')
  process.env.ORCA_RELEASE_ENGINE = engine
  process.env.ORCA_RELEASE_ROOT = root
  const host = mockHost({
    settings: { agent: 'codex', refreshMinutes: 5 },
    results: {
      'workspace.list': {
        workspaces: [
          { id: 'ws-app', kind: 'worktree', name: 'my app', path: repo, branch: 'main', hostId: null },
          { id: 'ws-data', kind: 'folder', name: 'data', path: root, branch: null, hostId: null }
        ],
        truncated: false
      },
      'agent.launch': { terminalId: 't1' },
      'terminal.create': { terminalId: 'term-1' },
      'terminal.sendText': { accepted: true },
      'notifications.show': { ok: true },
      'terminal.read': { lines: terminalLines, truncated: false },
      'workspace.open': { opened: true },
      'editor.open': { opened: true },
      'statusBar.update': { ok: true },
      'workspace.readContext': null
    }
  })
  return { host, repo, root, recipe }
}

test('snapshot reads projects through the engine and maps workspaces', async () => {
  const { host, repo } = setup()
  worker = await mountWorker(main, { host })
  const s = await worker.request('rc.snapshot', { refresh: true })
  assert.equal(s.error, undefined)
  assert.equal(s.projects.length, 1)
  assert.equal(s.projects[0].path, repo)
  assert.equal(s.projects[0].name, 'my-app')
  assert.equal(s.projects[0].workspaceId, 'ws-app')
  assert.equal(s.rootWorkspaceId, 'ws-data')
  assert.deepEqual(s.shared_deps, { 'left-pad': { '/a': '1.0.0', '/b': '1.3.0' } })
  assert.ok(worker.posts.some((p) => p.event === 'rc.updated'))
  const bar = host.callsOf('statusBar.update').at(-1) as { text: string; tone: string }
  assert.equal(bar.text, '1 need attention')
  assert.equal(bar.tone, 'warning')
  assert.deepEqual(worker.refusals, [])
})

test('a press launches the configured agent with the skill, then shows the workspace', async () => {
  const { host, repo } = setup()
  worker = await mountWorker(main, { host })
  await worker.request('rc.snapshot', { refresh: true })
  const res = await worker.request('rc.action', { action: 'deploy', path: repo, target: 'prod' })
  assert.deepEqual(res, { ok: true, message: 'Deploy prod started in my-app' })
  assert.deepEqual(host.callsOf('agent.launch').at(-1), { workspaceId: 'ws-app', agent: 'codex', prompt: '/deploy prod' })
  assert.deepEqual(host.callsOf('workspace.open').at(-1), { workspaceId: 'ws-app' })
  const empty = await worker.request('rc.action', { action: 'prompt', path: repo, text: ' ' })
  assert.equal(empty.ok, false)
  assert.deepEqual(worker.refusals, [])
})

test('open board creates the board file in the data folder and opens it', async () => {
  const { host, root } = setup()
  worker = await mountWorker(main, { host })
  const res = await worker.request('rc.openBoard', {})
  assert.equal(res.ok, true)
  const call = host.callsOf('editor.open').at(-1) as { workspaceId: string; path: string }
  assert.equal(call.workspaceId, 'ws-data')
  assert.equal(call.path, 'dashboard/board.releasecontrol')
  assert.equal(readFileSync(path.join(root, 'dashboard', 'board.releasecontrol'), 'utf8'), '{}\n')
})

test('missing engine config explains how to fix it', async () => {
  const { host } = setup()
  process.env.ORCA_RELEASE_ENGINE = ''
  process.env.HOME = dir
  worker = await mountWorker(main, { host })
  const s = await worker.request('rc.snapshot', { refresh: true })
  assert.ok(s.error?.includes('release-setup'))
})

test('graph returns null without graphify output', async () => {
  const { host, repo } = setup()
  worker = await mountWorker(main, { host })
  assert.equal(await worker.request('rc.graph', { path: repo }), null)
})

test('board positions round-trip through storage', async () => {
  const { host } = setup()
  worker = await mountWorker(main, { host })
  await worker.request('rc.positions.set', { 'p:/r/a': [0.25, 0.75] })
  assert.deepEqual(await worker.request('rc.positions.get', {}), { 'p:/r/a': [0.25, 0.75] })
  assert.deepEqual(host.data().storage.positions, { 'p:/r/a': [0.25, 0.75] })
})

test('status prints the status table in a terminal, without an agent', async () => {
  const { host } = setup()
  worker = await mountWorker(main, { host })
  await worker.request('rc.snapshot', { refresh: true })
  const res = await worker.request('rc.action', { action: 'status' })
  assert.equal(res.ok, true)
  const call = host.callsOf('terminal.create').at(-1) as { workspaceId: string; command: string }
  assert.equal(call.workspaceId, 'ws-data')
  assert.ok(call.command.startsWith('python3 -I ') && call.command.includes('status.py'))
  assert.equal(host.callsOf('agent.launch').length, 0)
})

test('dev starts services, waits for them, then one terminal per dev command; no agent', async () => {
  const { host, repo } = setup()
  worker = await mountWorker(main, { host })
  await worker.request('rc.snapshot', { refresh: true })
  const res = await worker.request('rc.action', { action: 'dev', path: repo })
  assert.equal(res.ok, true)
  assert.ok(res.message.includes('no agent'))
  await new Promise((r) => setTimeout(r, 2600))
  const calls = host.callsOf('terminal.create') as { title: string; command: string }[]
  assert.deepEqual(calls.map((c) => c.title), ['services', 'dev: npm run dev', 'dev: npm run worker'])
  assert.ok(calls[0].command.includes('docker compose -p app up -d --wait db'))
  assert.equal(host.callsOf('agent.launch').length, 0)
  const again = await worker.request('rc.action', { action: 'dev', path: repo })
  assert.ok(again.message.includes('already running'))
  assert.equal(host.callsOf('terminal.create').length, 3)
  assert.deepEqual(worker.refusals, [])
})

test('unconfirmed recipe steps still go to the agent', async () => {
  const saved = RECIPE
  RECIPE = '# my-app\n\n## dev\n- [ ] `npm run dev` <!-- inferred: confirm -->\n'
  try {
    const { host, repo } = setup()
    worker = await mountWorker(main, { host })
    await worker.request('rc.snapshot', { refresh: true })
    await worker.request('rc.action', { action: 'dev', path: repo })
    assert.equal(host.callsOf('terminal.create').length, 0)
    assert.equal((host.callsOf('agent.launch').at(-1) as { prompt: string }).prompt, '/dev')
    await worker.request('rc.action', { action: 'compose', path: repo })
    assert.equal((host.callsOf('agent.launch').at(-1) as { prompt: string }).prompt, '/compose up')
  } finally {
    RECIPE = saved
  }
})

test('pull runs a fast-forward-only pull in a terminal; stop runs the compose stop commands', async () => {
  const { host, repo } = setup()
  worker = await mountWorker(main, { host })
  await worker.request('rc.snapshot', { refresh: true })
  const pull = await worker.request('rc.action', { action: 'pull', path: repo })
  assert.equal(pull.ok, true)
  assert.deepEqual(host.callsOf('terminal.create').at(-1), { workspaceId: 'ws-app', title: 'pull', command: 'git pull --ff-only' })
  const stop = await worker.request('rc.action', { action: 'stop', path: repo })
  assert.ok(stop.message.includes('no agent'))
  const call = host.callsOf('terminal.create').at(-1) as { title: string; command: string }
  assert.equal(call.title, 'services: stop')
  assert.ok(call.command.includes('docker compose'))
  assert.equal(host.callsOf('agent.launch').length, 0)
  assert.deepEqual(worker.refusals, [])
})

test('fetch updates every project from its remote, so commits to pull show up', async () => {
  const { host, repo } = setup()
  const bare = path.join(dir, 'remote.git')
  const g = (cwd: string, ...a: string[]) => execFileSync('git', ['-C', cwd, '-c', 'user.email=t@t', '-c', 'user.name=t', ...a])
  g(repo, 'commit', '-q', '--allow-empty', '-m', 'one')
  execFileSync('git', ['init', '-q', '-b', 'main', '--bare', bare])
  g(repo, 'remote', 'add', 'origin', bare)
  g(repo, 'push', '-q', '-u', 'origin', 'main')
  const other = path.join(dir, 'other')
  execFileSync('git', ['clone', '-q', bare, other])
  g(other, 'commit', '-q', '--allow-empty', '-m', 'two')
  g(other, 'push', '-q')
  worker = await mountWorker(main, { host })
  await worker.request('rc.snapshot', { refresh: true })
  const res = await worker.request('rc.action', { action: 'fetch' })
  assert.equal(res.ok, true, res.message)
  assert.ok(res.message.startsWith('Fetched 1 of 1 projects'))
  assert.equal(execFileSync('git', ['-C', repo, 'rev-list', '--count', 'HEAD..@{u}']).toString().trim(), '1')
})

test('the board opens in the focused project, kept out of git', async () => {
  const { host, repo } = setup()
  worker = await mountWorker(main, { host })
  await worker.request('rc.snapshot', { refresh: true })
  await worker.emit('workspace.changed', { context: { branch: 'main', displayName: 'my app', terminals: [] } })
  const res = await worker.request('rc.openBoard', {})
  assert.equal(res.message, 'Board opened in my app')
  assert.deepEqual(host.callsOf('editor.open').at(-1), { workspaceId: 'ws-app', path: '.orca/board.releasecontrol' })
  assert.equal(readFileSync(path.join(repo, '.orca', 'board.releasecontrol'), 'utf8'), JSON.stringify({ select: repo }) + '\n')
  assert.ok(readFileSync(path.join(repo, '.git', 'info', 'exclude'), 'utf8').includes('/.orca/board.releasecontrol'))
  assert.ok(!execFileSync('git', ['-C', repo, 'status', '--porcelain', '--untracked-files=all']).toString().includes('.orca'))
  await worker.request('rc.openBoard', {})
  const ex = readFileSync(path.join(repo, '.git', 'info', 'exclude'), 'utf8')
  assert.equal(ex.split('/.orca/board.releasecontrol').length - 1, 1)
})

test('project page: info, a document, scripts only from the project, files only inside it', async () => {
  const { host, repo } = setup()
  worker = await mountWorker(main, { host })
  await worker.request('rc.snapshot', { refresh: true })
  const info = await worker.request('rc.project', { path: repo })
  assert.equal(info?.docs[0].title, 'My app')
  assert.deepEqual(info?.scripts.map((x) => x.run), ['npm run start:dev'])
  assert.equal((await worker.request('rc.doc', { path: repo, doc: 'README.md' }))?.text, '# My app\n\n## Run\n')
  assert.equal(await worker.request('rc.doc', { path: repo, doc: '../x.md' }), null)
  assert.equal(await worker.request('rc.project', { path: '/not/a/project' }), null)
  const ok = await worker.request('rc.action', { action: 'script', path: repo, text: 'npm run start:dev' })
  assert.equal(ok.ok, true)
  assert.deepEqual(host.callsOf('terminal.create').at(-1), { workspaceId: 'ws-app', title: 'run: start:dev', command: 'npm run start:dev' })
  const bad = await worker.request('rc.action', { action: 'script', path: repo, text: 'rm -rf ~' })
  assert.equal(bad.ok, false)
  assert.equal(host.callsOf('terminal.create').length, 1)
  assert.equal((await worker.request('rc.openFile', { path: repo, file: 'src/a.ts' })).ok, true)
  assert.deepEqual(host.callsOf('editor.open').at(-1), { workspaceId: 'ws-app', path: 'src/a.ts' })
  assert.equal((await worker.request('rc.openFile', { path: repo, file: '../../etc/passwd' })).ok, false)
  assert.equal(host.callsOf('agent.launch').length, 0)
})

test('when Orca drops the prompt, the worker types it once the agent is waiting', async () => {
  const { host, repo } = setup(['Claude Code', '  ⎿  SessionStart:startup says: 📦 app · skill: /compose /dev /push /pr /deploy', '❯ '])
  worker = await mountWorker(main, { host })
  await worker.request('rc.snapshot', { refresh: true })
  await worker.request('rc.action', { action: 'push', path: repo })
  await new Promise((r) => setTimeout(r, 200))
  assert.deepEqual(host.callsOf('terminal.sendText'), [{ terminalId: 't1', text: '/push', enter: true }])
})

test('when the prompt reached the agent, nothing is typed', async () => {
  const { host, repo } = setup(['> /push', 'Pushing feature…'])
  worker = await mountWorker(main, { host })
  await worker.request('rc.snapshot', { refresh: true })
  await worker.request('rc.action', { action: 'push', path: repo })
  await new Promise((r) => setTimeout(r, 200))
  assert.equal(host.callsOf('terminal.sendText').length, 0)
})

test('an agent waiting for the user shows up, notifies once, and Open shows its workspace', async () => {
  const { host, repo } = setup()
  worker = await mountWorker(main, { host })
  await worker.request('rc.snapshot', { refresh: true })
  const ev = { workspaceId: 'ws-app', paneKey: 'pane-1', terminalId: 't9', title: 'push', state: 'waiting', receivedAt: Date.now() }
  await worker.emit('agent.status.changed', ev)
  await worker.emit('agent.status.changed', { ...ev, receivedAt: Date.now() + 1 })
  await new Promise((r) => setTimeout(r, 50))
  const s = await worker.request('rc.snapshot', {})
  assert.deepEqual(s.agents?.map((a) => [a.path, a.state]), [[repo, 'waiting']])
  assert.equal(host.callsOf('notifications.show').length, 1)
  const res = await worker.request('rc.action', { action: 'agent', target: 'pane-1' })
  assert.equal(res.ok, true)
  assert.deepEqual(host.callsOf('workspace.open').at(-1), { workspaceId: 'ws-app' })
  await worker.emit('agent.status.changed', { ...ev, state: 'done', receivedAt: Date.now() + 2 })
  await new Promise((r) => setTimeout(r, 50))
  assert.deepEqual((await worker.request('rc.snapshot', {})).agents, [])
})

test('stop, links and cleanup only act on what the board found', async () => {
  const { host, repo } = setup()
  execFileSync('git', ['-C', repo, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'base'])
  execFileSync('git', ['-C', repo, 'branch', 'merged-one'])
  worker = await mountWorker(main, { host })
  const s = await worker.request('rc.snapshot', { refresh: true })
  assert.deepEqual(s.work?.[repo]?.cleanup?.merged_branches, ['merged-one'])
  assert.equal((await worker.request('rc.action', { action: 'kill', path: repo, target: '1' })).ok, false)
  assert.equal((await worker.request('rc.action', { action: 'pr-open', path: repo, target: 'https://evil.example/x' })).ok, false)
  const res = await worker.request('rc.action', { action: 'cleanup', path: repo, target: 'branches' })
  assert.equal(res.ok, true, res.message)
  assert.equal(execFileSync('git', ['-C', repo, 'branch', '--list', 'merged-one']).toString().trim(), '')
  const st = await worker.request('rc.standup', { since: '1 day ago' })
  assert.equal(st.since, '1 day ago')
})

test('rollback only to a tag the project has; logs only from terminals the board started', async () => {
  const { host, repo } = setup(['$ npm run start:dev', 'Error: boom'])
  const g = (...a: string[]) => execFileSync('git', ['-C', repo, '-c', 'user.email=t@t', '-c', 'user.name=t', ...a])
  g('commit', '-q', '--allow-empty', '-m', 'one')
  g('tag', '-a', 'v1.0.0', '-m', 'first')
  g('commit', '-q', '--allow-empty', '-m', 'two')
  g('tag', '-a', 'v1.1.0', '-m', 'second')
  worker = await mountWorker(main, { host })
  const s = await worker.request('rc.snapshot', { refresh: true })
  assert.deepEqual(s.work?.[repo]?.releases?.tags.map((t) => t.tag), ['v1.1.0', 'v1.0.0'])
  const bad = await worker.request('rc.action', { action: 'deploy', path: repo, target: 'prod', text: 'v9.9.9' })
  assert.equal(bad.ok, false)
  const ok = await worker.request('rc.action', { action: 'deploy', path: repo, target: 'prod', text: 'v1.0.0' })
  assert.equal(ok.message, 'Rollback prod to v1.0.0 started in my-app')
  assert.equal((host.callsOf('agent.launch').at(-1) as { prompt: string }).prompt, '/deploy prod rollback v1.0.0')
  assert.equal((await worker.request('rc.logs', { path: repo, source: 'terminal:term-1' })).error, 'That terminal was not started by the board.')
  await worker.request('rc.action', { action: 'pull', path: repo })
  const l = await worker.request('rc.logs', { path: repo, source: 'terminal:term-1' })
  assert.deepEqual(l, { lines: ['$ npm run start:dev', 'Error: boom'], error: null })
  assert.equal((await worker.request('rc.logs', { path: repo, source: 'service:db' })).error, 'Unknown service.')
  assert.deepEqual((await worker.request('rc.snapshot', {})).work?.[repo]?.terminals, [{ id: 'term-1', title: 'pull' }])
})

test('agents follow their workspaces: a late workspace is picked up, a removed one drops its agents', async () => {
  const { host, repo, root } = setup()
  worker = await mountWorker(main, { host })
  await worker.request('rc.snapshot', { refresh: true })
  const ev = { workspaceId: 'ws-late', paneKey: 'pane-late', title: 'pr', state: 'waiting', receivedAt: Date.now() }
  // Orca tells about the agent before the workspace shows up in workspace.list
  await worker.emit('agent.status.changed', ev)
  await new Promise((r) => setTimeout(r, 50))
  assert.deepEqual((await worker.request('rc.snapshot', {})).agents, [])
  const late = { id: 'ws-late', kind: 'worktree', name: 'my app', path: repo, branch: 'main', hostId: null }
  const data = { id: 'ws-data', kind: 'folder', name: 'data', path: root, branch: null, hostId: null }
  host.respond('workspace.list', { workspaces: [late, data], truncated: false })
  await worker.emit('agent.status.changed', { ...ev, receivedAt: Date.now() + 1 })
  await new Promise((r) => setTimeout(r, 50))
  assert.deepEqual((await worker.request('rc.snapshot', {})).agents?.map((a) => a.paneKey), ['pane-late'])
  host.respond('workspace.list', { workspaces: [data], truncated: false })
  await worker.emit('workspace.removed', { workspaceId: 'ws-late', kind: 'worktree', path: repo })
  await new Promise((r) => setTimeout(r, 50))
  assert.deepEqual((await worker.request('rc.snapshot', {})).agents, [])
})

test('a press whose Orca call fails answers with a message instead of throwing', async () => {
  const { host } = setup()
  worker = await mountWorker(main, { host })
  const s = await worker.request('rc.snapshot', { refresh: true })
  host.respond('workspace.open', () => {
    throw new Error('workspace is gone')
  })
  const res = await worker.request('rc.action', { action: 'open', path: s.projects[0].path })
  assert.equal(res.ok, false)
  assert.match(res.message, /workspace is gone/)
})

test('the graph is only read for projects on the board', async () => {
  const { host, dir: _d } = { ...setup(), dir }
  worker = await mountWorker(main, { host })
  await worker.request('rc.snapshot', { refresh: true })
  const other = path.join(dir, 'elsewhere')
  mkdirSync(path.join(other, 'graphify-out'), { recursive: true })
  writeFileSync(path.join(other, 'graphify-out', 'graph.json'), JSON.stringify({ nodes: [], links: [] }))
  assert.equal(await worker.request('rc.graph', { path: other }), null)
})
