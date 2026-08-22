from __future__ import annotations

import hashlib
import json
import tempfile
import zipfile
from pathlib import Path

from model_bundle import (
    HTN_REQUIRED,
    NUMERIC_TARGETS,
    RISK_TARGETS,
    RISK_TIERS,
    _safe_extract,
    create_bundle,
    install_bundle,
    sha256_file,
    validate_bundle,
)


def make_source(root: Path) -> Path:
    source = root / "source"
    for relative in HTN_REQUIRED:
        path = source / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        if path.suffix == ".json":
            path.write_text(json.dumps({"artifact": r"D:\private\respondent-free.json"}), encoding="utf-8")
        else:
            path.write_bytes(b"private-inference-artifact")
    population = source / "population"
    population.mkdir(parents=True, exist_ok=True)
    for target in NUMERIC_TARGETS:
        (population / f"numeric_{target}.metadata.json").write_text(json.dumps({"selected_model": "last_value", "artifact": rf"D:\private\numeric_{target}.joblib"}), encoding="utf-8")
    for target in RISK_TARGETS:
        for tier in RISK_TIERS:
            stem = f"risk_{target}_{tier}"
            (population / f"{stem}.metadata.json").write_text(json.dumps({"selected_model": "logistic", "artifact": rf"D:\private\{stem}.joblib"}), encoding="utf-8")
            (population / f"{stem}.joblib").write_bytes(b"signed-joblib")
    return source


def main() -> None:
    with tempfile.TemporaryDirectory() as temp_name:
        root = Path(temp_name)
        source = make_source(root)
        archive = root / "bundle.zip"
        result = create_bundle(source, archive, "test-v1")
        assert result["files"] > 20
        digest = sha256_file(archive)

        installed = root / "models"
        status = install_bundle(archive.as_uri(), digest, installed, 10 * 1024 * 1024, True)
        assert status["status"] == "ready"
        assert validate_bundle(installed)["bundle_version"] == "test-v1"
        sanitized = json.loads((installed / "population" / "numeric_systo.metadata.json").read_text(encoding="utf-8"))
        assert sanitized["artifact"] == "numeric_systo.joblib"

        marker = installed / "marker.txt"
        marker.write_text("keep-last-known-good", encoding="utf-8")
        try:
            install_bundle(archive.as_uri(), "0" * 64, installed, 10 * 1024 * 1024, True)
            raise AssertionError("wrong digest must fail")
        except ValueError:
            pass
        assert marker.read_text(encoding="utf-8") == "keep-last-known-good"
        expired_failed = False
        try:
            install_bundle((root / "expired-signed-url.zip").as_uri(), digest, installed, 10 * 1024 * 1024, True)
        except Exception:
            expired_failed = True
        assert expired_failed, "expired or missing URL must fail"
        assert marker.read_text(encoding="utf-8") == "keep-last-known-good"
        try:
            install_bundle(archive.as_uri(), digest, installed, 1, True)
            raise AssertionError("oversized bundle must fail")
        except ValueError:
            pass

        signed_file = installed / "htn_xgb" / "candidate_model.json"
        signed_file.write_text("corrupted", encoding="utf-8")
        assert validate_bundle(installed)["status"] == "invalid"

        malicious = root / "malicious.zip"
        with zipfile.ZipFile(malicious, "w") as bad:
            bad.writestr("../escape.txt", "bad")
        try:
            _safe_extract(malicious, root / "extract")
            raise AssertionError("zip-slip archive must fail")
        except ValueError:
            pass
        assert not (root / "escape.txt").exists()
    print("private model bundle lifecycle: PASS")


if __name__ == "__main__":
    main()
