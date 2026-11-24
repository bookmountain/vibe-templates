"""Start the built React application and Django API behind the local reverse proxy."""

import os
from pathlib import Path

root = Path(__file__).resolve().parent.parent
python = root / ".venv/bin/python"
os.chdir(root)
os.execv(
    str(python),
    [
        str(python),
        "-m",
        "gunicorn",
        "--no-control-socket",
        "--bind",
        "127.0.0.1:" + os.getenv("VIBE_PORT", "4175"),
        "--workers",
        "2",
        "--threads",
        "4",
        "--error-logfile",
        "-",
        "gallery.wsgi:application",
    ],
)
