// Sidebar panel: what is waiting, each with its skill button, and the way into the full board.
import {
  atom,
  Badge,
  Button,
  Callout,
  EmptyState,
  Heading,
  IconButton,
  plugin,
  read,
  Row,
  set,
  Skeleton,
  Stack,
  Text,
  type PanelContext
} from 'orca'
import { actionRequest, counts, type ActionRequest, type Attention, type Snapshot } from './model'
import { allAttention, needsYou } from './work'
import './protocol'

const snap = atom<Snapshot | null>(null)
const loading = atom(false)
/** Every press still running: one key per button, so a second press elsewhere never re-enables the first. */
const busy = atom<readonly string[]>([])
const note = atom<{ ok: boolean; text: string } | null>(null)
const isBusy = (key: string) => read(busy).includes(key)

let noteTimer: ReturnType<typeof setTimeout> | undefined
function say(n: { ok: boolean; text: string } | null): void {
  set(note, n)
  clearTimeout(noteTimer)
  // a success fades after a while; a problem stays until the next press
  if (n?.ok) noteTimer = setTimeout(() => set(note, null), 12_000)
}

async function act(req: ActionRequest, key: string): Promise<void> {
  if (read(busy).includes(key)) return
  set(busy, [...read(busy), key])
  try {
    const res = await plugin.request('rc.action', req, { timeoutMs: req.action === 'fetch' ? 120_000 : 60_000 })
    say({ ok: res.ok, text: res.message })
  } catch (err) {
    say({ ok: false, text: `Did not start: ${(err as Error).message}` })
  } finally {
    set(busy, read(busy).filter((k) => k !== key))
  }
}

async function openBoard(): Promise<void> {
  try {
    const res = await plugin.request('rc.openBoard', {})
    say(res.ok ? null : { ok: false, text: res.message })
  } catch (err) {
    say({ ok: false, text: (err as Error).message })
  }
}

async function refresh(): Promise<void> {
  set(loading, true)
  try {
    set(snap, await plugin.request('rc.snapshot', { refresh: true }, { timeoutMs: 120_000 }))
  } catch (err) {
    say({ ok: false, text: `Refresh failed: ${(err as Error).message}` })
  } finally {
    set(loading, false)
  }
}

function updatedLabel(at: number): string {
  const min = Math.round((Date.now() - at) / 60_000)
  if (min < 1) return 'Updated just now'
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
  return min < 60 ? `Updated ${rtf.format(-min, 'minute')}` : `Updated ${rtf.format(-Math.round(min / 60), 'hour')}`
}

export function setup(ctx: PanelContext): void {
  ctx.subscriptions.push(plugin.on('rc.updated', (s) => set(snap, s)))
  ctx.subscriptions.push(plugin.on('rc.loading', ({ loading: l }) => set(loading, l)))
  void plugin
    .request('rc.snapshot', {}, { timeoutMs: 120_000 })
    .then((s) => set(snap, s))
    .catch((err: Error) => say({ ok: false, text: `The worker is not responding: ${err.message}` }))
}

function item(a: Attention, i: number) {
  const key = `${a.path}|${a.action?.id}|${a.action?.target ?? ''}`
  const running = isBusy(key)
  return (
    <Row justify="between" gap="sm" key={`${a.path}|${a.state}|${i}`}>
      <Stack gap="none">
        <Text weight="semibold" truncate>
          {a.project}
        </Text>
        <Text muted size="xs">
          {a.text}
        </Text>
      </Stack>
      {a.action ? (
        <Button
          size="xs"
          variant="outline"
          disabled={running}
          onPress={() => act(actionRequest(a.action!.id, { path: a.path, target: a.action!.target }), key)}
        >
          {running ? '…' : a.action.label}
        </Button>
      ) : null}
    </Row>
  )
}

export default function Panel() {
  const s = read(snap)
  const n = read(note)
  const items = s ? allAttention(s).filter((a) => a.state !== 'missing') : []
  const waiting = s ? (s.agents ?? []).filter(needsYou).length : 0
  const c = s ? counts(s.projects) : null
  return (
    <Stack gap="md">
      <Row justify="between">
        <Heading level={2}>Release Control</Heading>
        <IconButton icon="refresh" label="Refresh data" size="sm" variant="ghost" disabled={read(loading)} onPress={refresh} />
      </Row>
      <Row gap="sm">
        <Button icon="gauge" variant="solid" tone="accent" onPress={openBoard}>
          Open the board
        </Button>
        <Button
          variant="outline"
          disabled={isBusy('fetch')}
          onPress={() => act(actionRequest('fetch'), 'fetch')}
        >
          {isBusy('fetch') ? 'Fetching…' : 'Fetch'}
        </Button>
      </Row>
      {n ? (
        <Callout tone={n.ok ? 'success' : 'warning'}>
          <Text size="sm">{n.text}</Text>
        </Callout>
      ) : null}
      {s?.error ? (
        <Callout tone="danger" title="Data not updated">
          <Text size="sm">{s.error}</Text>
        </Callout>
      ) : null}
      {!s ? (
        <Skeleton lines={4} label="Reading the projects" />
      ) : s.error && s.projects.length === 0 ? null : items.length === 0 ? (
        <EmptyState icon="check" title="All clean" description={`${c?.all ?? 0} projects committed, pushed and released.`} />
      ) : (
        <Stack gap="sm">
          <Row gap="xs">
            <Badge tone="warning">{`${c?.attention ?? 0} need attention`}</Badge>
            {c?.unpushed ? <Badge tone="danger">{`${c.unpushed} to push`}</Badge> : null}
            {c?.behind ? <Badge tone="warning">{`${c.behind} to pull`}</Badge> : null}
            {waiting ? <Badge tone="danger">{`${waiting} agent${waiting === 1 ? '' : 's'} waiting`}</Badge> : null}
          </Row>
          {items.slice(0, 12).map((a, i) => (
            item(a, i)
          ))}
          {items.length > 12 ? (
            <Text muted size="xs">
              {`and ${items.length - 12} more on the board`}
            </Text>
          ) : null}
        </Stack>
      )}
      {s && !s.error ? (
        <Text muted size="xs">
          {updatedLabel(s.at)}
        </Text>
      ) : null}
    </Stack>
  )
}
