"""Compatibility entry point for gallery services configured to start Python."""
import sys
from pathlib import Path

if __name__ == "__main__":
    script = Path(__file__).resolve()
    sys.path.insert(0, str(script.parents[1] / "ops"))
    from run_node import run

    run(script.with_suffix(".ts"))
