# -*- coding: utf-8 -*-
"""Create a curated, non-secret national-award submission bundle.

The bundle is assembled only from the frozen artifact manifest. It deliberately
does not include .env files, raw personal datasets, node_modules, caches, or
temporary previews. The zip itself is a convenience handoff; each source file
remains verifiable by submission-artifact-manifest-20260821.json.
"""
from __future__ import annotations

import json
import zipfile
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "reports" / "submission-artifact-manifest-20260821.json"
OUT = ROOT / "deliverables" / "national_award" / "national_award_submission_bundle.zip"


def main() -> None:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    artifacts = [row["path"] for row in manifest.get("artifacts", [])]
    missing = [rel for rel in artifacts if not (ROOT / rel).exists()]
    if missing:
        raise SystemExit(f"manifest artifacts missing: {missing}")
    bundle_manifest = {
        "schema_version": "submission-bundle.v1",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source_manifest": "reports/submission-artifact-manifest-20260821.json",
        "artifact_count": len(artifacts),
        "excluded": [".env and API keys", "raw personal datasets", "node_modules", "caches", "temporary previews"],
        "paths": artifacts,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(OUT, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for rel in artifacts:
            archive.write(ROOT / rel, rel)
        archive.writestr("bundle_manifest.json", json.dumps(bundle_manifest, ensure_ascii=False, indent=2))
    print(json.dumps({"output": str(OUT), "artifacts": len(artifacts), "bytes": OUT.stat().st_size}, ensure_ascii=False))


if __name__ == "__main__":
    main()
