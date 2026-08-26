#!/usr/bin/env bash
# Cartograph launcher for macOS and Linux.
cd "$(dirname "$0")" || exit 1
if command -v python3 >/dev/null 2>&1; then
  exec python3 app.py "$@"
fi
echo "Python 3 was not found. Install it and run this file again."
exit 1
