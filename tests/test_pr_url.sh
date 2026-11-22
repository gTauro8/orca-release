# shellcheck shell=bash

test_gitea_compare_url() {
  out=$("$SCRIPTS/pr-url.sh" gitea git.example.com/team/mobile-app develop feature/login)
  assert_eq "https://git.example.com/team/mobile-app/compare/develop...feature/login" "$out"
}

test_other_host_without_template_opens_repo() {
  out=$("$SCRIPTS/pr-url.sh" other forge.example.net/git/flutter-app main feat/x "")
  assert_eq "https://forge.example.net/git/flutter-app" "$out"
}

test_other_host_with_template() {
  out=$("$SCRIPTS/pr-url.sh" other forge.example.net/git/flutter-app main feat/x 'https://{remote}/pulls/new/{base}...{branch}')
  assert_eq "https://forge.example.net/git/flutter-app/pulls/new/main...feat/x" "$out"
}

test_other_host_like_forgejo() {
  assert_eq "https://git.example.org/team/app" "$("$SCRIPTS/pr-url.sh" other git.example.org/team/app main feat "")" no-tpl &&
  assert_eq "https://git.example.org/team/app/-/merge_requests/new?merge_request[source_branch]=feat" \
    "$("$SCRIPTS/pr-url.sh" other git.example.org/team/app main feat 'https://{remote}/-/merge_requests/new?merge_request[source_branch]={branch}')" tpl
}

test_github_defers_to_gh() {
  "$SCRIPTS/pr-url.sh" github github.com/me/app main feat >/dev/null 2>&1; rc=$?
  assert_eq 4 "$rc"
}

test_unknown_host_fails() {
  "$SCRIPTS/pr-url.sh" gitlab x/y main feat >/dev/null 2>&1; rc=$?
  assert_eq 1 "$rc"
}
