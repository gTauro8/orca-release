---
id: example-node-api
match:
  remotes: ["git.example.org/team/example-node-api"]
  paths: ["~/Development/example-node-api"]
host: gitea
base_branch: main
---
<!-- Example: Node/NestJS API with Prisma, Postgres in Docker and a release workflow. Copy it to recipes/<id>.md and adapt it. -->

## push
- [ ] `npm run lint`
- [ ] `npm test`
- [ ] `npm run build`
- [ ] if `prisma/schema.prisma` changed: the migration exists in `prisma/migrations`

## pr
- title: `<type>: <summary>` (feat, fix, chore…)
- body: what changes, why, how it was tested; highlight new environment variables and migrations
- reviewers: none

## deploy
### staging (confirm)
- [ ] the commit to release is on `main` and pushed
- [ ] `npm test`
- [ ] run the `release.yml` workflow from the repo's Actions page
- [ ] wait for it to finish green and check the API responds on staging

## compose
- file: `docker-compose.yml`
- project: example-node-api
- services: postgres
- note: Postgres on localhost:5433

## links
- domain: example
- domain-label: Example
- replaces: ext:Legacy CMS
