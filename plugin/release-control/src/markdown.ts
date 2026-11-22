// A small, safe markdown renderer for the project docs. Everything is escaped first: no HTML from a
// document ever reaches the DOM. Covers what project docs use: headings, paragraphs, lists, task lists,
// fenced code, quotes, tables, rules, inline code, bold, italic, links (http/https only) and images
// (shown as their alt text).

const esc = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function slug(text: string): string {
  return (
    'h-' +
    text
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
  )
}

function inline(src: string): string {
  // pull code spans out first so nothing inside them is formatted
  const codes: string[] = []
  let s = src.replace(/`([^`]+)`/g, (_, c: string) => {
    codes.push(c)
    return `\u0000${codes.length - 1}\u0000`
  })
  s = esc(s)
  s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, (_, alt: string) => (alt ? `<span class="md-img">${alt}</span>` : ''))
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, (_, text: string, href: string) =>
    /^https?:\/\//i.test(href) ? `<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>` : `<span class="md-ref" title="${href}">${text}</span>`
  )
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (_, pre: string, url: string) => `${pre}<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`)
  s = s.replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (_, a: string, b: string) => `<strong>${a ?? b}</strong>`)
  s = s.replace(/(^|[^*\w])\*([^*\s][^*]*)\*(?!\*)/g, '$1<em>$2</em>').replace(/(^|[^_\w])_([^_\s][^_]*)_(?!\w)/g, '$1<em>$2</em>')
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>')
  return s.replace(/\u0000(\d+)\u0000/g, (_, i: string) => `<code>${esc(codes[Number(i)])}</code>`)
}

const cells = (row: string) =>
  row
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => c.trim())

export interface Rendered {
  html: string
  outline: { level: number; text: string; id: string }[]
}

export function renderMarkdown(md: string): Rendered {
  const lines = md.replace(/\r\n?/g, '\n').split('\n')
  const out: string[] = []
  const outline: Rendered['outline'] = []
  const used = new Map<string, number>()
  let i = 0
  let para: string[] = []
  const flush = () => {
    if (para.length) out.push(`<p>${inline(para.join(' '))}</p>`)
    para = []
  }
  while (i < lines.length) {
    const line = lines[i]
    const fence = line.match(/^\s*(```+|~~~+)\s*([\w+-]*)/)
    if (fence) {
      flush()
      const close = fence[1]
      const body: string[] = []
      i++
      while (i < lines.length && !lines[i].trim().startsWith(close)) body.push(lines[i++])
      i++
      out.push(`<pre class="md-code">${fence[2] ? `<span class="md-lang">${esc(fence[2])}</span>` : ''}<code>${esc(body.join('\n'))}</code></pre>`)
      continue
    }
    const h = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/)
    if (h) {
      flush()
      const level = h[1].length
      const text = h[2].replace(/`/g, '')
      let id = slug(text)
      const n = used.get(id) ?? 0
      used.set(id, n + 1)
      if (n) id += `-${n}`
      if (level <= 3) outline.push({ level, text, id })
      out.push(`<h${Math.min(level + 1, 6)} id="${id}" class="md-h${level}">${inline(h[2])}</h${Math.min(level + 1, 6)}>`)
      i++
      continue
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flush()
      out.push('<hr>')
      i++
      continue
    }
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      flush()
      const head = cells(line)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(cells(lines[i++]))
      out.push(
        `<div class="md-table"><table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows
          .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`)
          .join('')}</tbody></table></div>`
      )
      continue
    }
    if (/^\s*>/.test(line)) {
      flush()
      const body: string[] = []
      while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ''))
      out.push(`<blockquote>${renderMarkdown(body.join('\n')).html}</blockquote>`)
      continue
    }
    const li = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/)
    if (li) {
      flush()
      const ordered = /\d/.test(li[2])
      const items: string[] = []
      while (i < lines.length) {
        const m = lines[i].match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/)
        if (!m) {
          if (lines[i].trim() && /^\s{2,}/.test(lines[i]) && items.length) {
            items[items.length - 1] += ' ' + lines[i].trim()
            i++
            continue
          }
          break
        }
        const nested = m[1].length >= 2
        const task = m[3].match(/^\[([ xX])\]\s+(.*)$/)
        const body = task
          ? `<span class="md-task${task[1] === ' ' ? '' : ' done'}" aria-hidden="true"></span>${inline(task[2])}`
          : inline(m[3])
        items.push(nested ? `<span class="md-sub">${body}</span>` : body)
        i++
      }
      const tag = ordered ? 'ol' : 'ul'
      out.push(`<${tag}>${items.map((x) => `<li>${x}</li>`).join('')}</${tag}>`)
      continue
    }
    if (!line.trim()) {
      flush()
      i++
      continue
    }
    para.push(line.trim())
    i++
  }
  flush()
  return { html: out.join('\n'), outline }
}
