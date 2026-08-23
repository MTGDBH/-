"""Create, validate and install the private inference-model bundle.

Only derived inference artifacts are included. Raw CHARLS data is never read.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import ssl
import sys
import tempfile
import urllib.parse
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath


SCHEMA = "health-model-bundle.v1"
CONTRACT = "health-prediction.v1"
MAX_BYTES = 100 * 1024 * 1024
NUMERIC_TARGETS = ("systo", "diasto", "hr", "weight", "waist", "grip")
RISK_TARGETS = ("glucose", "hba1c", "cholesterol", "uricacid", "creatinine")
OUTCOME_TARGETS = ("adl_limitation", "depressive_symptoms", "fall")
RISK_TIERS = ("noninvasive", "micro_anchor")
HTN_REQUIRED = (
    "htn_xgb/candidate_model.json",
    "htn_xgb/calibrator_isotonic.pkl",
    "htn_xgb/calibrator_platt.pkl",
    "htn_xgb/threshold.json",
    "htn_xgb/candidate_metadata.json",
)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _safe_relative(value: str) -> str:
    normalized = value.replace("\\", "/")
    candidate = PurePosixPath(normalized)
    if candidate.is_absolute() or ".." in candidate.parts or not candidate.parts:
        raise ValueError(f"unsafe bundle path: {value!r}")
    return candidate.as_posix()


def _required_paths(source: Path) -> list[str]:
    required = list(HTN_REQUIRED)
    for target in NUMERIC_TARGETS:
        metadata_path = source / "population" / f"numeric_{target}.metadata.json"
        required.append(f"population/{metadata_path.name}")
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        if metadata.get("selected_model") != "last_value":
            required.append(f"population/numeric_{target}.joblib")
    for target in RISK_TARGETS:
        for tier in RISK_TIERS:
            stem = f"risk_{target}_{tier}"
            required.extend((f"population/{stem}.metadata.json", f"population/{stem}.joblib"))
    for target in OUTCOME_TARGETS:
        stem = f"risk_{target}_noninvasive"
        required.extend((f"population/{stem}.metadata.json", f"population/{stem}.joblib"))
    return sorted(set(required))


def _sanitize_json(value):
    if isinstance(value, dict):
        clean = {}
        for key, item in value.items():
            if key == "artifact" and isinstance(item, str):
                clean[key] = Path(item).name
            else:
                clean[key] = _sanitize_json(item)
        return clean
    if isinstance(value, list):
        return [_sanitize_json(item) for item in value]
    return value


def create_bundle(source: Path, output: Path, version: str) -> dict:
    required = _required_paths(source)
    with tempfile.TemporaryDirectory(prefix="health-model-package-") as temp_name:
        stage = Path(temp_name)
        entries = []
        for relative in required:
            src = source / relative
            if not src.is_file():
                raise FileNotFoundError(f"required inference artifact missing: {relative}")
            dest = stage / relative
            dest.parent.mkdir(parents=True, exist_ok=True)
            if src.suffix.lower() == ".json":
                value = _sanitize_json(json.loads(src.read_text(encoding="utf-8")))
                dest.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            else:
                shutil.copy2(src, dest)
            entries.append({"path": relative, "size": dest.stat().st_size, "sha256": sha256_file(dest)})

        manifest = {
            "schema_version": SCHEMA,
            "bundle_version": version,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "prediction_contract_version": CONTRACT,
            "runtime": {
                "python": "3.14.x",
                "numpy": "2.4.6",
                "pandas": "3.0.3",
                "scikit_learn": "1.9.0",
                "joblib": "1.5.3",
                "lightgbm": "4.7.0",
                "xgboost": "3.4.1",
            },
            "files": entries,
        }
        (stage / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        output.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
            for path in sorted(stage.rglob("*")):
                if path.is_file():
                    archive.write(path, path.relative_to(stage).as_posix())
    return {"ok": True, "bundle_version": version, "path": str(output), "sha256": sha256_file(output), "files": len(entries)}


def validate_bundle(directory: Path) -> dict:
    manifest_path = directory / "manifest.json"
    if not manifest_path.is_file():
        return {"status": "missing", "reason_code": "MODEL_BUNDLE_MISSING", "bundle_version": None, "targets": []}
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        if manifest.get("schema_version") != SCHEMA or manifest.get("prediction_contract_version") != CONTRACT:
            raise ValueError("bundle contract is incompatible")
        listed = {}
        for item in manifest.get("files", []):
            relative = _safe_relative(str(item["path"]))
            if relative in listed:
                raise ValueError(f"duplicate manifest path: {relative}")
            listed[relative] = item
            path = directory / Path(relative)
            if not path.is_file() or path.stat().st_size != int(item["size"]) or sha256_file(path) != item["sha256"]:
                raise ValueError(f"artifact validation failed: {relative}")
        for required in _required_paths(directory):
            if required not in listed:
                raise ValueError(f"required artifact is not signed: {required}")
        targets = ["bp", "hr", "weight", "waist", "grip", *RISK_TARGETS, *OUTCOME_TARGETS]
        return {"status": "ready", "reason_code": None, "bundle_version": manifest.get("bundle_version"), "targets": targets}
    except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError) as exc:
        return {"status": "invalid", "reason_code": "MODEL_BUNDLE_INVALID", "bundle_version": None, "targets": [], "detail": str(exc)}


def _download(url: str, output: Path, max_bytes: int, allow_http: bool) -> None:
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "https" and not (allow_http and parsed.scheme in {"http", "file"}):
        raise ValueError("model bundle URL must use HTTPS")
    request = urllib.request.Request(url, headers={"User-Agent": "elderly-health-model-installer/1"})
    context = ssl.create_default_context()
    with urllib.request.urlopen(request, timeout=60, context=context) as response, output.open("wb") as stream:
        declared = response.headers.get("Content-Length")
        if declared and int(declared) > max_bytes:
            raise ValueError("model bundle exceeds size limit")
        total = 0
        while True:
            chunk = response.read(1024 * 1024)
            if not chunk:
                break
            total += len(chunk)
            if total > max_bytes:
                raise ValueError("model bundle exceeds size limit")
            stream.write(chunk)


def _safe_extract(archive_path: Path, destination: Path) -> None:
    with zipfile.ZipFile(archive_path) as archive:
        for item in archive.infolist():
            relative = _safe_relative(item.filename)
            target = (destination / Path(relative)).resolve()
            if destination.resolve() not in target.parents and target != destination.resolve():
                raise ValueError("archive path escapes extraction directory")
        archive.extractall(destination)


def install_bundle(url: str, expected_sha256: str, destination: Path, max_bytes: int, allow_http: bool) -> dict:
    expected = expected_sha256.strip().lower()
    if len(expected) != 64 or any(ch not in "0123456789abcdef" for ch in expected):
        raise ValueError("MODEL_BUNDLE_SHA256 must be a 64-character hexadecimal digest")
    parent = destination.parent
    parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="health-model-install-", dir=parent) as temp_name:
        temp = Path(temp_name)
        archive_path = temp / "bundle.zip"
        extracted = temp / "extracted"
        extracted.mkdir()
        _download(url, archive_path, max_bytes, allow_http)
        if sha256_file(archive_path) != expected:
            raise ValueError("model bundle SHA-256 mismatch")
        _safe_extract(archive_path, extracted)
        status = validate_bundle(extracted)
        if status["status"] != "ready":
            raise ValueError(status.get("detail") or "model bundle validation failed")
        replacement = parent / f".{destination.name}.new-{os.getpid()}"
        backup = parent / f".{destination.name}.previous-{os.getpid()}"
        if replacement.exists():
            shutil.rmtree(replacement)
        shutil.move(str(extracted), replacement)
        try:
            if destination.exists():
                destination.rename(backup)
            replacement.rename(destination)
            if backup.exists():
                shutil.rmtree(backup)
        except Exception:
            if destination.exists() and destination != backup:
                shutil.rmtree(destination, ignore_errors=True)
            if backup.exists():
                backup.rename(destination)
            raise
    return status


def main() -> int:
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest="command", required=True)
    package = commands.add_parser("package")
    package.add_argument("--source", required=True)
    package.add_argument("--output", required=True)
    package.add_argument("--version", required=True)
    validate = commands.add_parser("validate")
    validate.add_argument("--models-dir", required=True)
    install = commands.add_parser("install")
    install.add_argument("--url")
    install.add_argument("--url-env")
    install.add_argument("--sha256", required=True)
    install.add_argument("--models-dir", required=True)
    install.add_argument("--max-bytes", type=int, default=MAX_BYTES)
    install.add_argument("--allow-http", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()
    try:
        if args.command == "package":
            result = create_bundle(Path(args.source), Path(args.output), args.version)
        elif args.command == "validate":
            result = validate_bundle(Path(args.models_dir))
        else:
            url = args.url or (os.environ.get(args.url_env, "") if args.url_env else "")
            if not url:
                raise ValueError("model bundle URL is required")
            result = install_bundle(url, args.sha256, Path(args.models_dir), args.max_bytes, args.allow_http)
        sys.stdout.write(json.dumps(result, ensure_ascii=False) + "\n")
        return 0 if result.get("status", "ready") == "ready" or result.get("ok") else 2
    except Exception as exc:
        sys.stdout.write(json.dumps({"status": "invalid", "reason_code": "MODEL_BUNDLE_INSTALL_FAILED", "error": type(exc).__name__, "message": str(exc)}, ensure_ascii=False) + "\n")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
