import { assert, test } from 'orca/testing'
import { renderMarkdown, slug } from './markdown'

test('markdown never lets HTML from a document through', () => {
  const r = renderMarkdown('# Hi <script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[x](javascript:alert(1)) and `<b>`')
  assert.ok(!r.html.includes('<script>'))
  assert.ok(!r.html.includes('<img'))
  assert.ok(!r.html.includes('href="javascript'))
  assert.ok(r.html.includes('&lt;script&gt;'))
  assert.ok(r.html.includes('<code>&lt;b&gt;</code>'))
})

test('markdown renders headings with an outline, lists, code, tables and links', () => {
  const r = renderMarkdown(
    '# Title\n\nSome **bold** and *it* text.\n\n## Setup\n\n- [x] done\n- [ ] todo\n\n1. one\n2. two\n\n```bash\nnpm i <x>\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n## Setup\n\nSee [docs](https://example.com) or https://x.dev.\n'
  )
  assert.deepEqual(r.outline.map((o) => [o.level, o.text, o.id]), [
    [1, 'Title', 'h-title'],
    [2, 'Setup', 'h-setup'],
    [2, 'Setup', 'h-setup-1']
  ])
  assert.ok(r.html.includes('<strong>bold</strong>') && r.html.includes('<em>it</em>'))
  assert.ok(r.html.includes('md-task done') && r.html.includes('<ol>'))
  assert.ok(r.html.includes('<span class="md-lang">bash</span><code>npm i &lt;x&gt;</code>'))
  assert.ok(r.html.includes('<th>a</th>') && r.html.includes('<td>2</td>'))
  assert.ok(r.html.includes('<a href="https://example.com" target="_blank" rel="noopener noreferrer">docs</a>'))
  assert.ok(r.html.includes('<a href="https://x.dev." ') || r.html.includes('href="https://x.dev'))
  assert.equal(slug('Perché è così?'), 'h-perche-e-cosi')
})
