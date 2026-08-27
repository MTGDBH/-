from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = [
    ROOT / "ml" / "curve" / "test_health_curve.py",
    ROOT / "ml" / "curve" / "test_forecast_selection.py",
    ROOT / "ml" / "curve" / "test_temporal_validation.py",
    ROOT / "ml" / "curve" / "test_validate_external_dataset.py",
    ROOT / "ml" / "curve" / "test_external_validation_pipeline.py",
]


@pytest.mark.parametrize("script", SCRIPTS, ids=lambda path: path.stem)
def test_direct_curve_regression(script: Path, tmp_path: Path):
    env = {
        **os.environ,
        "PYTHONUTF8": "1",
        "PYTHONIOENCODING": "utf-8",
        "PYTHONDONTWRITEBYTECODE": "1",
        "TMP": str(tmp_path),
        "TEMP": str(tmp_path),
    }
    proc = subprocess.run(
        [sys.executable, str(script)], cwd=tmp_path, env=env,
        capture_output=True, text=True, encoding="utf-8", timeout=600,
    )
    assert proc.returncode == 0, f"{proc.stdout}\n{proc.stderr}"
