import { assert, test } from 'orca/testing'
import { curveControl, depGrid, depRows, domains, edges, incoming, keepsPlace, LINK_LABEL, neighbourhood } from './graph'
import type { Project, Snapshot } from './model'

const p = (name: string, over: Partial<Project> = {}): Project => ({
  name,
  path: `/r/${name}`,
  missing: false,
  branch: 'main',
  recipe_file: `/data/recipes/${name}.md`,
  ...over
})

const app = p('app', {
  domain: 'fan-club',
  links: [
    { type: 'uses-api', target: 'cms' },
    { type: 'uses-api', target: 'ghost' },
    { type: 'related', target: 'gone' },
    { type: 'replaces', target: 'ext:Joomla' }
  ]
})
const cms = p('cms', { domain: 'fan-club', domain_label: 'Fan Club', links: [{ type: 'related', target: 'app' }] })
const site = p('site')
const gone = p('gone', { missing: true })

test('domains group live projects and fall back to a title-cased label', () => {
  assert.deepEqual(domains([app, cms, site, gone]), [{ id: 'fan-club', label: 'Fan Club', members: ['/r/app', '/r/cms'] }])
  assert.equal(domains([p('x', { domain: 'big-shop' })])[0].label, 'Big Shop')
})

test('edges drop dangling and missing targets, keep external systems', () => {
  const e = edges([app, cms, site, gone])
  assert.deepEqual(
    e.map((x) => [x.from, x.to, x.type, x.external]),
    [
      ['p:/r/app', 'p:/r/cms', 'uses-api', false],
      ['p:/r/app', 'x:Joomla', 'replaces', true],
      ['p:/r/cms', 'p:/r/app', 'related', false]
    ]
  )
})

test('a mutual pair is curved apart, a single edge stays straight', () => {
  const e = edges([app, cms, site, gone])
  assert.deepEqual(e.map((x) => x.bend), [0.25, 0, 0.25])
})

test('incoming lists who links to a project', () => {
  assert.deepEqual(
    incoming([app, cms, site], '/r/cms').map((x) => [x.from.name, x.type]),
    [['app', 'uses-api']]
  )
})

test('depRows marks the minority version as odd', () => {
  const snap = {
    projects: [app, cms, site],
    shared_deps: { 'left-pad': { '/r/app': '1.0.0', '/r/cms': '1.0.0', '/r/site': '1.3.0' } }
  } as unknown as Snapshot
  assert.deepEqual(depRows(snap, 'left-pad'), [
    { project: 'app', version: '1.0.0', odd: false },
    { project: 'cms', version: '1.0.0', odd: false },
    { project: 'site', version: '1.3.0', odd: true }
  ])
  assert.equal(LINK_LABEL['uses-api'], 'uses the API of')
})

test('neighbourhood of a project is itself plus linked nodes; of a domain its members and their links', () => {
  const e = edges([app, cms, site, gone])
  assert.deepEqual([...neighbourhood(e, 'p:/r/cms')].sort(), ['p:/r/app', 'p:/r/cms'])
  assert.deepEqual([...neighbourhood(e, 'p:/r/site')], ['p:/r/site'])
  const doms = domains([app, cms, site])
  assert.deepEqual([...neighbourhood(e, 'd:fan-club', doms)].sort(), ['d:fan-club', 'p:/r/app', 'p:/r/cms', 'x:Joomla'])
})

test('depGrid sorts deps by use, leaves gaps empty and marks odd versions', () => {
  const snap = {
    projects: [app, cms, site, gone],
    shared_deps: {
      zod: { '/r/app': '3.0.0', '/r/site': '3.0.0' },
      'left-pad': { '/r/app': '1.0.0', '/r/cms': '1.0.0', '/r/site': '1.3.0' }
    }
  } as unknown as Snapshot
  const g = depGrid(snap)
  assert.deepEqual(g.deps, ['left-pad', 'zod'])
  assert.deepEqual(
    g.rows.map((r) => [r.project, r.cells, r.odd]),
    [
      ['app', ['1.0.0', '3.0.0'], [false, false]],
      ['cms', ['1.0.0', null], [false, false]],
      ['site', ['1.3.0', '3.0.0'], [true, false]]
    ]
  )
})

test('the two edges of a mutual pair bend to opposite sides of the line between them', () => {
  const [ab, , ba] = edges([app, cms, site, gone])
  const a = { x: 0, y: 0 }
  const b = { x: 100, y: 0 }
  const q1 = curveControl(a, b, ab.bend)
  const q2 = curveControl(b, a, ba.bend)
  assert.ok(q1.y * q2.y < 0, `control points ${JSON.stringify([q1, q2])} must be on opposite sides`)
})

test('existing stars keep their place when a layer adds nodes', () => {
  assert.equal(keepsPlace({ existed: true, saved: false, firstLayout: false }), true)
  assert.equal(keepsPlace({ existed: false, saved: true, firstLayout: false }), true)
  assert.equal(keepsPlace({ existed: false, saved: false, firstLayout: false }), false)
  assert.equal(keepsPlace({ existed: true, saved: true, firstLayout: true }), true)
  assert.equal(keepsPlace({ existed: true, saved: false, firstLayout: true }), false)
})
