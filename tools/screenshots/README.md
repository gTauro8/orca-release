# Board screenshots

The images in `docs/screenshots/` come from the real board (`plugin/release-control/src/board.ts`), with a fake
Orca host and a fictional workspace (`mock.ts`: the "Shop" projects), so a screenshot never shows a real project.

```bash
mkdir -p /tmp/rc-shots && cp tools/screenshots/index.html /tmp/rc-shots/
npx -y esbuild@0.24 tools/screenshots/entry.ts --bundle --format=iife --target=es2022 --outfile=/tmp/rc-shots/board.js
(cd /tmp/rc-shots && python3 -m http.server 8765 --bind 127.0.0.1)
```

Open `http://127.0.0.1:8765/index.html` at 1440×900. The hash picks what the board opens on, like a `.releasecontrol`
file: `#{"select":"/demo/shop-api","tab":"api"}`, `#{"select":"/demo/shop-api","tab":"docs","doc":"README.md"}`,
`#{"domain":"shop"}`. Wait a second after loading, then capture the viewport.
