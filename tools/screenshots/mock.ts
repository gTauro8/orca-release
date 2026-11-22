// A stand-in for Orca around the real board (plugin/release-control/src/board.ts), fed with a fictional
// workspace, so README screenshots never show anyone's real projects. The URL hash picks what the board
// opens on, like a .releasecontrol file does: #{"select":"/demo/shop-api","tab":"api"}.
import type { ProjectInfo, Snapshot } from '../../plugin/release-control/src/model'

const now = Date.now()
const day = 86_400_000
const recipe = (id: string) => `/demo/data/recipes/${id}.md`
const weeks = (...n: number[]) => n

const projects: Snapshot['projects'] = [
  { name: 'shop-api', path: '/demo/shop-api', missing: false, branch: 'main', dirty: 0, ahead: 2, behind: 0, recipe: 'ok', tag: 'v2.4.0', since: 7, targets: ['staging', 'prod'], recipe_file: recipe('shop-api'), stack: ['node', 'docker', 'gh-actions'], compose: true, has_dev: true, graphify: false, weeks: weeks(3, 5, 2, 8, 6, 4, 9, 7, 5, 11, 6, 8), domain: 'shop', domain_label: 'Shop', links: [], deps: {}, workspaceId: 'ws-1' },
  { name: 'shop-web', path: '/demo/shop-web', missing: false, branch: 'feat/checkout', dirty: 4, ahead: 0, behind: 3, recipe: 'ok', tag: 'v1.9.2', since: 0, targets: ['prod'], recipe_file: recipe('shop-web'), stack: ['node', 'gh-actions'], weeks: weeks(1, 2, 4, 3, 6, 2, 5, 4, 7, 3, 2, 6), domain: 'shop', domain_label: 'Shop', links: [{ type: 'uses-api', target: 'shop-api' }], deps: {}, workspaceId: 'ws-2' },
  { name: 'shop-admin', path: '/demo/shop-admin', missing: false, branch: 'main', dirty: 0, ahead: 0, behind: 0, recipe: 'update', tag: 'v0.8.0', since: 3, targets: ['prod'], recipe_file: recipe('shop-admin'), stack: ['node', 'docker'], weeks: weeks(0, 1, 0, 2, 1, 3, 0, 2, 1, 1, 4, 2), domain: 'shop', domain_label: 'Shop', links: [{ type: 'uses-api', target: 'shop-api' }], deps: {}, workspaceId: 'ws-3' },
  { name: 'mobile-app', path: '/demo/mobile-app', missing: false, branch: 'main', dirty: 2, ahead: 1, behind: 0, recipe: 'ok', tag: 'v3.1.0', since: 12, targets: ['testflight', 'play-store'], recipe_file: recipe('mobile-app'), stack: ['flutter', 'ios', 'android'], weeks: weeks(6, 4, 7, 9, 5, 8, 6, 10, 7, 9, 12, 8), domain: 'shop', domain_label: 'Shop', links: [{ type: 'uses-api', target: 'shop-api' }], deps: {}, workspaceId: 'ws-4' },
  { name: 'payments', path: '/demo/payments', missing: false, branch: 'main', dirty: 0, ahead: 0, behind: 0, recipe: 'ok', tag: 'v1.2.3', since: 0, targets: ['prod'], recipe_file: recipe('payments'), stack: ['go', 'docker'], weeks: weeks(2, 0, 1, 1, 0, 2, 1, 0, 3, 1, 0, 1), links: [{ type: 'related', target: 'shop-api' }], deps: {}, workspaceId: 'ws-5' },
  { name: 'docs-site', path: '/demo/docs-site', missing: false, branch: 'main', dirty: 1, ahead: 0, behind: 0, recipe: 'ok', tag: null, since: null, targets: [], recipe_file: recipe('docs-site'), stack: ['node'], weeks: weeks(1, 0, 2, 1, 1, 0, 3, 2, 1, 0, 1, 2), deps: {}, workspaceId: 'ws-6' },
  { name: 'data-jobs', path: '/demo/data-jobs', missing: false, branch: 'main', dirty: 0, ahead: 0, behind: 0, recipe: 'ok', tag: 'v0.4.1', since: 0, targets: ['prod'], recipe_file: recipe('data-jobs'), stack: ['python', 'docker'], weeks: weeks(0, 2, 1, 0, 1, 2, 0, 1, 2, 1, 0, 1), deps: {}, workspaceId: 'ws-7' }
]

const snapshot: Snapshot = {
  generated: new Date(now).toISOString(),
  at: now,
  root: '/demo/data',
  rootWorkspaceId: 'ws-data',
  report: { name: '2026-11-16', items: ['**Node 20** reaches end of life in April: shop-api, shop-web, docs-site', 'Flutter 3.38 is out (mobile-app)'] },
  projects,
  shared_deps: {
    react: { '/demo/shop-web': '19.1.0', '/demo/shop-admin': '19.1.0', '/demo/docs-site': '18.3.1' },
    zod: { '/demo/shop-api': '3.25.0', '/demo/shop-web': '3.25.0', '/demo/shop-admin': '3.22.4' },
    typescript: { '/demo/shop-api': '5.9.2', '/demo/shop-web': '5.9.2', '/demo/shop-admin': '5.9.2', '/demo/docs-site': '5.9.2' }
  },
  agents: [{ paneKey: 'pane-1', path: '/demo/shop-web', workspaceId: 'ws-2', title: 'checkout: Apple Pay', state: 'waiting', since: now - 4 * 60_000 }],
  work: {
    '/demo/shop-api': {
      prs: { host: 'github', at: now, ci: { state: 'success', url: 'https://example.com/run/1', name: 'tests', branch: 'main' }, prs: [{ number: 142, title: 'Rate-limit the login endpoint', url: 'https://example.com/pr/142', author: 'sam', branch: 'rate-limit', draft: false, review: null, mine: false, review_requested: true }] },
      running: { processes: [{ pid: 4242, command: 'node', ports: [3000], cwd: '/demo/shop-api' }], services: [{ name: 'db', state: 'running', health: 'healthy', ports: [5432] }, { name: 'redis', state: 'running', health: null, ports: [6379] }] },
      envs: { at: now, base: 'main', targets: [{ name: 'staging', url: 'https://staging.shop.example', health: '/health', checked: true, up: true, status: 200, ms: 84, version: 'v2.4.0-7-g1a2b3c', behind: 0 }, { name: 'prod', url: 'https://shop.example', health: '/health', checked: true, up: true, status: 200, ms: 61, version: 'v2.4.0', behind: 7 }] },
      releases: { base: 'main', unreleased: 7, tags: [{ tag: 'v2.4.0', date: new Date(now - 9 * day).toISOString(), subject: 'Gift cards', by: 'you', commits: 18 }, { tag: 'v2.3.1', date: new Date(now - 23 * day).toISOString(), subject: 'Fix VAT rounding', by: 'you', commits: 3 }, { tag: 'v2.3.0', date: new Date(now - 30 * day).toISOString(), subject: 'Wishlists', by: 'sam', commits: 25 }] },
      cleanup: { base: 'main', merged_branches: ['gift-cards', 'vat-fix'], gone_branches: [], worktrees: [] },
      terminals: [{ id: 'term-1', title: 'dev: npm run start:dev' }]
    },
    '/demo/shop-web': {
      prs: { host: 'github', at: now, ci: { state: 'failure', url: 'https://example.com/run/2', name: 'e2e', branch: 'feat/checkout' }, prs: [{ number: 88, title: 'New checkout', url: 'https://example.com/pr/88', author: 'you', branch: 'feat/checkout', draft: false, review: 'changes_requested', mine: true, review_requested: false }] }
    }
  }
}

const info: Record<string, ProjectInfo> = {
  '/demo/shop-api': {
    path: '/demo/shop-api',
    docs: [
      { path: 'README.md', title: 'Shop API', headings: [{ level: 2, text: 'Run it' }, { level: 2, text: 'Environment' }, { level: 2, text: 'Deploy' }], words: 640, group: 'Project' },
      { path: 'CHANGELOG.md', title: 'Changelog', headings: [{ level: 2, text: '2.4.0' }, { level: 2, text: '2.3.1' }], words: 900, group: 'Project' },
      { path: 'docs/architecture.md', title: 'Architecture', headings: [{ level: 2, text: 'Modules' }, { level: 2, text: 'Data model' }], words: 1200, group: 'docs' },
      { path: 'docs/payments.md', title: 'Payments flow', headings: [{ level: 2, text: 'Webhooks' }], words: 480, group: 'docs' }
    ],
    api: [
      ['GET', '/products', 'ProductsController', 'list'], ['GET', '/products/:id', 'ProductsController', 'get'], ['POST', '/products', 'ProductsController', 'create'], ['PATCH', '/products/:id', 'ProductsController', 'update'], ['DELETE', '/products/:id', 'ProductsController', 'remove'],
      ['GET', '/cart', 'CartController', 'get'], ['POST', '/cart/items', 'CartController', 'add'], ['DELETE', '/cart/items/:id', 'CartController', 'remove'],
      ['POST', '/orders', 'OrdersController', 'create'], ['GET', '/orders/:id', 'OrdersController', 'get'], ['GET', '/orders', 'OrdersController', 'list'],
      ['POST', '/auth/login', 'AuthController', 'login'], ['POST', '/auth/refresh', 'AuthController', 'refresh'], ['GET', '/gift-cards/:code', 'GiftCardsController', 'check']
    ].map(([method, p, group, handler]) => ({ method, path: p, group, handler, file: `src/${group.replace('Controller', '').toLowerCase()}/${group.replace('Controller', '').toLowerCase()}.controller.ts`, line: 12 })),
    scripts: [
      { source: 'package.json', name: 'start:dev', run: 'npm run start:dev', command: 'nest start --watch' },
      { source: 'package.json', name: 'test', run: 'npm test', command: 'jest' },
      { source: 'package.json', name: 'migrate', run: 'npm run migrate', command: 'prisma migrate deploy' },
      { source: 'Makefile', name: 'seed', run: 'make seed', command: 'make seed' }
    ],
    env: [{ name: 'DATABASE_URL', file: '.env.example' }, { name: 'REDIS_URL', file: '.env.example' }, { name: 'STRIPE_SECRET_KEY', file: '.env.example' }, { name: 'JWT_SECRET', file: '.env.example' }],
    urls: ['http://localhost:3000', 'http://localhost:3000/docs'],
    commits: [
      { hash: '1a2b3c4', subject: 'Gift card balance endpoint', author: 'you', when: '2 hours ago' },
      { hash: '5d6e7f8', subject: 'Cache product lists in Redis', author: 'sam', when: 'yesterday' },
      { hash: '9a0b1c2', subject: 'Validate cart quantities with zod', author: 'you', when: '2 days ago' }
    ]
  }
}

const DOCS: Record<string, string> = {
  'README.md': '# Shop API\n\nThe backend of the shop: products, cart, orders and gift cards.\n\n## Run it\n\n```bash\nnpm install\nnpm run start:dev\n```\n\nThe API listens on http://localhost:3000, with its OpenAPI page at `/docs`.\n\n## Environment\n\nCopy `.env.example` to `.env`. You need **Postgres** and **Redis**: `docker compose up -d` starts both.\n\n## Deploy\n\nTagged releases go to *staging* first, then to *prod* after a check.\n'
}

const LOGS = ['[Nest] 4242  - LOG [NestFactory] Starting Nest application...', '[Nest] 4242  - LOG [InstanceLoader] AppModule dependencies initialized', '[Nest] 4242  - LOG [RoutesResolver] ProductsController {/products}', '[Nest] 4242  - LOG [RoutesResolver] CartController {/cart}', '[Nest] 4242  - ERROR [ExceptionsHandler] Redis connection refused, retrying in 2s', '[Nest] 4242  - LOG [RedisService] connected to redis://localhost:6379', '[Nest] 4242  - LOG [NestApplication] Nest application successfully started on :3000']

const requests: Record<string, (input: any) => unknown> = {
  'rc.snapshot': () => snapshot,
  'rc.positions.get': () => ({}),
  'rc.positions.set': () => ({ ok: true }),
  'rc.project': ({ path }) => info[path] ?? { path, docs: [], api: [], scripts: [], env: [], urls: [], commits: [] },
  'rc.graph': () => null,
  'rc.doc': ({ doc }) => (DOCS[doc] ? { text: DOCS[doc] } : null),
  'rc.logs': () => ({ lines: LOGS, error: null }),
  'rc.standup': ({ since }) => ({ since, rows: [{ name: 'shop-api', path: '/demo/shop-api', commits: [{ hash: '1a2b3c4', subject: 'Gift card balance endpoint', date: '' }, { hash: '9a0b1c2', subject: 'Validate cart quantities with zod', date: '' }] }, { name: 'mobile-app', path: '/demo/mobile-app', commits: [{ hash: 'abc1234', subject: 'Apple Pay button on the cart screen', date: '' }] }] }),
  'rc.search': () => [],
  'rc.action': () => ({ ok: true, message: 'Demo: nothing was run' })
}

let docListener: ((doc: unknown) => void) | null = null
const hashDoc = () => ({ content: { kind: 'text', text: decodeURIComponent(location.hash.slice(1)) || '{}' } })

;(globalThis as any).orca = {
  plugin: {
    request: async (name: string, input: unknown) => {
      const h = requests[name]
      if (!h) throw new Error(`demo: no ${name}`)
      return structuredClone(h(input ?? {}))
    },
    on: () => () => undefined
  },
  storage: { get: async () => null, set: async () => undefined },
  on: () => () => undefined,
  document: {
    onDidChange: (fn: (doc: unknown) => void) => {
      docListener = fn
      // after the first snapshot has drawn, like Orca delivering the file a moment later
      setTimeout(() => fn(hashDoc()), 300)
      return () => undefined
    }
  }
}
addEventListener('hashchange', () => docListener?.(hashDoc()))
