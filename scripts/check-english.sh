#!/usr/bin/env bash
# Anti-French guard. Fails when a common French word reappears in the versioned sources.
#
# Method: whole-word, case-insensitive match of a short list of very common French words that
# have no English homograph. Whole words only -- a substring match would flag `values` for
# `les`, `paste` for `pas` or `latest` for `la`. Only tracked files are scanned, and only the
# kinds that carry prose: comments, docstrings, test names, error messages.
#
# Reports FILE:LINE:WORD, one line per occurrence, so the offending line can be opened
# straight away.
set -euo pipefail

cd "$(dirname "$0")/.."

# Words with no English homograph. Deliberately short: every entry must be a word a French
# comment can hardly avoid, and an English one cannot produce.
WORDS='le|la|les|des|une|qui|pour|dans|avec|pas|mais|donc|jamais|toujours|aucun|est|sont|cette|sans|leur|nous|vous|elle|elles|ils|chaque|entre|alors|donne|rend'

# Explicit exclusions, every entry justified. Anything listed here contains one of the words
# above legitimately.
EXCLUDED=(
  # French translation catalogue of the front end: French by design, that is its entire job.
  'apps/web/src/i18n/fr.ts'
  # This guard itself: it carries the French word list in clear text.
  'scripts/check-english.sh'
)

# Git pathspec wildcards match `/` as well, so `*.yml` reaches nested workflow files too.
files=()
while IFS= read -r file; do
  skip=
  for excluded in "${EXCLUDED[@]}"; do
    if [ "$file" = "$excluded" ]; then
      skip=1
      break
    fi
  done
  if [ -z "$skip" ]; then
    files+=("$file")
  fi
done < <(git ls-files -- \
  'apps/**/*.ts' 'apps/**/*.tsx' 'apps/**/*.css' \
  'worker/**/*.py' \
  '*.yml' \
  '.env.example' 'README.md')

if [ "${#files[@]}" -eq 0 ]; then
  echo "check-english: no source file matched, the patterns are stale" >&2
  exit 1
fi

# `grep -nowiE` prints FILE:LINE:WORD. Status 1 means no match (the passing case); anything
# above means grep itself failed, which must never be mistaken for a clean run.
set +e
matches=$(grep -nowiE "$WORDS" -- "${files[@]}")
status=$?
set -e

if [ "$status" -gt 1 ]; then
  echo "check-english: grep failed with status $status" >&2
  exit "$status"
fi

if [ "$status" -eq 0 ]; then
  echo "check-english: French found in the sources (FILE:LINE:WORD)" >&2
  echo "$matches" >&2
  echo "check-english: $(printf '%s\n' "$matches" | wc -l | tr -d ' ') occurrence(s) in" \
       "$(printf '%s\n' "$matches" | cut -d: -f1 | sort -u | wc -l | tr -d ' ') file(s)" >&2
  exit 1
fi

echo "check-english: ${#files[@]} files scanned, no French found"
