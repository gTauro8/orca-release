// Board styles. Ground and chrome come from Orca's theme (--orca-*); state colours are the only
// loud colours, tuned per light/dark so each reads at 3:1 or better on the card.
export const CSS = `
:root{
  --rc-dirty:#b98110;--rc-unpushed:#d9541e;--rc-behind:#0e8a8a;--rc-agent:#d6409f;--rc-review:#6e56cf;--rc-unreleased:#3a6be0;--rc-recipe:#8a55d6;--rc-clean:#2c8a57;--rc-missing:#8a8f98;
  --rc-ease-out:cubic-bezier(.23,1,.32,1);
  --rc-font:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;
  --rc-mono:"SF Mono",ui-monospace,Menlo,Consolas,monospace;
  --rc-r:var(--orca-radius,8px);
  color-scheme:light;
}
html.dark{
  --rc-dirty:#e2b440;--rc-unpushed:#ff8a52;--rc-behind:#4fd1c5;--rc-agent:#f472b6;--rc-review:#a594f9;--rc-unreleased:#82a8ff;--rc-recipe:#b994ff;--rc-clean:#52c78f;--rc-missing:#8b93a1;
  color-scheme:dark;
}
*{box-sizing:border-box}
[hidden]{display:none!important}
.toast[hidden]{display:block!important}
html,body{margin:0;height:100%;background:var(--orca-background);color:var(--orca-foreground);
  font:13px/1.45 var(--rc-font);-webkit-font-smoothing:antialiased}
::selection{background:color-mix(in srgb,var(--rc-unreleased) 28%,transparent)}
button,select,textarea{font:inherit;color:inherit}
:focus-visible{outline:2px solid var(--orca-ring);outline-offset:2px}
.num{font-variant-numeric:tabular-nums}
.mono{font-family:var(--rc-mono);font-size:12px}
.muted{color:var(--orca-muted-foreground)}

.app{display:grid;grid-template-rows:auto minmax(0,1fr);height:100vh}
.bar{display:flex;align-items:center;gap:14px;padding:10px 16px;border-bottom:1px solid var(--orca-border);min-width:0}
.bar h1{margin:0;font-size:14px;font-weight:600;letter-spacing:-.01em;white-space:nowrap}
.chips{display:flex;gap:4px;flex-wrap:wrap;min-width:0}
.chip{display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 10px;border-radius:999px;border:1px solid var(--orca-border);
  background:transparent;cursor:pointer;white-space:nowrap;transition:background-color 150ms ease,border-color 150ms ease,transform 160ms var(--rc-ease-out)}
.chip:active{transform:scale(.97)}
.chip .dot{width:7px;height:7px;border-radius:50%;background:var(--c,var(--orca-muted-foreground))}
.chip b{font-weight:600;font-variant-numeric:tabular-nums}
.chip[aria-pressed="true"]{background:var(--orca-accent);border-color:color-mix(in srgb,var(--orca-foreground) 22%,transparent)}
.chip[disabled]{opacity:.45;cursor:default}
.spacer{flex:1}
.seg{position:absolute;right:12px;top:12px;z-index:1;background:var(--orca-background);display:inline-flex;border:1px solid var(--orca-border);border-radius:6px;overflow:hidden;flex:none}
.seg button{height:26px;padding:0 10px;border:0;background:transparent;cursor:pointer;color:var(--orca-muted-foreground);transition:background-color 150ms ease,color 150ms ease}
.seg button+button{border-left:1px solid var(--orca-border)}
.seg button[aria-pressed="true"]{background:var(--orca-accent);color:var(--orca-foreground)}
@media (hover:hover) and (pointer:fine){.seg button:hover{color:var(--orca-foreground)}}
.mapnote{position:absolute;left:16px;top:12px;font-size:12px;pointer-events:none}
.mapctl{position:absolute;right:12px;bottom:10px;display:flex;gap:4px}
.mapctl .btn{color:var(--orca-muted-foreground)}
.row .dot.ext{background:transparent;border:1.25px solid var(--orca-muted-foreground)}
.mono-title{font-family:var(--rc-mono);font-size:16px!important;letter-spacing:0!important}
.grid-wrap{overflow:auto;max-height:340px;border:1px solid var(--orca-border);border-radius:6px;scrollbar-width:thin;scrollbar-color:var(--orca-border) transparent}
.depgrid{border-collapse:separate;border-spacing:0;font-size:12px;white-space:nowrap}
.depgrid th,.depgrid td{padding:5px 10px;border-bottom:1px solid var(--orca-border);text-align:left}
.depgrid thead th{position:sticky;top:0;background:var(--orca-card);font-weight:500;color:var(--orca-muted-foreground);z-index:1}
.depgrid tbody th{position:sticky;left:0;background:var(--orca-card);font-weight:600}
.depgrid thead th:first-child{left:0;z-index:2}
.depgrid tr:last-child th,.depgrid tr:last-child td{border-bottom:0}
.odd{text-decoration:underline;text-decoration-style:dotted;text-decoration-color:var(--orca-foreground);text-underline-offset:3px}
.select{height:26px;padding:0 8px;border-radius:6px;border:1px solid var(--orca-input);background:var(--orca-background)}
.fresh{display:flex;align-items:center;gap:8px;white-space:nowrap}

.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:28px;padding:0 11px;border-radius:6px;
  border:1px solid var(--orca-border);background:var(--orca-secondary);color:var(--orca-secondary-foreground);cursor:pointer;
  white-space:nowrap;transition:background-color 150ms ease,transform 160ms var(--rc-ease-out),opacity 150ms ease}
.btn:active:not([disabled]){transform:scale(.97)}
.btn.primary{background:var(--orca-primary);color:var(--orca-primary-foreground);border-color:transparent}
.btn.ghost{background:transparent;border-color:transparent}
.btn.sm{height:24px;padding:0 9px;font-size:12px}
.btn[disabled]{opacity:.5;cursor:default}
.btn[aria-busy="true"]{opacity:.7;cursor:progress}
@media (hover:hover) and (pointer:fine){
  .chip:hover:not([disabled]){background:var(--orca-accent)}
  .btn:hover:not([disabled]){background:color-mix(in srgb,var(--orca-secondary) 80%,var(--orca-foreground) 8%)}
  .btn.primary:hover:not([disabled]){background:color-mix(in srgb,var(--orca-primary) 88%,var(--orca-background))}
  .btn.ghost:hover:not([disabled]){background:var(--orca-accent)}
}
.icon{width:14px;height:14px;flex:none;stroke:currentColor;fill:none;stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round}
.spin{animation:rc-spin 700ms linear infinite}
@keyframes rc-spin{to{transform:rotate(360deg)}}

.main{display:grid;grid-template-columns:minmax(0,1fr) clamp(360px,32vw,440px);min-height:0}
.map{position:relative;min-width:0;min-height:0;overflow:hidden}
.map canvas{position:absolute;inset:0;width:100%;height:100%;touch-action:none;cursor:default}
.map canvas.hot{cursor:pointer}
.map canvas.dragging{cursor:grabbing}
.legend{position:absolute;left:16px;bottom:14px;display:flex;gap:12px;flex-wrap:wrap;font-size:11.5px;color:var(--orca-muted-foreground);pointer-events:none}
.legend span{display:inline-flex;align-items:center;gap:5px}
.legend i{width:8px;height:8px;border-radius:50%;background:var(--c)}
.maphint{position:absolute;inset:0;display:grid;place-items:center;color:var(--orca-muted-foreground);pointer-events:none;text-align:center;padding:24px}

.drawer{border-left:1px solid var(--orca-border);background:var(--orca-card);color:var(--orca-card-foreground);overflow:auto;min-height:0;
  overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:var(--orca-border) transparent}
.drawer-inner{padding:16px 18px 28px;display:flex;flex-direction:column;gap:22px;transition:opacity 140ms ease}
.drawer-inner.swap{opacity:0}
.sec{display:flex;flex-direction:column;gap:10px}
.sec h2{margin:0;font-size:12px;font-weight:600;color:var(--orca-muted-foreground)}
.sec h2 .count{font-weight:500;margin-left:6px}
.head{display:flex;gap:10px;align-items:flex-start}
.head h2{margin:0;font-size:18px;font-weight:600;letter-spacing:-.015em;line-height:1.25;overflow-wrap:anywhere}
.head .path{margin-top:3px;color:var(--orca-muted-foreground);overflow-wrap:anywhere}
.head .grow{flex:1;min-width:0}

.rows{display:flex;flex-direction:column}
.row{display:grid;grid-template-columns:10px minmax(0,1fr) auto;align-items:center;gap:10px;padding:7px 0;border-top:1px solid var(--orca-border)}
.row:first-child{border-top:0}
.row .dot{width:8px;height:8px;border-radius:50%;background:var(--c)}
.row .what{min-width:0}
.row .what b{font-weight:600}
.row .what>span{display:block;color:var(--orca-muted-foreground);overflow-wrap:anywhere}
.row.link{cursor:pointer;border-radius:6px;transition:background-color 120ms ease}
@media (hover:hover) and (pointer:fine){.row.link:hover{background:var(--orca-accent)}}
.statedots{display:flex;gap:3px}
.statedots i{width:7px;height:7px;border-radius:50%;background:var(--c)}

.facts{display:grid;grid-template-columns:auto minmax(0,1fr);gap:4px 14px;margin:0}
.facts dt{color:var(--orca-muted-foreground)}
.facts dd{margin:0;min-width:0;overflow-wrap:anywhere}
.linkbtn{border:0;background:none;padding:0;color:inherit;text-decoration:underline;text-underline-offset:3px;text-decoration-color:var(--orca-border);cursor:pointer}
@media (hover:hover) and (pointer:fine){.linkbtn:hover{text-decoration-color:currentColor}}
.actions{display:flex;flex-wrap:wrap;gap:6px}
.task{display:flex;flex-direction:column;gap:6px}
.task textarea{width:100%;min-height:64px;resize:vertical;padding:8px 10px;border-radius:6px;border:1px solid var(--orca-input);
  background:var(--orca-background);line-height:1.4}
.task textarea::placeholder{color:var(--orca-muted-foreground)}
.task .act{display:flex;justify-content:space-between;align-items:center;gap:8px}

.callout{border:1px solid color-mix(in srgb,var(--c,var(--rc-unpushed)) 45%,var(--orca-border));
  background:color-mix(in srgb,var(--c,var(--rc-unpushed)) 9%,var(--orca-card));border-radius:var(--rc-r);padding:10px 12px;
  display:flex;flex-direction:column;gap:8px}
.callout p{margin:0}
.empty{color:var(--orca-muted-foreground);margin:0}
.report{margin:0;padding-left:18px;display:flex;flex-direction:column;gap:7px}
.report code{font:11.5px var(--rc-mono);background:var(--orca-muted);padding:0 4px;border-radius:4px}
.skel{height:12px;border-radius:4px;background:var(--orca-muted);animation:rc-pulse 1.1s ease-in-out infinite alternate}
@keyframes rc-pulse{from{opacity:.55}to{opacity:1}}

.chart{width:100%;height:auto;display:block;overflow:visible}
.chart text{fill:var(--orca-muted-foreground);font-size:10.5px;font-variant-numeric:tabular-nums}
.chart .grid{stroke:var(--orca-border);stroke-width:1}
.chart .line{fill:none;stroke:var(--orca-foreground);stroke-opacity:.18;stroke-width:1.5;transition:stroke-opacity 150ms ease,stroke 150ms ease}
.chart .line.on{stroke:var(--rc-unreleased);stroke-opacity:1;stroke-width:2.25}
.chart .area{fill:var(--rc-unreleased);fill-opacity:.12}
.chart .total{fill:none;stroke:var(--rc-unreleased);stroke-width:2}
.chart .bar{fill:var(--rc-unreleased);fill-opacity:.85}
.chart .bar.zero{fill:var(--orca-border);fill-opacity:1}
.series{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:12px}
.series button{border:0;background:none;padding:2px 0;cursor:pointer;color:var(--orca-muted-foreground);display:inline-flex;gap:6px;align-items:center}
.series button[aria-pressed="true"]{color:var(--orca-foreground)}
.series button i{width:10px;height:2px;background:currentColor;border-radius:1px}

.comm{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:3px 10px;font-size:12.5px}
.comm .barline{grid-column:1/-1;height:3px;border-radius:2px;background:var(--orca-muted);overflow:hidden;margin-bottom:5px}
.comm .barline i{display:block;height:100%;background:var(--rc-recipe)}

.toast{position:absolute;left:16px;bottom:44px;max-width:min(420px,calc(100% - 32px));padding:9px 12px;border-radius:8px;
  background:var(--orca-popover);color:var(--orca-popover-foreground);border:1px solid var(--orca-border);
  box-shadow:0 6px 18px -6px rgb(0 0 0 / .25);opacity:1;transform:translateY(0);
  transition:opacity 200ms var(--rc-ease-out),transform 200ms var(--rc-ease-out)}
.toast[hidden]{display:block;opacity:0;transform:translateY(6px);pointer-events:none}
.toast.bad{border-color:color-mix(in srgb,var(--rc-unpushed) 60%,var(--orca-border))}

@media (max-width:820px){
  .main{grid-template-columns:1fr;grid-template-rows:minmax(300px,48vh) auto}
  .drawer{border-left:0;border-top:1px solid var(--orca-border)}
  .bar{flex-wrap:wrap}
  .legend{display:none}
  .mapnote{display:none}
}
@media (prefers-reduced-motion:reduce){
  .spin{animation-duration:1.6s}
  .chip,.btn,.toast{transition-property:opacity,background-color}
  .chip:active,.btn:active:not([disabled]){transform:none}
}

/* ---------- project page ---------- */
.main.wide{grid-template-columns:minmax(0,1fr) clamp(520px,52vw,860px)}
.tabs{display:flex;gap:2px;border-bottom:1px solid var(--orca-border);margin:-6px -18px 0;padding:0 14px;position:sticky;top:-16px;background:var(--orca-card);z-index:2}
.tab{position:relative;height:34px;padding:0 10px;border:0;background:none;cursor:pointer;color:var(--orca-muted-foreground);display:inline-flex;align-items:center;gap:6px;
  transition:color 150ms ease}
.tab .count{font-size:11px;padding:0 6px;border-radius:999px;background:var(--orca-muted);color:var(--orca-muted-foreground);line-height:17px}
.tab::after{content:"";position:absolute;left:8px;right:8px;bottom:-1px;height:2px;border-radius:2px;background:var(--orca-foreground);
  opacity:0;transform:scaleX(.6);transition:opacity 150ms var(--rc-ease-out),transform 200ms var(--rc-ease-out)}
.tab[aria-selected="true"]{color:var(--orca-foreground)}
.tab[aria-selected="true"]::after{opacity:1;transform:scaleX(1)}
@media (hover:hover) and (pointer:fine){.tab:hover{color:var(--orca-foreground)}}
.small{font-size:12px;margin:0}

.tiles{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.tile{display:flex;flex-direction:column;align-items:flex-start;gap:1px;padding:10px 12px;border-radius:var(--rc-r);border:1px solid var(--orca-border);
  background:var(--orca-background);cursor:pointer;text-align:left;min-width:0;transition:border-color 150ms ease,transform 160ms var(--rc-ease-out)}
.tile b{font-size:20px;font-weight:600;letter-spacing:-.02em;line-height:1.2}
.tile small{display:block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11.5px}
.tile:active{transform:scale(.98)}
@media (hover:hover) and (pointer:fine){.tile:hover{border-color:color-mix(in srgb,var(--orca-foreground) 30%,var(--orca-border))}}

.commits{list-style:none;margin:0;padding:0;display:flex;flex-direction:column}
.commits li{display:grid;grid-template-columns:auto minmax(0,1fr);gap:0 10px;padding:6px 0;border-top:1px solid var(--orca-border)}
.commits li:first-child{border-top:0}
.commits .hash{color:var(--orca-muted-foreground);grid-row:span 2}
.commits .subj{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.commits .muted{font-size:11.5px}

.doclist{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:8px}
.doc{display:flex;flex-direction:column;align-items:flex-start;gap:4px;padding:10px 12px;border-radius:var(--rc-r);border:1px solid var(--orca-border);
  background:var(--orca-background);text-align:left;cursor:pointer;min-width:0;transition:border-color 150ms ease,transform 160ms var(--rc-ease-out)}
.doc:active{transform:scale(.98)}
@media (hover:hover) and (pointer:fine){.doc:hover{border-color:color-mix(in srgb,var(--orca-foreground) 30%,var(--orca-border))}}
.doc-title{font-weight:600;overflow-wrap:anywhere}
.doc-meta{color:var(--orca-muted-foreground);font-size:11px;overflow-wrap:anywhere}
.doc-heads{display:flex;flex-wrap:wrap;gap:4px}
.doc-heads i{font-style:normal;font-size:11px;padding:1px 6px;border-radius:4px;background:var(--orca-muted);color:var(--orca-muted-foreground);max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

.reader-bar{display:flex;align-items:center;gap:8px;min-width:0}
.reader-bar .grow{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.reader{display:block}
.reader.with-toc{display:grid;grid-template-columns:minmax(0,1fr) 180px;gap:24px;align-items:start}
.reader.with-toc .toc{order:2}
.toc{position:sticky;top:30px;display:flex;flex-direction:column;gap:2px;font-size:12px;border-left:1px solid var(--orca-border);padding-left:10px;max-height:calc(100vh - 140px);overflow:auto}
.toc a{color:var(--orca-muted-foreground);text-decoration:none;padding:2px 0;line-height:1.35;transition:color 150ms ease}
.toc a.l3{padding-left:10px}
@media (hover:hover) and (pointer:fine){.toc a:hover{color:var(--orca-foreground)}}
@media (max-width:1180px){.reader.with-toc{grid-template-columns:1fr}.toc{display:none}}
.md{font-size:13.5px;line-height:1.6;max-width:72ch;overflow-wrap:anywhere}
.md>*:first-child{margin-top:0}
.md h2,.md h3,.md h4,.md h5,.md h6{margin:1.4em 0 .5em;line-height:1.3;letter-spacing:-.01em;scroll-margin-top:44px}
.md .md-h1{font-size:21px}.md .md-h2{font-size:16.5px;padding-bottom:4px;border-bottom:1px solid var(--orca-border)}.md .md-h3{font-size:14.5px}.md .md-h4,.md .md-h5,.md .md-h6{font-size:13.5px}
.md p{margin:.6em 0}
.md ul,.md ol{margin:.5em 0;padding-left:1.4em}
.md li{margin:.2em 0}
.md .md-sub{display:block;padding-left:1em;color:var(--orca-muted-foreground)}
.md code{font:12px var(--rc-mono);background:var(--orca-muted);padding:1px 5px;border-radius:4px}
.md pre{position:relative;margin:.8em 0;padding:12px 14px;border-radius:var(--rc-r);background:var(--orca-background);border:1px solid var(--orca-border);overflow:auto;scrollbar-width:thin}
.md pre code{background:none;padding:0;font-size:12px;line-height:1.5;white-space:pre}
.md .md-lang{position:absolute;right:8px;top:6px;font:10.5px var(--rc-mono);color:var(--orca-muted-foreground)}
.md blockquote{margin:.8em 0;padding:2px 12px;border-left:3px solid var(--orca-border);color:var(--orca-muted-foreground)}
.md a{color:var(--rc-unreleased);text-underline-offset:3px}
.md .md-ref{text-decoration:underline dotted;text-underline-offset:3px}
.md .md-img{font-style:italic;color:var(--orca-muted-foreground)}
.md hr{border:0;border-top:1px solid var(--orca-border);margin:1.4em 0}
.md .md-table{overflow:auto;margin:.8em 0;border:1px solid var(--orca-border);border-radius:6px}
.md table{border-collapse:collapse;font-size:12.5px;width:100%}
.md th,.md td{padding:6px 10px;border-bottom:1px solid var(--orca-border);text-align:left;vertical-align:top}
.md thead th{background:var(--orca-background);font-weight:600}
.md tr:last-child td{border-bottom:0}
.md .md-task{display:inline-block;width:11px;height:11px;border:1.5px solid var(--orca-muted-foreground);border-radius:3px;margin-right:6px;vertical-align:-1px}
.md .md-task.done{background:var(--rc-clean);border-color:var(--rc-clean)}

.mbar{display:flex;height:8px;border-radius:4px;overflow:hidden;gap:2px}
.mbar i{background:var(--c);min-width:3px}
.mchips{display:flex;flex-wrap:wrap;gap:4px}
.search{height:30px;padding:0 10px;border-radius:6px;border:1px solid var(--orca-input);background:var(--orca-background);width:100%}
.search::placeholder{color:var(--orca-muted-foreground)}
.eps{display:flex;flex-direction:column;gap:6px}
.apig{border:1px solid var(--orca-border);border-radius:var(--rc-r);overflow:hidden;background:var(--orca-background)}
.apig summary{display:flex;align-items:center;gap:8px;padding:7px 12px;cursor:pointer;font-weight:600;list-style:none}
.apig summary::-webkit-details-marker{display:none}
.apig summary::before{content:"";width:6px;height:6px;border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;transform:rotate(-45deg);
  transition:transform 150ms var(--rc-ease-out);opacity:.6}
.apig[open] summary::before{transform:rotate(45deg)}
.apig summary .grow{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.apig summary .count{font-weight:500;color:var(--orca-muted-foreground);font-size:12px}
.ep{display:grid;grid-template-columns:62px minmax(0,1fr) auto;align-items:center;gap:10px;width:100%;padding:6px 12px;border:0;border-top:1px solid var(--orca-border);
  background:none;text-align:left;cursor:pointer;transition:background-color 120ms ease}
@media (hover:hover) and (pointer:fine){.ep:hover{background:var(--orca-accent)}}
.verb{font:600 10.5px var(--rc-mono);letter-spacing:.03em;color:var(--c);background:color-mix(in srgb,var(--c) 14%,transparent);
  border:1px solid color-mix(in srgb,var(--c) 35%,transparent);border-radius:4px;padding:2px 0;text-align:center}
.epath{overflow-wrap:anywhere}
.epath em{font-style:normal;color:var(--rc-recipe)}
.approx{margin-left:6px;color:var(--orca-muted-foreground);cursor:help}
.handler{font-size:12px;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

.row.script .what b{font-weight:500}
.row.script .what span{font-size:11.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.urls{display:flex;flex-direction:column;gap:4px}
.url{color:var(--rc-unreleased);text-decoration:none;overflow-wrap:anywhere}
@media (hover:hover) and (pointer:fine){.url:hover{text-decoration:underline;text-underline-offset:3px}}
.envs{display:flex;flex-wrap:wrap;gap:4px}
.env{border:1px solid var(--orca-border);background:var(--orca-background);border-radius:4px;padding:2px 7px;cursor:copy;font-size:11.5px;
  transition:border-color 150ms ease,transform 160ms var(--rc-ease-out)}
.env:active{transform:scale(.96)}
@media (hover:hover) and (pointer:fine){.env:hover{border-color:color-mix(in srgb,var(--orca-foreground) 30%,var(--orca-border))}}
@media (max-width:820px){.main.wide{grid-template-columns:1fr}.tiles{grid-template-columns:1fr}}
@media (prefers-reduced-motion:reduce){
  .tab::after{transition:opacity 150ms ease;transform:none}
  .tile,.doc,.env{transition-property:border-color}
  .tile:active,.doc:active,.env:active{transform:none}
}

/* ---------- work ---------- */
.search.top{width:min(320px,26vw);height:28px}
.tag{display:inline-block;font-size:11px;line-height:16px;padding:0 6px;margin-right:6px;border-radius:999px;color:var(--c,var(--orca-muted-foreground));
  background:color-mix(in srgb,var(--c,var(--orca-muted-foreground)) 14%,transparent);border:1px solid color-mix(in srgb,var(--c,var(--orca-muted-foreground)) 35%,transparent);vertical-align:1px}
.sec h2 .tag{font-weight:500;margin-left:6px}
.btn.danger{background:color-mix(in srgb,var(--rc-unpushed) 18%,var(--orca-secondary));border-color:color-mix(in srgb,var(--rc-unpushed) 55%,var(--orca-border))}
.row .dot.pulse{animation:rc-dot 1.6s ease-in-out infinite}
@keyframes rc-dot{0%,100%{box-shadow:0 0 0 0 color-mix(in srgb,var(--c) 45%,transparent)}50%{box-shadow:0 0 0 4px color-mix(in srgb,var(--c) 0%,transparent)}}
.seg.inline{position:static;align-self:flex-start}
.standup{display:flex;flex-direction:column;gap:8px;font-size:12.5px}
.standup ul{margin:2px 0 0;padding-left:18px;display:flex;flex-direction:column;gap:2px}
@media (prefers-reduced-motion:reduce){.row .dot.pulse{animation:none}}
@media (max-width:1100px){.search.top{width:180px}}

/* ---------- logs ---------- */
.logbox{margin:0;padding:10px 12px;max-height:calc(100vh - 220px);overflow:auto;border-radius:var(--rc-r);border:1px solid var(--orca-border);
  background:var(--orca-background);font:11.5px/1.5 var(--rc-mono);white-space:pre-wrap;overflow-wrap:anywhere;scrollbar-width:thin}
.logbox .err{color:var(--rc-unpushed);font-weight:600}
.logsrc .btn{color:var(--orca-muted-foreground);max-width:220px;overflow:hidden;text-overflow:ellipsis}
`
