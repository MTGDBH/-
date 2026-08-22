"""stdin/stdout service wrapper used by the Node API."""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from population.predict_population import predict_numeric, predict_risk
from population.modeling import project_blood_pressure
from model_bundle import validate_bundle


def main():
    try:
        request = json.loads(sys.stdin.buffer.read().decode("utf-8") or "{}")
        task = str(request.get("task") or "")
        target = str(request.get("target") or "")
        tier = str(request.get("tier") or "noninvasive")
        payload = request.get("features") or {}
        models_dir = ROOT / "models" / "population"
        bundle_status = validate_bundle(ROOT / "models")
        if bundle_status["status"] != "ready":
            raise RuntimeError(bundle_status["reason_code"])
        bundle_version = bundle_status["bundle_version"]
        if task == "blood_pressure":
            outputs = []
            for component in ("systo", "diasto"):
                metadata = json.loads((models_dir / f"numeric_{component}.metadata.json").read_text(encoding="utf-8"))
                outputs.append(predict_numeric(component, metadata, payload, models_dir))
            systolic, diastolic = outputs
            if systolic.get("status") == "available" and diastolic.get("status") == "available":
                systolic_points, diastolic_points, changed = project_blood_pressure([systolic["point"]], [diastolic["point"]])
                systolic["point"] = round(float(systolic_points[0]), 2)
                diastolic["point"] = round(float(diastolic_points[0]), 2)
                output = {
                    "schema_version": "health-prediction.v1", "metric": "bp", "prediction_mode": "value",
                    "value_kind": "predicted", "display_label": "预测值", "status": "available",
                    "abstained": False, "reason_code": None, "horizon_days": 730,
                    "components": {"systolic": systolic, "diastolic": diastolic},
                    "joint_constraint": {"applied": True, "minimum_pulse_pressure": 5, "adjusted": bool(changed[0])},
                    "model_version": bundle_version,
                    "disclaimer": "CHARLS人群长期预测，不代表未来7天，也不是诊断",
                }
            else:
                reason = systolic.get("reason") or diastolic.get("reason") or "人群模型不可用"
                output = {
                    "schema_version": "health-prediction.v1", "metric": "bp", "prediction_mode": "value",
                    "value_kind": "predicted", "display_label": "预测值", "status": "insufficient_data",
                    "abstained": True, "reason_code": "FEATURES_INSUFFICIENT", "reason": reason,
                    "horizon_days": 730, "components": {"systolic": systolic, "diastolic": diastolic},
                    "model_version": bundle_version,
                }
            sys.stdout.buffer.write((json.dumps(output, ensure_ascii=False) + "\n").encode("utf-8"))
            return
        suffix = f"numeric_{target}" if task == "numeric" else f"risk_{target}_{tier}"
        metadata = json.loads((models_dir / f"{suffix}.metadata.json").read_text(encoding="utf-8"))
        if task == "numeric":
            output = predict_numeric(target, metadata, payload, models_dir)
        elif task == "risk":
            output = predict_risk(target, tier, metadata, payload, models_dir)
        else:
            raise ValueError("task must be numeric or risk")
        output["model_version"] = bundle_version
        output["reason_code"] = None if output.get("status") == "available" else "FEATURES_INSUFFICIENT"
    except Exception as exc:
        message = str(exc)
        reason_code = message if message.startswith("MODEL_BUNDLE_") else "MODEL_RUNTIME_ERROR"
        output = {"success": False, "status": "unavailable", "abstained": True, "reason_code": reason_code, "error": f"population prediction unavailable: {type(exc).__name__}"}
    sys.stdout.buffer.write((json.dumps(output, ensure_ascii=False) + "\n").encode("utf-8"))


if __name__ == "__main__":
    main()
