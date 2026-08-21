# -*- coding: utf-8 -*-
"""统一实验运行元数据。

所有可复现实验都应保存同一组信息：run_id、代码版本、数据版本、模型版本、
参数和输出文件。该模块不上传数据，也不保存 API 密钥。
"""
from __future__ import annotations

import hashlib
import json
import os
import platform
import subprocess
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def git_revision(project_root: Path | None = None) -> str:
    root = project_root or Path(__file__).resolve().parent.parent
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=root, text=True,
            stderr=subprocess.DEVNULL
        ).strip()
    except Exception:
        return "working-tree"


def new_run_id(prefix: str = "exp") -> str:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    return f"{prefix}-{stamp}-{uuid.uuid4().hex[:8]}"


def sha256_file(path: str | Path) -> str | None:
    p = Path(path)
    if not p.exists():
        return None
    digest = hashlib.sha256()
    with p.open("rb") as fh:
        for block in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def build_manifest(*, run_id: str, task: str, data_version: str,
                   model_version: str, parameters: dict, outputs: list[str],
                   project_root: Path | None = None, status: str = "completed") -> dict:
    root = project_root or Path(__file__).resolve().parent.parent
    return {
        "schema_version": "experiment-run.v1",
        "run_id": run_id,
        "task": task,
        "status": status,
        "started_at": utc_now(),
        "completed_at": utc_now(),
        "code": {"git_revision": git_revision(root), "working_tree": True},
        "data": {"manifest_id": data_version},
        "model": {"version": model_version},
        "parameters": parameters,
        "outputs": outputs,
        "environment": {
            "python": sys.version.split()[0],
            "platform": platform.platform(),
            "node": os.environ.get("NODE_VERSION", "not_recorded"),
        },
    }


def write_manifest(manifest: dict, path: str | Path) -> Path:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return target
