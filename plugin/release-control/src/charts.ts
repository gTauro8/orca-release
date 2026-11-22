// Small SVG charts drawn from data. Text goes through esc(): project names come from folders.
export const esc = (s: string | number | null | undefined) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/** Monday of the week `ago` weeks before the current one, as dd/mm. */
export function weekLabel(ago: number, now = new Date()): string {
  const d = new Date(now)
  d.setDate(d.getDate() - ago * 7)
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
}

const niceMax = (v: number) => {
  if (v <= 4) return 4
  const p = Math.pow(10, Math.floor(Math.log10(v)))
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p
  return v
}

export interface Series {
  key: string
  label: string
  values: number[]
}

/** Activity of every project: each a quiet line, the total as an area, the chosen one lit. */
export function activityChart(series: Series[], on: string | null, width = 360, height = 150): string {
  const n = series[0]?.values.length ?? 12
  const total = Array.from({ length: n }, (_, i) => series.reduce((a, s) => a + (s.values[i] ?? 0), 0))
  const max = niceMax(Math.max(1, ...total))
  const L = 28
  const R = 6
  const T = 8
  const B = 20
  const x = (i: number) => L + (i * (width - L - R)) / Math.max(1, n - 1)
  const y = (v: number) => T + (1 - v / max) * (height - T - B)
  const path = (vals: number[]) => vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('')
  const grid = [0, max / 2, max]
    .map((v) => `<line class="grid" x1="${L}" x2="${width - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 6}" y="${y(v) + 3.5}" text-anchor="end">${Math.round(v)}</text>`)
    .join('')
  const ticks = [n - 1, Math.round((n - 1) / 2), 0]
    .map((i) => `<text x="${x(i)}" y="${height - 4}" text-anchor="${i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}">${i === n - 1 ? 'this week' : weekLabel(n - 1 - i)}</text>`)
    .join('')
  const area = `<path class="area" d="${path(total)}L${x(n - 1)},${y(0)}L${x(0)},${y(0)}Z"/><path class="total" d="${path(total)}"/>`
  const lines = series
    .map((s) => `<path class="line${s.key === on ? ' on' : ''}" data-key="${esc(s.key)}" d="${path(s.values)}"><title>${esc(s.label)}</title></path>`)
    .join('')
  const lit = series.find((s) => s.key === on)
  const dots = lit
    ? lit.values
        .map((v, i) => (v ? `<circle cx="${x(i)}" cy="${y(v)}" r="2.5" fill="var(--rc-unreleased)"><title>${v} commits</title></circle>` : ''))
        .join('')
    : ''
  return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Commits per week, last ${n} weeks: ${total.reduce((a, b) => a + b, 0)} in total">${grid}${on ? '' : area}${lines}${dots}${ticks}</svg>`
}

/** One project's commits per week as bars with their values. */
export function weekBars(values: number[], width = 360, height = 110): string {
  const n = values.length
  const max = niceMax(Math.max(1, ...values))
  const L = 4
  const T = 14
  const B = 20
  const slot = (width - L * 2) / n
  const bw = Math.max(4, slot * 0.62)
  const y = (v: number) => T + (1 - v / max) * (height - T - B)
  const bars = values
    .map((v, i) => {
      const cx = L + slot * i + slot / 2
      const top = v ? y(v) : height - B - 2
      const h = v ? height - B - top : 2
      const label = v ? `<text x="${cx}" y="${top - 4}" text-anchor="middle">${v}</text>` : ''
      return `<rect class="bar${v ? '' : ' zero'}" x="${(cx - bw / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="2"><title>week of ${weekLabel(n - 1 - i)}: ${v} commits</title></rect>${label}`
    })
    .join('')
  const ticks = [0, n - 1].map((i) => `<text x="${L + slot * i + slot / 2}" y="${height - 4}" text-anchor="${i ? 'end' : 'start'}">${i === n - 1 ? 'this week' : weekLabel(n - 1 - i)}</text>`).join('')
  const sum = values.reduce((a, b) => a + b, 0)
  return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${sum} commits in the last ${n} weeks">${bars}${ticks}</svg>`
}
