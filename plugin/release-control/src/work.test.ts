import { assert, test } from 'orca/testing'
import type { Project, ProjectInfo, Snapshot } from './model'
import { allAttention, cleanupCount, isRunning, search, standupText, workAttention } from './work'

const P = (name: string, extra: Partial<Project> = {}): Project => ({ name, path: `/r/${name}`, missing: false, branch: 'main', ...extra })
const snap = (s: Partial<Snapshot>): Snapshot => ({ generated: '', at: 0, root: null, report: { name: null, items: [] }, projects: [], rootWorkspaceId: null, ...s })

test('agents waiting for the user, reviews asked and red CI come first in "Now"', () => {
  const s = snap({
    projects: [P('a', { ahead: 1 }), P('b')],
    agents: [
      { paneKey: 'k1', path: '/r/a', workspaceId: 'w', state: 'waiting', since: 1, title: 'push' },
      { paneKey: 'k2', path: '/r/b', workspaceId: 'w', state: 'working', since: 1 }
    ],
    work: {
      '/r/b': {
        prs: {
          host: 'github',
          at: 0,
          ci: { state: 'failure', url: 'https://ci/1', name: 'Build', branch: 'main' },
          prs: [
            { number: 7, title: 'Fix', url: 'https://pr/7', author: 'x', draft: false, review: null, mine: false, review_requested: true },
            { number: 8, title: 'Mine', url: 'https://pr/8', author: 'me', draft: false, review: 'changes_requested', mine: true, review_requested: false },
            { number: 9, title: 'Other', url: 'https://pr/9', author: 'y', draft: false, review: null, mine: false, review_requested: false }
          ]
        }
      }
    }
  })
  const w = workAttention(s)
  assert.deepEqual(w.map((a) => [a.project, a.state, a.action?.id, a.action?.target]), [
    ['a', 'agent', 'agent', 'k1'],
    ['b', 'review', 'pr-open', 'https://pr/7'],
    ['b', 'review', 'pr-open', 'https://pr/8'],
    ['b', 'review', 'pr-open', 'https://ci/1']
  ])
  assert.equal(allAttention(s)[0].state, 'agent')
  assert.deepEqual(allAttention(s, [P('a', { ahead: 1 })]).map((a) => a.state), ['agent', 'unpushed'])
})

test('running and cleanup helpers', () => {
  assert.equal(isRunning(undefined), false)
  assert.equal(isRunning({ running: { processes: [], services: [{ name: 'db', state: 'exited', health: null, ports: [] }] } }), false)
  assert.equal(isRunning({ running: { processes: [], services: [{ name: 'db', state: 'running', health: 'healthy', ports: [5432] }] } }), true)
  assert.equal(cleanupCount({ cleanup: { base: 'main', merged_branches: ['a', 'b'], gone_branches: ['c'], worktrees: [{ path: '/w', branch: 'd' }] } }), 3)
})

test('search ranks across projects, docs, endpoints, scripts and env', () => {
  const info: ProjectInfo = {
    path: '/r/api',
    docs: [{ path: 'docs/atleti.md', title: 'Atleti', headings: [{ level: 2, text: 'Import atleti' }], words: 10, group: 'Docs' }],
    api: [{ method: 'GET', path: '/api/v1/atleti/:id', group: 'AtletiController', file: 'a.ts', handler: 'dettaglio' }],
    scripts: [{ source: 'npm', name: 'start:dev', run: 'npm run start:dev', command: 'nest start --watch' }],
    env: [{ name: 'DATABASE_URL', file: '.env.example' }],
    urls: [],
    commits: []
  }
  const hits = search('atleti', [P('api')], new Map([['/r/api', info]]))
  assert.deepEqual(hits.map((h) => h.kind).sort(), ['doc', 'endpoint'])
  assert.equal(search('database', [P('api')], new Map([['/r/api', info]]))[0].label, 'DATABASE_URL')
  assert.equal(search('dev', [P('api')], new Map([['/r/api', info]]))[0].ref, 'npm run start:dev')
  assert.equal(search('api', [P('api')], new Map())[0].kind, 'project')
  assert.deepEqual(search('  ', [P('api')], new Map()), [])
})

test('standup text is ready to paste', () => {
  assert.equal(
    standupText([{ name: 'a', path: '/r/a', commits: [{ hash: '1', subject: 'feat: x', date: '' }, { hash: '2', subject: 'fix: y', date: '' }] }], 'yesterday'),
    '**a**\n- feat: x\n- fix: y'
  )
  assert.equal(standupText([], 'yesterday'), 'No commits of mine since yesterday.')
})

test('a deploy target that is down goes into "Now"', () => {
  const s = snap({
    projects: [P('a')],
    work: { '/r/a': { envs: { base: 'origin/main', at: 0, targets: [
      { name: 'staging', url: 'https://s.example', health: null, checked: true, up: false, status: 502, error: 'HTTP 502' },
      { name: 'prod', url: 'https://p.example', health: null, checked: true, up: true, status: 200 },
      { name: 'dev', url: null, health: null, checked: false }
    ] } } }
  })
  assert.deepEqual(workAttention(s).map((x) => [x.text, x.action?.target]), [['staging is down · HTTP 502', 'https://s.example']])
})
