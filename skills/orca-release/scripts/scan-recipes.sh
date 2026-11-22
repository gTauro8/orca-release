#!/bin/bash
# scan-recipes.sh [--repo DIR] [--status] — what to update in the release recipes (read-only, no network).
exec python3 -I "$(dirname "$0")/scan_recipes.py" "$@"
