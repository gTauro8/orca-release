# shellcheck shell=bash
# project_info.py: docs, API endpoints, scripts, env names, local URLs for one project.

_pi() { python3 -I "$SCRIPTS/project_info.py" "$@"; }
_q() { python3 -I -c 'import json,sys; d=json.load(sys.stdin); print(eval(sys.argv[1], {"d": d}))' "$1"; }

_nest_repo() {
  new_tmp; R="$TMP/app"; mkdir -p "$R/src/common" "$R/src/atleti" "$R/docs/api" "$R/node_modules/x" "$R/env"
  printf "export const PREFISSO = 'v1';\n" > "$R/src/common/prefissi.ts"
  printf "async function bootstrap() {\n  app.setGlobalPrefix('api');\n}\n" > "$R/src/main.ts"
  cat > "$R/src/atleti/atleti.controller.ts" <<'EOF'
import { Controller, Get, Post } from '@nestjs/common'
import { PREFISSO } from '../common/prefissi'

@Controller(`${PREFISSO}/atleti`)
export class AtletiController {
  @Get()
  elenco() {}

  @Get(':id')
  async dettaglio(@Param('id') id: string) {}

  @Post()
  crea() {}
}

@Controller(rotte('/app'))
export class AppController {
  @Get('home')
  home() {}
}
EOF
  printf '# My App\n\nIntro.\n\n## Setup\n\nRun http://localhost:3000/api\n\n```\n# not a heading\n```\n\n## Usage\n' > "$R/README.md"
  printf '# API guide\n\n## Auth\n' > "$R/docs/api/guide.md"
  printf '# vendored\n' > "$R/node_modules/x/README.md"
  printf 'PORT=3000\nDATABASE_URL=postgres://secret@db\n# COMMENT=1\nexport JWT_SECRET=abc\n' > "$R/env/api.env.example"
  printf 'REAL_SECRET=do-not-read\n' > "$R/.env"
  printf '{"scripts": {"start:dev": "nest start --watch", "test": "jest"}}' > "$R/package.json"
  printf 'build:\n\tgo build\nVAR := 1\n' > "$R/Makefile"
  git init -q "$R"; git -C "$R" add -A; git -C "$R" -c user.email=t@t -c user.name=Tester commit -q -m "first commit"
}

test_pi_nest_endpoints_resolve_constants_and_prefix() {
  _nest_repo; out=$(_pi "$R") || return 1
  assert_eq "GET /api/v1/atleti elenco" "$(echo "$out" | _q '" ".join([d["api"][0]["method"], d["api"][0]["path"], d["api"][0]["handler"]])')" first &&
  assert_eq "GET /api/v1/atleti/:id dettaglio" "$(echo "$out" | _q '" ".join([d["api"][1]["method"], d["api"][1]["path"], d["api"][1]["handler"]])')" second &&
  assert_eq "POST /api/v1/atleti" "$(echo "$out" | _q '" ".join([d["api"][2]["method"], d["api"][2]["path"]])')" post &&
  assert_eq "True /api/app/home" "$(echo "$out" | _q '" ".join([str(d["api"][3].get("approx")), d["api"][3]["path"]])')" approx &&
  assert_eq "AtletiController src/atleti/atleti.controller.ts 6" "$(echo "$out" | _q '" ".join([d["api"][0]["group"], d["api"][0]["file"], str(d["api"][0]["line"])])')" where
}

test_pi_docs_order_titles_headings_and_skips_vendored() {
  _nest_repo; out=$(_pi "$R") || return 1
  assert_eq "['README.md', 'docs/api/guide.md']" "$(echo "$out" | _q '[x["path"] for x in d["docs"]]')" order &&
  assert_eq "My App" "$(echo "$out" | _q 'd["docs"][0]["title"]')" title &&
  assert_eq "['Setup', 'Usage']" "$(echo "$out" | _q '[h["text"] for h in d["docs"][0]["headings"]]')" headings &&
  assert_eq "Docs · api" "$(echo "$out" | _q 'd["docs"][1]["group"]')" group
}

test_pi_env_names_only_scripts_urls_commits() {
  _nest_repo; out=$(_pi "$R") || return 1
  assert_eq "['PORT', 'DATABASE_URL', 'JWT_SECRET']" "$(echo "$out" | _q '[e["name"] for e in d["env"]]')" env &&
  assert_not_contains "$out" "secret@db" && assert_not_contains "$out" "do-not-read" && assert_not_contains "$out" "REAL_SECRET" &&
  assert_eq "['npm run start:dev', 'npm run test', 'make build']" "$(echo "$out" | _q '[s["run"] for s in d["scripts"]]')" scripts &&
  assert_eq "['http://localhost:3000/api']" "$(echo "$out" | _q 'd["urls"]')" urls &&
  assert_eq "first commit Tester" "$(echo "$out" | _q 'd["commits"][0]["subject"] + " " + d["commits"][0]["author"]')" commits
}

test_pi_doc_text_stays_inside_the_repo() {
  _nest_repo
  assert_contains "$(_pi "$R" --doc docs/api/guide.md)" "# API guide" || return 1
  _pi "$R" --doc ../../etc/passwd >/dev/null 2>&1; assert_eq 3 "$?" escape || return 1
  _pi "$R" --doc package.json >/dev/null 2>&1; assert_eq 3 "$?" not-markdown
}

test_pi_openapi_yaml_and_json_express_fastapi() {
  new_tmp; R="$TMP/o"; mkdir -p "$R/api" "$R/app"
  printf 'openapi: 3.0.0\npaths:\n  /pets:\n    get:\n      summary: list\n    post:\n      summary: add\n  "/pets/{id}":\n    delete:\n      summary: rm\ncomponents: {}\n' > "$R/api/openapi.yaml"
  printf '{"paths": {"/users": {"get": {"tags": ["Users"], "summary": "All users"}}}}' > "$R/swagger.json"
  printf "router.get('/health', h)\napp.post(\"/login\", h)\n" > "$R/server.js"
  printf '@app.get("/items/{id}")\ndef item(): pass\n' > "$R/app/main.py"
  out=$(_pi "$R") || return 1
  assert_eq "['DELETE /pets/{id}', 'GET /health', 'GET /items/{id}', 'GET /pets', 'GET /users', 'POST /login', 'POST /pets']" \
    "$(echo "$out" | _q 'sorted(e["method"] + " " + e["path"] for e in d["api"])')"
}
