"""Forward existing systemd commands to their TypeScript entry points."""
import os
import shutil
import sys
from pathlib import Path


def run(script):
    node = os.environ.get("VIBE_NODE") or shutil.which("node")
    if not node:
        # User services may have a minimal PATH even when Node is installed via nvm.
        versions = (Path.home() / ".nvm/versions/node").glob("v*/bin/node")
        candidates = [path for path in versions if os.access(path, os.X_OK)]
        if not candidates:
            raise SystemExit("Install Node.js 22.18+ and set VIBE_NODE to its executable")
        node = max(candidates, key=lambda path: tuple(map(int, path.parents[1].name[1:].split("."))))
    os.execvpe(node, [str(node), str(script), *sys.argv[1:]], os.environ)
