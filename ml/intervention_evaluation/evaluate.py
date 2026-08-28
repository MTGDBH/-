# -*- coding: utf-8 -*-
"""CLI entry point for the registered intervention evaluation tool."""
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from ml.intervention_evaluation.engine import main

if __name__ == "__main__":
    raise SystemExit(main())
