// `orca plugin check` renders the sidebar panel once per scenario against canned snapshots.
import { defineCheck } from 'orca/testing'

const snapshot = (projects: unknown[], error?: string) => ({
  generated: '2026-11-20T10:00:00',
  at: Date.now(),
  root: '/data',
  report: { name: '2026-11-16', items: ['**Node 20** is end of life'] },
  projects,
  rootWorkspaceId: 'ws-data',
  ...(error ? { error } : {})
})

const busy = snapshot([
  { name: 'mobile-app', path: '/r/mobile-app', missing: false, branch: 'main', dirty: 2, ahead: 3, recipe: 'ok', recipe_file: '/x.md', weeks: [] },
  { name: 'api', path: '/r/api', missing: false, branch: 'main', since: 4, tag: 'v1.2.0', targets: ['prod'], recipe: 'update', weeks: [] },
  { name: 'site', path: '/r/site', missing: false, branch: 'main', weeks: [] }
])

export default defineCheck({
  busy: { requests: { 'rc.snapshot': busy } },
  clean: { requests: { 'rc.snapshot': snapshot([{ name: 'site', path: '/r/site', missing: false, branch: 'main' }]) } },
  broken: { requests: { 'rc.snapshot': snapshot([], 'Could not read the projects (python3 not found).') } }
})
