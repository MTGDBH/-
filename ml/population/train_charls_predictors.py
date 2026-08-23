"""Train leakage-controlled CHARLS population predictors.

Numerical targets use Wave1 predictors -> Wave2 outcomes. Laboratory risks use
Wave1 predictors -> Wave3 abnormal-status outcomes because biomarkers are only
available in those waves. This is population-level long-horizon modeling, not a
replacement for the per-person Curve V2 seven-day baseline.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd
from sklearn.metrics import mean_absolute_error
from sklearn.model_selection import train_test_split

ROOT = Path(__file__).resolve().parents[1]
PROJECT = ROOT.parent
sys.path.insert(0, str(ROOT))

from population.modeling import (
    available_backends,
    boosting_classifier,
    boosting_regressor,
    choose_threshold,
    classification_metrics,
    feature_completeness,
    linear_regressor,
    logistic_classifier,
    numeric_metrics,
    project_blood_pressure,
    resolve_backend,
    risk_levels,
    subgroup_labels,
)


NONINVASIVE_FEATURES = [
    "age", "gender", "edu", "systo", "diasto", "pulse", "bmi", "mwaist",
    "lgrip", "rgrip", "sleep", "smokev", "smoken", "drinkev", "drinkl",
    "exercise", "totmet", "srh", "cesd10", "total_cognition", "adlab_c",
    "iadl", "chronic", "diabe", "hearte", "stroke", "dyslipe", "lunge",
]

# Outcome cards use a smaller, explicitly home-collectable feature set so a user
# can realistically cross the abstention threshold from this application's form.
OUTCOME_FEATURES = [
    "age", "gender", "systo", "diasto", "pulse", "bmi", "mwaist", "lgrip", "rgrip",
    "sleep", "exercise", "srh", "cesd10", "total_cognition", "adlab_c", "iadl", "fall_down",
]

NUMERIC_TARGETS = {
    "systo": {"field": "systo", "label": "收缩压", "unit": "mmHg"},
    "diasto": {"field": "diasto", "label": "舒张压", "unit": "mmHg"},
    "hr": {"field": "pulse", "label": "心率", "unit": "bpm"},
    "weight": {"field": "mweight", "label": "体重", "unit": "kg"},
    "waist": {"field": "mwaist", "label": "腰围", "unit": "cm"},
    "grip": {"field": "grip", "label": "握力", "unit": "kg", "max_interval_fraction": 0.60},
}

LAB_TARGETS = {
    "glucose": {"field": "bl_glu", "label": "血糖异常风险", "unit": "mg/dL", "normal": [72.0, 126.0]},
    "hba1c": {"field": "bl_hbalc", "label": "糖化血红蛋白异常风险", "unit": "%", "normal": [4.0, 6.5]},
    "cholesterol": {"field": "bl_cho", "label": "总胆固醇异常风险", "unit": "mg/dL", "normal": [119.9, 220.4]},
    "uricacid": {"field": "bl_ua", "label": "尿酸异常风险", "unit": "mg/dL", "normal": [2.52, 7.06]},
    "creatinine": {"field": "bl_crea", "label": "肌酐异常风险", "unit": "mg/dL", "normal": [0.509, 1.244]},
}

# 家庭场景可以通过问卷/自评补充的长期结局。这里预测下一波次的风险状态，
# 不把问卷分数包装成诊断，也不输出伪精确的临床数值。
OUTCOME_TARGETS = {
    "adl_limitation": {
        "field": "adlab_c", "label": "日常活动受限风险", "positive_rule": "value > 0",
        "threshold": 0.0,
    },
    "depressive_symptoms": {
        "field": "cesd10", "label": "情绪困扰风险", "positive_rule": "value >= 10",
        "threshold": 10.0,
    },
    "fall": {
        "field": "fall_down", "label": "跌倒风险", "positive_rule": "value >= 1",
        "threshold": 1.0,
    },
}

PHYSIO_BOUNDS = {
    "age": (45, 105), "systo": (60, 260), "diasto": (40, 150), "pulse": (40, 150),
    "bmi": (10, 60), "mweight": (20, 200), "mwaist": (40, 160), "lgrip": (0, 100),
    "rgrip": (0, 100), "sleep": (0, 16), "bl_glu": (20, 600), "bl_hbalc": (3, 20),
    "bl_cho": (20, 500), "bl_ua": (0.5, 20), "bl_crea": (0.2, 20),
}


def load_charls(path: Path) -> pd.DataFrame:
    raw_fields = sorted(set(
        NONINVASIVE_FEATURES
        + [spec["field"] for spec in NUMERIC_TARGETS.values()]
        + [spec["field"] for spec in LAB_TARGETS.values()]
        + [spec["field"] for spec in OUTCOME_TARGETS.values()]
        + ["lgrip", "rgrip"]
    ))
    columns = ["ID", "wave", "province"] + raw_fields
    frame = pd.read_csv(path, usecols=lambda col: col in columns, low_memory=False)
    for column in frame.columns:
        if column not in {"ID", "province"}:
            frame[column] = pd.to_numeric(frame[column], errors="coerce")
    for column in raw_fields:
        if column in frame:
            frame.loc[frame[column] < 0, column] = np.nan
    for column, (lower, upper) in PHYSIO_BOUNDS.items():
        if column in frame:
            frame.loc[~frame[column].between(lower, upper), column] = np.nan
    frame["grip"] = frame[["lgrip", "rgrip"]].max(axis=1, skipna=True)
    return frame


def wave_pair(frame: pd.DataFrame, outcome_wave: int, outcome_fields: list[str]) -> pd.DataFrame:
    baseline_fields = sorted(set(
        NONINVASIVE_FEATURES
        + [spec["field"] for spec in NUMERIC_TARGETS.values()]
        + [spec["field"] for spec in LAB_TARGETS.values()]
        + [spec["field"] for spec in OUTCOME_TARGETS.values()]
        + ["grip"]
    ))
    baseline = frame.loc[frame.wave == 1, ["ID", "province"] + baseline_fields].drop_duplicates("ID")
    baseline = baseline.rename(columns={column: f"{column}_x" for column in baseline_fields})
    outcomes = frame.loc[frame.wave == outcome_wave, ["ID"] + outcome_fields].drop_duplicates("ID")
    outcomes = outcomes.rename(columns={column: f"{column}_y" for column in outcome_fields})
    return baseline.merge(outcomes, on="ID", how="inner")


def make_participant_split(baseline: pd.DataFrame, seed: int) -> dict[str, set[str]]:
    region_counts = baseline.groupby("province", dropna=True)["ID"].nunique().sort_values(ascending=False)
    eligible = region_counts[region_counts >= max(200, int(baseline.ID.nunique() * 0.02))]
    external_region = str(eligible.index[0]) if len(eligible) else None
    external_mask = baseline.province.astype(str) == external_region if external_region else np.zeros(len(baseline), dtype=bool)
    external_ids = set(baseline.loc[external_mask, "ID"].astype(str))
    development_ids = np.asarray(sorted(set(baseline.ID.astype(str)) - external_ids))
    train_ids, remainder = train_test_split(development_ids, test_size=0.30, random_state=seed)
    validation_ids, test_ids = train_test_split(remainder, test_size=0.50, random_state=seed)
    return {
        "train": set(train_ids), "validation": set(validation_ids), "test": set(test_ids),
        "external": external_ids, "external_region": external_region,
    }


def split_mask(frame: pd.DataFrame, identifiers: set[str]) -> np.ndarray:
    return frame.ID.astype(str).isin(identifiers).to_numpy()


def predict_numeric(name: str, models: dict[str, Any], frame: pd.DataFrame, target_x: str, fallback: float) -> np.ndarray:
    if name == "last_value":
        return pd.to_numeric(frame[target_x], errors="coerce").fillna(fallback).to_numpy(dtype=float)
    return np.asarray(models[name].predict(frame[models["features"]]), dtype=float)


def subgroup_numeric(frame, y, pred, lower, upper, accepted, features, scale):
    completeness = feature_completeness(frame, features)
    output = {}
    for dimension, labels in subgroup_labels(frame, completeness).items():
        output[dimension] = {}
        for label in sorted(set(labels.tolist())):
            mask = labels == label
            if int(mask.sum()) < 20:
                continue
            output[dimension][str(label)] = numeric_metrics(
                y[mask], pred[mask], scale=scale, lower=lower[mask], upper=upper[mask], accepted=accepted[mask],
            )
    return output


def subgroup_classification(frame, y, probability, accepted, features, threshold):
    completeness = feature_completeness(frame, features)
    output = {}
    for dimension, labels in subgroup_labels(frame, completeness).items():
        output[dimension] = {}
        for label in sorted(set(labels.tolist())):
            mask = (labels == label) & accepted
            if int(mask.sum()) < 20 or len(np.unique(y[mask])) < 2:
                continue
            output[dimension][str(label)] = classification_metrics(y[mask], probability[mask], threshold)
    return output


def train_numeric_target(target, spec, pair, splits, backend, models_dir, seed):
    field = spec["field"]
    outcome = f"{field}_y"
    target_x = f"{field}_x"
    features = [f"{name}_x" for name in NONINVASIVE_FEATURES]
    data = pair[pair[outcome].notna()].copy()
    masks = {name: split_mask(data, ids) for name, ids in splits.items() if isinstance(ids, set)}
    train, validation, test, external = (data.loc[masks[name]].copy() for name in ("train", "validation", "test", "external"))
    if min(len(train), len(validation), len(test)) == 0:
        raise RuntimeError(f"empty split for {target}")
    fallback = float(train[outcome].median())
    models = {"features": features}
    models["linear"] = linear_regressor().fit(train[features], train[outcome])
    models["boosting"] = boosting_regressor(backend, seed).fit(train[features], train[outcome])
    val_y = validation[outcome].to_numpy(dtype=float)
    candidates = {}
    for name in ("last_value", "linear", "boosting"):
        pred = predict_numeric(name, models, validation, target_x, fallback)
        candidates[name] = {"mae": float(mean_absolute_error(val_y, pred)), "predicted": pred}
    simple_name = min(("last_value", "linear"), key=lambda name: candidates[name]["mae"])
    complex_enabled = candidates["boosting"]["mae"] <= candidates[simple_name]["mae"] * 0.98
    selected = "boosting" if complex_enabled else simple_name
    residual = np.abs(val_y - candidates[selected]["predicted"])
    conformal_q80 = float(np.quantile(residual, 0.80))
    scale = max(candidates["last_value"]["mae"], 1e-9)

    def evaluate(part: pd.DataFrame):
        if part.empty:
            return None, None
        y = part[outcome].to_numpy(dtype=float)
        pred = predict_numeric(selected, models, part, target_x, fallback)
        completeness = feature_completeness(part, features)
        max_width = max(abs(float(train[outcome].median())) * float(spec.get("max_interval_fraction", 0.40)), 1.0)
        accepted = (completeness >= 0.50) & (2.0 * conformal_q80 <= max_width)
        lower, upper = pred - conformal_q80, pred + conformal_q80
        result = numeric_metrics(y, pred, scale=scale, lower=lower, upper=upper, accepted=accepted)
        result["subgroups"] = subgroup_numeric(part, y, pred, lower, upper, accepted, features, scale)
        return result, {"frame": part, "actual": y, "predicted": pred, "lower": lower, "upper": upper, "accepted": accepted}

    test_metrics, runtime = evaluate(test)
    external_metrics, _ = evaluate(external)
    validation_report = {
        name: {"mae": round(values["mae"], 6), "mase_vs_last": round(values["mae"] / scale, 6)}
        for name, values in candidates.items()
    }
    artifact = None
    if selected in {"linear", "boosting"}:
        artifact = models_dir / f"numeric_{target}.joblib"
        joblib.dump(models[selected], artifact)
    metadata = {
        "task": "numeric_forecast", "target": target, "source_field": field,
        "outcome": f"CHARLS Wave2 {field}", "features": features, "backend": backend,
        "selected_model": selected, "complex_model_enabled": complex_enabled,
        "enablement_rule": "boosting validation MAE must improve best simple baseline by at least 2%",
        "conformal_q80": round(conformal_q80, 6), "minimum_completeness": 0.50,
        "artifact": str(artifact) if artifact else None,
    }
    (models_dir / f"numeric_{target}.metadata.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
    return {
        **metadata, "n": int(len(data)), "split_n": {name: int(mask.sum()) for name, mask in masks.items()},
        "validation_candidates": validation_report, "test": test_metrics, "external_region": splits["external_region"],
        "external": external_metrics,
    }, {**(runtime or {}), "selected": selected, "models": models, "fallback": fallback, "target_x": target_x, "features": features}


def train_lab_target(target, spec, pair, splits, backend, models_dir, seed, tier):
    field = spec["field"]
    outcome = f"{field}_y"
    features = [f"{name}_x" for name in NONINVASIVE_FEATURES]
    if tier == "micro_anchor":
        features.append(f"{field}_x")
    data = pair[pair[outcome].notna()].copy()
    low, high = spec["normal"]
    data["target_abnormal"] = ((data[outcome] < low) | (data[outcome] > high)).astype(int)
    masks = {name: split_mask(data, ids) for name, ids in splits.items() if isinstance(ids, set)}
    train, validation, test, external = (data.loc[masks[name]].copy() for name in ("train", "validation", "test", "external"))
    y_train = train.target_abnormal.to_numpy(dtype=int)
    if len(np.unique(y_train)) < 2:
        raise RuntimeError(f"single-class training target for {target}/{tier}")
    logistic = logistic_classifier().fit(train[features], y_train)
    boosting = boosting_classifier(backend, seed).fit(train[features], y_train)
    prevalence = float(np.mean(y_train))
    y_val = validation.target_abnormal.to_numpy(dtype=int)
    val_probability = {
        "prevalence": np.full(len(validation), prevalence),
        "logistic": logistic.predict_proba(validation[features])[:, 1],
        "boosting": boosting.predict_proba(validation[features])[:, 1],
    }
    val_metrics = {name: classification_metrics(y_val, probability, 0.5) for name, probability in val_probability.items()}
    complex_enabled = (
        (val_metrics["boosting"]["pr_auc"] or 0) >= (val_metrics["logistic"]["pr_auc"] or 0) + 0.01
        and val_metrics["boosting"]["brier"] <= val_metrics["logistic"]["brier"] * 1.05
    )
    selected = "boosting" if complex_enabled else "logistic"
    selected_model = boosting if selected == "boosting" else logistic
    threshold = choose_threshold(y_val, val_probability[selected])

    def evaluate(part: pd.DataFrame):
        if part.empty:
            return None
        y = part.target_abnormal.to_numpy(dtype=int)
        probability = selected_model.predict_proba(part[features])[:, 1]
        completeness = feature_completeness(part, features)
        accepted = completeness >= 0.50
        result = classification_metrics(y[accepted], probability[accepted], threshold) if accepted.any() else {"n": 0}
        result["total_n"] = int(len(part))
        result["refusal_rate"] = round(float(1.0 - np.mean(accepted)), 6)
        result["risk_level_counts"] = {str(k): int(v) for k, v in pd.Series(risk_levels(probability[accepted], threshold)).value_counts().items()}
        result["subgroups"] = subgroup_classification(part, y, probability, accepted, features, threshold)
        return result

    artifact = models_dir / f"risk_{target}_{tier}.joblib"
    joblib.dump(selected_model, artifact)
    metadata = {
        "task": "abnormal_risk", "target": target, "tier": tier, "source_field": field,
        "outcome": f"CHARLS Wave3 {field} outside [{low}, {high}] {spec['unit']}",
        "features": features, "backend": backend, "selected_model": selected,
        "complex_model_enabled": complex_enabled,
        "enablement_rule": "boosting validation PR-AUC +0.01 and Brier no worse than 5% versus logistic",
        "threshold": round(threshold, 6), "minimum_completeness": 0.50,
        "artifact": str(artifact),
    }
    (models_dir / f"risk_{target}_{tier}.metadata.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
    return {
        **metadata, "n": int(len(data)), "positive_rate": round(float(data.target_abnormal.mean()), 6),
        "split_n": {name: int(mask.sum()) for name, mask in masks.items()},
        "validation_candidates": val_metrics, "test": evaluate(test),
        "external_region": splits["external_region"], "external": evaluate(external),
    }


def train_outcome_target(target, spec, pair, splits, backend, models_dir, seed):
    """Train a Wave1 -> Wave2 household-assessment risk model."""
    field = spec["field"]
    outcome = f"{field}_y"
    features = [f"{name}_x" for name in OUTCOME_FEATURES]
    data = pair[pair[outcome].notna()].copy()
    threshold_value = float(spec["threshold"])
    if spec["positive_rule"] == "value > 0":
        data["target_abnormal"] = (data[outcome] > threshold_value).astype(int)
    else:
        data["target_abnormal"] = (data[outcome] >= threshold_value).astype(int)
    masks = {name: split_mask(data, ids) for name, ids in splits.items() if isinstance(ids, set)}
    train, validation, test, external = (data.loc[masks[name]].copy() for name in ("train", "validation", "test", "external"))
    y_train = train.target_abnormal.to_numpy(dtype=int)
    if min(len(train), len(validation), len(test)) == 0 or len(np.unique(y_train)) < 2:
        raise RuntimeError(f"invalid split for outcome {target}")

    logistic = logistic_classifier().fit(train[features], y_train)
    boosting = boosting_classifier(backend, seed).fit(train[features], y_train)
    prevalence = float(np.mean(y_train))
    y_val = validation.target_abnormal.to_numpy(dtype=int)
    val_probability = {
        "prevalence": np.full(len(validation), prevalence),
        "logistic": logistic.predict_proba(validation[features])[:, 1],
        "boosting": boosting.predict_proba(validation[features])[:, 1],
    }
    val_metrics = {name: classification_metrics(y_val, probability, 0.5) for name, probability in val_probability.items()}
    complex_enabled = (
        (val_metrics["boosting"]["pr_auc"] or 0) >= (val_metrics["logistic"]["pr_auc"] or 0) + 0.01
        and val_metrics["boosting"]["brier"] <= val_metrics["logistic"]["brier"] * 1.05
    )
    selected = "boosting" if complex_enabled else "logistic"
    selected_model = boosting if selected == "boosting" else logistic
    threshold = choose_threshold(y_val, val_probability[selected])

    def evaluate(part: pd.DataFrame):
        if part.empty:
            return None
        y = part.target_abnormal.to_numpy(dtype=int)
        probability = selected_model.predict_proba(part[features])[:, 1]
        completeness = feature_completeness(part, features)
        accepted = completeness >= 0.50
        result = classification_metrics(y[accepted], probability[accepted], threshold) if accepted.any() else {"n": 0}
        result["total_n"] = int(len(part))
        result["refusal_rate"] = round(float(1.0 - np.mean(accepted)), 6)
        result["subgroups"] = subgroup_classification(part, y, probability, accepted, features, threshold)
        return result

    artifact = models_dir / f"risk_{target}_noninvasive.joblib"
    joblib.dump(selected_model, artifact)
    metadata = {
        "task": "outcome_risk", "target": target, "tier": "noninvasive", "source_field": field,
        "label": spec["label"], "outcome": f"CHARLS Wave2 {field}: {spec['positive_rule']}",
        "features": features, "backend": backend, "selected_model": selected,
        "complex_model_enabled": complex_enabled,
        "enablement_rule": "boosting validation PR-AUC +0.01 and Brier no worse than 5% versus logistic",
        "threshold": round(threshold, 6), "minimum_completeness": 0.50,
        "horizon_days": 730, "population_horizon": "Wave1_to_Wave2",
        "target_kind": "future_status_risk", "artifact": str(artifact),
    }
    (models_dir / f"risk_{target}_noninvasive.metadata.json").write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return {
        **metadata, "n": int(len(data)), "positive_rate": round(float(data.target_abnormal.mean()), 6),
        "split_n": {name: int(mask.sum()) for name, mask in masks.items()},
        "validation_candidates": val_metrics, "test": evaluate(test),
        "external_region": splits["external_region"], "external": evaluate(external),
    }


def bp_joint_audit(runtime: dict[str, dict[str, Any]]) -> dict[str, Any]:
    systolic = runtime["systo"]
    diastolic = runtime["diasto"]
    s_frame = systolic["frame"].set_index("ID")
    d_frame = diastolic["frame"].set_index("ID")
    common = s_frame.index.intersection(d_frame.index)
    if len(common) == 0:
        return {"n": 0}
    s_index = {value: index for index, value in enumerate(systolic["frame"].ID)}
    d_index = {value: index for index, value in enumerate(diastolic["frame"].ID)}
    s_pred = np.asarray([systolic["predicted"][s_index[value]] for value in common])
    d_pred = np.asarray([diastolic["predicted"][d_index[value]] for value in common])
    s_actual = s_frame.loc[common, "systo_y"].to_numpy(dtype=float)
    d_actual = d_frame.loc[common, "diasto_y"].to_numpy(dtype=float)
    projected_s, projected_d, violations = project_blood_pressure(s_pred, d_pred)
    return {
        "n": int(len(common)), "minimum_pulse_pressure": 5.0,
        "violations_before": int(violations.sum()),
        "violations_after": int(np.sum(projected_s - projected_d < 5.0 - 1e-9)),
        "adjusted_points": int(violations.sum()),
        "mae_before": {
            "systolic": round(float(mean_absolute_error(s_actual, s_pred)), 6),
            "diastolic": round(float(mean_absolute_error(d_actual, d_pred)), 6),
        },
        "mae_after": {
            "systolic": round(float(mean_absolute_error(s_actual, projected_s)), 6),
            "diastolic": round(float(mean_absolute_error(d_actual, projected_d)), 6),
        },
    }


def render_markdown(report: dict[str, Any]) -> str:
    lines = [
        "# CHARLS 多指标预测与化验风险评估", "",
        f"运行 ID：`{report['run_id']}`",
        f"树模型后端：`{report['backend']}`（可用：{', '.join(report['available_backends'])}）",
        f"地理外部留出：`{report['split']['external_region']}`", "",
        "## 数值预测（Wave1 → Wave2）", "",
        "| 指标 | 选择模型 | 复杂模型启用 | 测试MAE | MASE | 80%覆盖率 | 拒绝率 |", "|---|---|---:|---:|---:|---:|---:|",
    ]
    for target, item in report["numeric_targets"].items():
        test = item["test"] or {}
        lines.append(f"| {target} | {item['selected_model']} | {item['complex_model_enabled']} | {test.get('mae')} | {test.get('mase')} | {test.get('interval_coverage')} | {test.get('refusal_rate')} |")
    lines += ["", "## 化验异常风险（Wave1 → Wave3）", "", "| 指标/输入层 | 选择模型 | 复杂模型启用 | AUROC | PR-AUC | Brier | 灵敏度 | 特异度 |", "|---|---|---:|---:|---:|---:|---:|---:|"]
    for target, tiers in report["lab_risks"].items():
        for tier, item in tiers.items():
            test = item["test"] or {}
            lines.append(f"| {target}/{tier} | {item['selected_model']} | {item['complex_model_enabled']} | {test.get('auroc')} | {test.get('pr_auc')} | {test.get('brier')} | {test.get('sensitivity')} | {test.get('specificity')} |")
    lines += ["", "## 家庭问卷长期风险（Wave1 → Wave2）", "", "| 目标 | 选择模型 | AUROC | PR-AUC | Brier | 拒绝率 |", "|---|---|---:|---:|---:|---:|"]
    for target, item in report["outcome_risks"].items():
        test = item["test"] or {}
        lines.append(f"| {target} | {item['selected_model']} | {test.get('auroc')} | {test.get('pr_auc')} | {test.get('brier')} | {test.get('refusal_rate')} |")
    lines += [
        "", "## 边界", "",
        "- CHARLS 是波次级人群数据，不是连续设备数据；结果不能解释为未来7天个体预测。",
        "- 外部地区留出仍来自同一研究项目，只是地理迁移审计，不是独立机构临床外部验证。",
        "- 化验模块输出异常风险分层，不输出伪精确化验数值；真实使用以规范检测为准。",
        "- 每个复杂模型只有在预先规定的验证集门槛上优于简单基线才启用。", "",
    ]
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", default=r"D:\大创数据2\CHARLS.csv")
    parser.add_argument("--backend", default="auto", choices=["auto", "catboost", "lightgbm", "xgboost"])
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--out", default=str(ROOT / "reports" / "charls-multitarget-evaluation.json"))
    parser.add_argument("--models-dir", default=str(ROOT / "models" / "population"))
    args = parser.parse_args()

    source = Path(args.source)
    if not source.exists():
        raise SystemExit(f"source not found: {source}")
    backend = resolve_backend(args.backend)
    models_dir = Path(args.models_dir)
    models_dir.mkdir(parents=True, exist_ok=True)
    frame = load_charls(source)
    baseline = frame.loc[frame.wave == 1, ["ID", "province"]].drop_duplicates("ID")
    splits = make_participant_split(baseline, args.seed)
    numeric_pair = wave_pair(frame, 2, sorted({spec["field"] for spec in NUMERIC_TARGETS.values()}))
    lab_pair = wave_pair(frame, 3, sorted({spec["field"] for spec in LAB_TARGETS.values()}))
    outcome_pair = wave_pair(frame, 2, sorted({spec["field"] for spec in OUTCOME_TARGETS.values()}))

    numeric_results, numeric_runtime = {}, {}
    for target, spec in NUMERIC_TARGETS.items():
        result, runtime = train_numeric_target(target, spec, numeric_pair, splits, backend, models_dir, args.seed)
        numeric_results[target] = result
        numeric_runtime[target] = runtime
        print(f"numeric {target}: {result['selected_model']} MAE={result['test'].get('mae')}", flush=True)

    lab_results = {}
    for target, spec in LAB_TARGETS.items():
        lab_results[target] = {}
        for tier in ("noninvasive", "micro_anchor"):
            result = train_lab_target(target, spec, lab_pair, splits, backend, models_dir, args.seed, tier)
            lab_results[target][tier] = result
            print(f"risk {target}/{tier}: {result['selected_model']} AUROC={result['test'].get('auroc')}", flush=True)

    outcome_results = {}
    for target, spec in OUTCOME_TARGETS.items():
        result = train_outcome_target(target, spec, outcome_pair, splits, backend, models_dir, args.seed)
        outcome_results[target] = result
        print(f"outcome {target}: {result['selected_model']} AUROC={result['test'].get('auroc')}", flush=True)

    report = {
        "schema_version": "charls-multitarget-evaluation.v1",
        "run_id": f"charls-multitarget-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "source": str(source.resolve()), "data_rows": int(len(frame)), "participants": int(frame.ID.nunique()),
        "backend": backend, "backend_preference": list(("catboost", "lightgbm", "xgboost")),
        "available_backends": available_backends(),
        "split": {
            "method": "participant_disjoint_70_15_15_plus_geographic_holdout",
            "train_participants": len(splits["train"]), "validation_participants": len(splits["validation"]),
            "test_participants": len(splits["test"]), "external_participants": len(splits["external"]),
            "external_region": splits["external_region"], "participant_overlap": 0,
        },
        "numeric_targets": numeric_results,
        "blood_pressure_joint_constraint": bp_joint_audit(numeric_runtime),
        "lab_risks": lab_results,
        "outcome_risks": outcome_results,
        "limitations": [
            "CHARLS波次数据不能证明未来7天个体预测性能",
            "地理留出来自同一研究项目，不等于独立机构外部验证",
            "化验模型只输出异常风险，不替代化验",
            "设备分层在CHARLS中不可用，统一标记charls_survey_no_device",
        ],
    }
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    markdown = PROJECT / "reports" / "charls-multitarget-evaluation.md"
    markdown.write_text(render_markdown(report), encoding="utf-8")
    print(json.dumps({"run_id": report["run_id"], "report": str(out), "markdown": str(markdown)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
