---
id: my-project            # must equal the file name without .md
match:
  remotes: ["git.example.org/team/my-project"]   # any URL form works; matched after normalizing
  paths: ["~/Development/my-project"]                       # optional; used when there is no remote
host: gitea               # github | gitea | other
base_branch: main         # branch PRs target; /push warns before pushing straight to it
pr_url_template: ""       # host other only, optional: e.g. https://{remote}/compare/{base}...{branch}
---
<!--
Step syntax (strict):
  - [ ] `command`            -> the agent runs it
  - [ ] anything else        -> manual: the agent shows it and waits for your OK
Steps that were guessed and still need checking end with an HTML comment
saying "inferred: confirm"; delete it once you've verified the step.
-->

## push
- [ ] `make lint`
- [ ] `make test`
- [ ] no debug prints or TODOs left in the diff

## pr
- title: `<type>: <summary>` (feat, fix, chore…)
- body: what changed, why, how it was tested
- reviewers: none

<!-- Optional sections:
## compose   local support services (see the README)
## dev       long-running dev processes, one backticked command each
## links     how this project relates to others (proposed by /align, confirmed by you):
- domain: shop                 # kebab-case; projects with the same domain are drawn together
- domain-label: Shop           # display name (optional)
- uses-api: shop-api           # types: uses-api | follows | replaces | related
- replaces: ext:Legacy CMS     # ext:<Name> = a system that is not one of your projects
-->

## deploy
### staging (confirm)
- url: https://staging.example.org     # optional: the board shows up/down and the deployed version
- health: /health                      # optional: path (or full URL) answering JSON with version/commit
- [ ] `make build`
- [ ] trigger the release workflow: https://example.org/my-project/actions
- [ ] check the app responds on staging
