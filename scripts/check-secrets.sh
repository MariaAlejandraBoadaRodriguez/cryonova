#!/usr/bin/env bash
# Fails if tracked files contain credential-shaped strings. Prints file names
# and pattern names only, never the matched text.
set -euo pipefail
declare -A PATTERNS=(
  [anthropic_key]='sk-ant-[A-Za-z0-9_-]{20,}'
  [neon_password]='npg_[A-Za-z0-9]{10,}'
  [postgres_url_with_password]='postgres(ql)?://[^:@/[:space:]]+:[^@[:space:]]{8,}@[a-z0-9.-]+'
  [jwt]='eyJhbGciOi[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}'
  [aws_access_key]='AKIA[0-9A-Z]{16}'
  [github_token]='gh[pousr]_[A-Za-z0-9]{30,}'
  [private_key]='-----BEGIN [A-Z ]*PRIVATE KEY-----'
)
status=0
files=$(git ls-files | grep -v -E '^(package-lock\.json|tests/fixtures/)')
for name in "${!PATTERNS[@]}"; do
  hits=$(echo "$files" | xargs grep -l -E -- "${PATTERNS[$name]}" 2>/dev/null | grep -v '^\.env\.example$' || true)
  if [ -n "$hits" ]; then
    echo "Possible secret ($name) in: $hits"
    status=1
  fi
done
[ $status -eq 0 ] && echo "Secret scan: no credential-shaped strings in tracked files."
exit $status
