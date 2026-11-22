import { assert, test } from 'orca/testing'
import {
  attention,
  counts,
  promptFor,
  landed,
  groupEndpoints,
  methodCounts,
  fetchFailure,
  fetchSummary,
  boardFile,
  focusedWorkspace,
  PULL_COMMAND,
  actionRequest,
  recipeSection,
  needsConfirmation,
  servicesCommand,
  shq,
  devTitle,
  SERVICES_OK,
  repoListFrom,
  reportLabels,
  states,
  summarizeGraph,
  workspaceFor,
  type Project,
  type Workspace
} from './model'

const p = (over: Partial<Project>): Project => ({ name: 'app', path: '/r/app', missing: false, branch: 'main', ...over })

test('states follow ring order and include dirty worktrees', () => {
  assert.deepEqual(states(p({ dirty: 1, ahead: 2, since: 3, recipe: 'update' })), ['dirty', 'unpushed', 'unreleased', 'recipe'])
  assert.deepEqual(states(p({ dirty_worktrees: [{ path: '/w', branch: 'b', dirty: 2 }] })), ['dirty'])
  assert.deepEqual(states(p({ missing: true })), ['missing'])
  assert.deepEqual(states(p({})), [])
})

test('attention puts unpushed first and offers the skill', () => {
  const items = attention([
    p({ name: 'a', dirty: 3, recipe_file: '/x/a.md' }),
    p({ name: 'b', ahead: 1, no_upstream: true, branch: 'feat' }),
    p({ name: 'c', since: 4, tag: 'v1.0.0', targets: ['prod'] }),
    p({ name: 'd', recipe: 'update' })
  ])
  assert.deepEqual(
    items.map((i) => [i.project, i.state, i.action?.id ?? null]),
    [
      ['b', 'unpushed', 'push'],
      ['c', 'unreleased', 'deploy'],
      ['d', 'recipe', 'align'],
      ['a', 'dirty', 'push']
    ]
  )
  assert.equal(items[0].text, '1 commit never pushed on feat')
  assert.equal(items[1].action?.target, 'prod')
  assert.equal(items[3].text, '3 uncommitted files on main')
})

test('dirty without a recipe has no push button', () => {
  assert.equal(attention([p({ dirty: 1 })])[0].action, undefined)
})

test('counts skip missing folders', () => {
  const c = counts([p({ dirty: 1 }), p({ ahead: 1, dirty: 1 }), p({}), p({ missing: true })])
  assert.deepEqual(c, { all: 3, attention: 2, dirty: 2, unpushed: 1, behind: 0, unreleased: 0, recipe: 0 })
})

test('prompts are the skills, never raw commands', () => {
  assert.equal(promptFor({ action: 'push' }), '/push')
  assert.equal(promptFor({ action: 'deploy', target: 'staging' }), '/deploy staging')
  assert.equal(promptFor({ action: 'prompt', text: '  aggiungi il login  ' }), '/prompt aggiungi il login')
  assert.equal(promptFor({ action: 'prompt', text: '   ' }), null)
  assert.equal(promptFor({ action: 'open' }), null)
})

test('workspaceFor prefers the exact folder, then the closest parent', () => {
  const ws = (id: string, path: string): Workspace => ({ id, kind: 'worktree', name: id, path, branch: 'main', hostId: null })
  const list = [ws('root', '/a'), ws('app', '/a/app'), ws('wt', '/a/app/.claude/worktrees/x')]
  assert.equal(workspaceFor('/a/app', list)?.id, 'app')
  assert.equal(workspaceFor('/a/app/', list)?.id, 'app')
  assert.equal(workspaceFor('/a/app/recipes/x.md', list)?.id, 'app')
  assert.equal(workspaceFor('/a/other', list)?.id, 'root')
  assert.equal(workspaceFor('/b', list), null)
})

test('repo list lines keep paths with spaces and names without', () => {
  assert.equal(repoListFrom([{ path: '/x/My App', name: 'My App' }]), 'ws-0  My-App  /x/My App\n')
})

test('graph summary groups by community with report labels and bridges', () => {
  const graph = {
    nodes: [
      { id: 'a1', label: 'A1', community: 0 },
      { id: 'a2', label: 'A2', community: 0 },
      { id: 'a3', label: 'A3', community: 0 },
      { id: 'b1', label: 'B1', community: 1 },
      { id: 'b2', label: 'B2', community: 1 },
      { id: 'c1', label: 'C1', community: 2 }
    ],
    links: [
      { source: 'a1', target: 'a2' },
      { source: 'a1', target: 'b1' },
      { source: 'a2', target: 'b2' },
      { source: 'b1', target: 'c1' }
    ],
    built_at_commit: 'abc'
  }
  const labels = reportLabels('### Community 0 - "Autenticazione"\nCohesion: 1\n### Community 1 - "Rete"\n')
  const s = summarizeGraph(graph, labels, 2)
  assert.equal(s.nodes, 6)
  assert.equal(s.communities, 3)
  assert.deepEqual(s.top, [
    { id: 0, size: 3, label: 'Autenticazione' },
    { id: 1, size: 2, label: 'Rete' }
  ])
  assert.deepEqual(s.bridges, [[0, 1, 2]])
  assert.equal(summarizeGraph(graph, new Map(), 3).top[2].label, 'C1')
  assert.equal(s.builtAt, 'abc')
})

test('graphify updates an existing graph instead of rebuilding it', () => {
  assert.equal(promptFor({ action: 'graphify' }), '/graphify .')
  assert.equal(promptFor({ action: 'graphify' }, true), '/graphify . --update')
})

test('recipe sections and unconfirmed steps decide when an agent is needed', () => {
  const r = '# x\n\n## compose\nfile: a.yml\n\n## dev\n- [ ] `npm run dev` <!-- inferred: confirm -->\n\n## push\n- [ ] `make test`\n'
  assert.equal(recipeSection(r, 'compose'), 'file: a.yml\n')
  assert.equal(recipeSection(r, 'deploy'), null)
  assert.equal(needsConfirmation(recipeSection(r, 'compose')!), false)
  assert.equal(needsConfirmation(recipeSection(r, 'dev')!), true)
  assert.ok(!recipeSection(r, 'dev')!.includes('make test'))
})

test('services command quotes safely and never echoes the finished marker', () => {
  assert.equal(shq("it's"), `'it'\\''s'`)
  const cmd = servicesCommand(['docker compose -p a up -d --wait db'])
  assert.ok(cmd.startsWith('{ docker compose -p a up -d --wait db; } && '))
  assert.ok(!cmd.includes(SERVICES_OK))
  assert.equal(devTitle('npm run start:dev'), 'dev: npm run start:dev')
  assert.ok(devTitle('x'.repeat(80)).length <= 45)
})

test('action requests carry no undefined fields (Orca only passes JSON)', () => {
  const req = actionRequest('dev', { path: '/r/a', target: undefined })
  assert.deepEqual(req, { action: 'dev', path: '/r/a' })
  assert.ok(!Object.prototype.hasOwnProperty.call(req, 'target'))
  assert.deepEqual(actionRequest('deploy', { path: '/r/a', target: 'prod' }), { action: 'deploy', path: '/r/a', target: 'prod' })
  assert.deepEqual(actionRequest('prompt', { path: '/r/a', text: 'x' }).text, 'x')
})

test('commits to pull become a state and a Pull action', () => {
  const p = { name: 'a', path: '/r/a', missing: false, branch: 'main', behind: 3 }
  assert.deepEqual(states(p), ['behind'])
  const a = attention([p])[0]
  assert.equal(a.state, 'behind')
  assert.equal(a.text, '3 commits to pull on main')
  assert.equal(a.action?.id, 'pull')
  assert.equal(counts([p]).behind, 1)
  assert.equal(PULL_COMMAND, 'git pull --ff-only')
  assert.equal(promptFor({ action: 'pull' }), null)
  assert.equal(promptFor({ action: 'stop' }), '/compose stop')
})

test('the focused workspace is found by name and branch; the board file names the project', () => {
  const ws = [
    { id: '1', kind: 'worktree' as const, name: 'app', path: '/r/app', branch: 'main', hostId: null },
    { id: '2', kind: 'worktree' as const, name: 'app', path: '/w/app-feat', branch: 'feat', hostId: null }
  ]
  assert.equal(focusedWorkspace({ displayName: 'app', branch: 'feat' }, ws)?.id, '2')
  assert.equal(focusedWorkspace({ displayName: 'app', branch: 'other' }, ws)?.id, '1')
  assert.equal(focusedWorkspace(null, ws), null)
  assert.equal(focusedWorkspace({ displayName: 'nope', branch: '' }, ws), null)
  assert.equal(boardFile('/r/app'), '{"select":"/r/app"}\n')
  assert.equal(boardFile(null), '{}\n')
})

test('fetch failures are explained and grouped', () => {
  assert.equal(fetchFailure("fatal: unable to access 'https://x/': Could not resolve host: x"), 'server not reachable (VPN off?)')
  assert.equal(fetchFailure('fatal: Authentication failed for https://x/'), 'login needed')
  assert.equal(fetchFailure('Host key verification failed.'), 'unknown SSH host key')
  assert.equal(fetchFailure('weird'), 'fetch failed')
  assert.equal(
    fetchSummary(8, [{ name: 'a', reason: 'login needed' }, { name: 'b', reason: 'server not reachable (VPN off?)' }, { name: 'c', reason: 'login needed' }], 0),
    'Fetched 5 of 8 projects · login needed: a, c · server not reachable (VPN off?): b'
  )
  assert.equal(fetchSummary(2, [], 1), 'Fetched 2 of 2 projects · 1 with commits to pull')
})

test('endpoints group by controller and filter by text and method', () => {
  const api = [
    { method: 'GET', path: '/api/v1/a/:id', group: 'A', file: 'a.ts', handler: 'one' },
    { method: 'POST', path: '/api/v1/a', group: 'A', file: 'a.ts', handler: 'create' },
    { method: 'GET', path: '/api/v1/a', group: 'A', file: 'a.ts', handler: 'list' },
    { method: 'DELETE', path: '/api/v1/b/:id', group: 'B', file: 'b.ts' }
  ]
  const g = groupEndpoints(api)
  assert.deepEqual(g.map((x) => x.group), ['A', 'B'])
  assert.deepEqual(g[0].items.map((e) => `${e.method} ${e.path}`), ['GET /api/v1/a', 'POST /api/v1/a', 'GET /api/v1/a/:id'])
  assert.deepEqual(groupEndpoints(api, 'create').map((x) => x.items.length), [1])
  assert.deepEqual(groupEndpoints(api, '', 'DELETE').map((x) => x.group), ['B'])
  assert.deepEqual(methodCounts(api), [{ method: 'GET', n: 2 }, { method: 'POST', n: 1 }, { method: 'DELETE', n: 1 }])
})

test('a push lands when the commits are gone; a deploy when a new tag shows up', () => {
  const base = { name: 'a', path: '/a', missing: false }
  const push = { kind: 'push' as const, at: 0, ahead: 2, dirty: 0, tag: null, since: 0 }
  assert.equal(landed(push, { ...base, ahead: 2 }), false)
  assert.equal(landed(push, { ...base, ahead: 0 }), true)
  const commitAndPush = { ...push, ahead: 0, dirty: 3 }
  assert.equal(landed(commitAndPush, { ...base, ahead: 0, dirty: 3 }), false)
  assert.equal(landed(commitAndPush, { ...base, ahead: 0, dirty: 0 }), true)
  const deploy = { kind: 'deploy' as const, at: 0, ahead: 0, dirty: 0, tag: 'v1.0.0', since: 4 }
  assert.equal(landed(deploy, { ...base, tag: 'v1.0.0', since: 4 }), false)
  assert.equal(landed(deploy, { ...base, tag: 'v1.1.0', since: 0 }), true)
})

test('a rollback asks the deploy skill for that tag', () => {
  assert.equal(promptFor({ action: 'deploy', target: 'staging', text: 'v1.2.0' }), '/deploy staging rollback v1.2.0')
  assert.equal(promptFor({ action: 'deploy', target: 'staging', text: 'v1; rm -rf ~' }), '/deploy staging')
  assert.equal(promptFor({ action: 'deploy', target: 'prod' }), '/deploy prod')
})
