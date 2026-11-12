#!/usr/bin/env bash
# Install the Python workspace dependencies and verify existing engine data.
set -euo pipefail
cd "$(dirname "$0")/../.."
command -v uv >/dev/null || { echo 'uv is required' >&2; exit 1; }
uv sync --package myangustis-scraper --package myangustis-engine --package myangustis-parser
uv run --package myangustis-scraper python D.Scraper/run/deploy/engine_ready.py
printf '%s\n' 'The Python engine uses separately built trees and an externally supplied master/key.'
