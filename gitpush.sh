#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# gitpush.sh — push the local Apk-builder/ folder to its GitHub source repo.
#
# Reads the GitHub token from one of these env vars (in order of precedence):
#   GITHUB_TOKEN   (recommended — set as a Replit secret)
#   GH_TOKEN
#   GITHUB_PAT
#
# Optional overrides:
#   APK_REMOTE     full HTTPS clone URL of the target repo
#                  (default: https://github.com/lastie357-droid/Apk-builder.git)
#   APK_BRANCH     branch to push to              (default: main)
#   COMMIT_MSG     commit message for the push    (default: timestamped)
#   SRC_DIR        local folder to publish        (default: ./Apk-builder)
#
# Usage:
#   bash gitpush.sh
#   COMMIT_MSG="hotfix: bump heap" bash gitpush.sh
#   APK_BRANCH=dev bash gitpush.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

TOKEN="${GITHUB_TOKEN:-${GH_TOKEN:-${GITHUB_PAT:-}}}"
if [[ -z "$TOKEN" ]]; then
    echo "✘ No GitHub token in env. Set GITHUB_TOKEN as a Replit secret"
    echo "  (Tools → Secrets → New secret: key=GITHUB_TOKEN, value=ghp_…)" >&2
    exit 1
fi

REMOTE="${APK_REMOTE:-https://github.com/lastie357-droid/Apk-builder.git}"
BRANCH="${APK_BRANCH:-main}"
SRC_DIR="${SRC_DIR:-$(cd "$(dirname "$0")" && pwd)/Apk-builder}"
COMMIT_MSG="${COMMIT_MSG:-Update from Replit on $(date -u +%Y-%m-%dT%H:%M:%SZ)}"

if [[ ! -d "$SRC_DIR" ]]; then
    echo "✘ Source folder not found: $SRC_DIR" >&2
    exit 1
fi

# Authenticate via Authorization header, but fall back to URL-embedded token.
# The Authorization header method (Bearer token) may fail with some repo permissions;
# the URL method (token@) is more reliable for pushing to repos.
AUTH_HEADER="Authorization: Bearer ${TOKEN}"
GIT_AUTH=(-c "http.extraHeader=${AUTH_HEADER}")
AUTH_REMOTE="https://${TOKEN}@github.com/lastie357-droid/Apk-builder.git"

WORK="$(mktemp -d -t apkpush.XXXXXX)"
trap 'rm -rf "$WORK"' EXIT

echo "→ Cloning $REMOTE  (branch: $BRANCH)"
GIT_TERMINAL_PROMPT=0 git "${GIT_AUTH[@]}" clone --depth 1 --branch "$BRANCH" "$REMOTE" "$WORK/repo" >/dev/null 2>&1 || {
    # Try falling back to URL-embedded token auth if Bearer auth fails
    echo "  Bearer auth failed — falling back to URL-embedded token"
    GIT_TERMINAL_PROMPT=0 git clone --depth 1 --branch "$BRANCH" "$AUTH_REMOTE" "$WORK/repo" >/dev/null 2>&1
}

# If clone still fails (e.g., branch doesn't exist), clone default and create branch.
if [[ ! -d "$WORK/repo/.git" ]]; then
    echo "  branch '$BRANCH' missing or empty — falling back to default clone"
    GIT_TERMINAL_PROMPT=0 git clone "$REMOTE" "$WORK/repo" >/dev/null 2>&1 || {
        GIT_TERMINAL_PROMPT=0 git clone "$AUTH_REMOTE" "$WORK/repo" >/dev/null 2>&1
    }
    ( cd "$WORK/repo" && git checkout -B "$BRANCH" )
fi

echo "→ Syncing $SRC_DIR/  →  repo/"
# Wipe everything except .git, then copy the source tree on top.
( cd "$WORK/repo" && find . -mindepth 1 -maxdepth 1 ! -name '.git' -exec rm -rf {} + )

# Use cp -a to preserve permissions (so build.sh / gradlew stay executable).
# Skip runtime-only / generated dirs that should never be committed.
EXCLUDES=(
    "apk-output"
    "build_logs"
    "node_modules"
    ".gradle"
    "app/build"
    "installer/build"
)
( cd "$SRC_DIR" && cp -a . "$WORK/repo"/ )
for ex in "${EXCLUDES[@]}"; do
    rm -rf "$WORK/repo/$ex"
done
# Drop *.log files anywhere in the tree
find "$WORK/repo" -path "$WORK/repo/.git" -prune -o -name '*.log' -type f -print0 | xargs -0 -r rm -f

cd "$WORK/repo"
git config user.email "${GIT_AUTHOR_EMAIL:-replit-agent@users.noreply.github.com}"
git config user.name  "${GIT_AUTHOR_NAME:-Replit Agent}"

git add -A
if git diff --cached --quiet; then
    echo "✓ Nothing to push — remote is already up to date."
    exit 0
fi

CHANGES="$(git diff --cached --name-only | wc -l | tr -d ' ')"
echo "→ Committing ($CHANGES files changed)…"
git commit -m "$COMMIT_MSG" >/dev/null

echo "→ Pushing to $REMOTE  (branch: $BRANCH)"
# Try Bearer auth first; fall back to URL-embedded token on failure.
GIT_TERMINAL_PROMPT=0 git "${GIT_AUTH[@]}" push origin "$BRANCH" >/dev/null 2>&1 || {
    echo "  Bearer auth push failed — retrying with URL-embedded token"
    GIT_TERMINAL_PROMPT=0 git remote set-url origin "$AUTH_REMOTE"
    GIT_TERMINAL_PROMPT=0 git push origin "$BRANCH"
}

NEW_SHA="$(git rev-parse HEAD)"
echo
echo "✓ Pushed. New HEAD: $NEW_SHA"
echo "  https://github.com/lastie357-droid/Apk-builder/commit/$NEW_SHA"
