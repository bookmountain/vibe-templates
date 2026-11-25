"""Compatibility entry point for the existing deployment timer."""
from pathlib import Path

if __name__ == "__main__":
    from run_node import run

    run(Path(__file__).with_suffix(".ts"))
