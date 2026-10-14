# Sourced by the night scripts. Override any of these before sourcing.
export NIGHT_DIR="${NIGHT_DIR:-$HOME/.personas/curator-night}"     # claims/, candidates*.json
export REGISTRY="${REGISTRY:-$HOME/kiro/ai-registry}"              # the registry checkout (NEVER merged into here mid-run)
export INTEG="${INTEG:-/c/t/integ}"                                # worktree on the integration branch
export INTEG_BRANCH="${INTEG_BRANCH:-curator-night-$(date +%m%d)}"
export WT_ROOT="${WT_ROOT:-/c/t}"                                  # per-worker worktrees land at $WT_ROOT/cn<k>
export PERSONAS="${PERSONAS:-$HOME/kiro/personas}"                 # where loop.py lives
export COAUTHOR="Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
