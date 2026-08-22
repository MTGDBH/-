"""stdin/stdout service wrapper used by the Node API."""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from population.predict_population import predict_numeric, predict_risk


def main():
    try:
        request = json.loads(sys.stdin.buffer.read().decode("utf-8") or "{}")
        task = str(request.get("task") or "")
        target = str(request.get("target") or "")
        tier = str(request.get("tier") or "noninvasive")
        payload = request.get("features") or {}
        models_dir = ROOT / "models" / "population"
        suffix = f"numeric_{target}" if task == "numeric" else f"risk_{target}_{tier}"
        metadata = json.loads((models_dir / f"{suffix}.metadata.json").read_text(encoding="utf-8"))
        if task == "numeric":
            output = predict_numeric(target, metadata, payload, models_dir)
        elif task == "risk":
            output = predict_risk(target, tier, metadata, payload, models_dir)
        else:
            raise ValueError("task must be numeric or risk")
    except Exception as exc:
        output = {"success": False, "error": f"population prediction unavailable: {type(exc).__name__}"}
    sys.stdout.buffer.write((json.dumps(output, ensure_ascii=False) + "\n").encode("utf-8"))


if __name__ == "__main__":
    main()
