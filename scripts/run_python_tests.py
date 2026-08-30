#!/usr/bin/env python3
"""Side-effect-free Python test entry point used locally and in CI."""
from __future__ import annotations

import ast
import os
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
GROUPS = {
    "unit": [
        "elderly-health-rag/eval_framework/tests/test_framework.py",
        "elderly-health-rag/eval_framework/tests/test_collection_materials.py",
        "ml/common/test_prediction_common.py",
        "ml/validation/test_validation_tools.py",
        "reports/test_human_evaluation_analyzer.py",
        "reports/test_real_world_evaluation_toolkit.py",
        "tests/test_intervention_evaluation.py",
    ],
    "graphrag": ["tests/test_graphrag_isolation.py"],
    "security": ["tests/test_graphrag_isolation.py", "tests/test_runtime_service.py", "tests/test_container_hygiene.py"],
    "curve": [
        "tests/test_curve_regression_wrappers.py",
    ],
}


def git_status() -> bytes:
    return subprocess.check_output(["git", "status", "--porcelain=v1", "-z"], cwd=ROOT)


def syntax_check() -> int:
    failures = []
    tracked = subprocess.check_output(
        ["git", "ls-files", "*.py"], cwd=ROOT, text=True, encoding="utf-8"
    )
    for relative_path in tracked.splitlines():
        path = ROOT / relative_path
        try:
            ast.parse(path.read_text(encoding="utf-8-sig"), filename=str(path))
        except (SyntaxError, UnicodeError) as exc:
            failures.append(f"{path.relative_to(ROOT)}: {exc}")
    if failures:
        print("\n".join(failures), file=sys.stderr)
        return 1
    print("Python syntax/UTF-8 check: PASS")
    return 0


def main() -> int:
    group = sys.argv[1] if len(sys.argv) > 1 else "unit"
    before = git_status()
    env = {**os.environ, "PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8", "PYTHONDONTWRITEBYTECODE": "1"}
    if group == "syntax":
        code = syntax_check()
    else:
        selected = GROUPS.get(group)
        if selected is None:
            print(f"Unknown Python test group: {group}", file=sys.stderr)
            return 2
        code = subprocess.call(
            [sys.executable, "-m", "pytest", "-p", "no:cacheprovider", "--disable-warnings", "-q", *selected],
            cwd=ROOT, env=env,
        )
    after = git_status()
    if before != after:
        print("Tests changed the Git working tree; refusing the result.", file=sys.stderr)
        subprocess.call(["git", "status", "--short"], cwd=ROOT)
        return 1
    print("Git status unchanged after Python tests.")
    return code


if __name__ == "__main__":
    raise SystemExit(main())
