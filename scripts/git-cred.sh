#!/bin/sh
# Git credential helper for this repo: answers auth requests with the PAT from
# github_token.txt (read live, never stored anywhere else, never printed).
# Wired in .git/config → kills the VS Code "Select an account" popup on push.
[ "$1" = "get" ] || exit 0
tok=$(grep -E '^[[:space:]]*(ghp_|github_pat_)[A-Za-z0-9_]+[[:space:]]*$' C:/pandi/project-nirai/try1/github_token.txt | head -1 | tr -d '[:space:]')
[ -n "$tok" ] || exit 0
echo "username=x-access-token"
echo "password=$tok"
