# -*- coding: utf-8 -*-
"""国家奖材料用风险模型扩展审计。

本脚本复现随机留出评估，并补充 Bootstrap 区间、校准指标、决策曲线与分层结果。
CHARLS 的当前派生表只有 Wave1 基线和 Wave2 结局，没有个体测量日期，因此脚本
明确记录 temporal_external_validation=unavailable，禁止把 ID 顺序冒充时间外部验证。
"""
from __future__ import annotations

import hashlib
import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.calibration import CalibratedClassifierCV
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import brier_score_loss, log_loss, roc_auc_score
from sklearn.model_selection import StratifiedKFold, train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from xgboost import XGBClassifier

ROOT = Path(__file__).resolve().parent
PROJECT = ROOT.parent.parent
DATA_DIR = ROOT / "datasets"
OUT_JSON = PROJECT / "ml" / "reports" / "national-award-risk-evaluation-20260821.json"
OUT_MD = PROJECT / "reports" / "national-award-risk-evaluation-20260821.md"


def git_revision() -> str | None:
    try:
        return subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=PROJECT, text=True).strip()
    except Exception:
        return None


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def make_models():
    logistic = Pipeline([
        ("imputer", SimpleImputer(strategy="median", add_indicator=True)),
        ("scale", StandardScaler()),
        ("model", LogisticRegression(max_iter=1200, class_weight="balanced", solver="liblinear")),
    ])
    xgb = XGBClassifier(
        objective="binary:logistic", eval_metric="logloss", n_estimators=300,
        learning_rate=0.04, max_depth=2, min_child_weight=3, subsample=0.8,
        colsample_bytree=0.8, tree_method="hist", random_state=42, n_jobs=2,
    )
    return {"logistic": logistic, "xgboost": Pipeline([
        ("imputer", SimpleImputer(strategy="median", add_indicator=True)),
        ("model", xgb),
    ])}


def safe_auc(y, p):
    return float(roc_auc_score(y, p)) if len(np.unique(y)) > 1 else None


def bootstrap_metrics(y, p, n_boot=200, seed=42):
    rng = np.random.default_rng(seed)
    rows = []
    y = np.asarray(y); p = np.asarray(p)
    for _ in range(n_boot):
        idx = rng.integers(0, len(y), len(y))
        auc = safe_auc(y[idx], p[idx])
        if auc is not None:
            rows.append({"roc_auc": auc, "brier": float(brier_score_loss(y[idx], p[idx])), "log_loss": float(log_loss(y[idx], np.clip(p[idx], 1e-6, 1 - 1e-6)))})
    out = {}
    for key in ("roc_auc", "brier", "log_loss"):
        values = np.array([r[key] for r in rows], dtype=float)
        out[key] = {"estimate": float(np.mean(values)), "ci95": [float(np.quantile(values, .025)), float(np.quantile(values, .975))], "n_bootstrap": int(len(values))}
    return out


def calibration(y, p, bins=10):
    edges = np.linspace(0, 1, bins + 1)
    rows = []
    for lo, hi in zip(edges[:-1], edges[1:]):
        mask = (p >= lo) & ((p < hi) if hi < 1 else (p <= hi))
        if mask.any():
            rows.append({"bin": f"{lo:.1f}-{hi:.1f}", "n": int(mask.sum()), "predicted": float(p[mask].mean()), "observed": float(y[mask].mean())})
    # 简单的总体校准截距/斜率诊断；小样本分箱不作因果解释。
    x = np.log(np.clip(p, 1e-5, 1 - 1e-5) / np.clip(1 - p, 1e-5, 1))
    try:
        slope, intercept = np.polyfit(x, y, 1)
        slope, intercept = float(slope), float(intercept)
    except Exception:
        slope = intercept = None
    return {"bins": rows, "slope": slope, "intercept": intercept}


def decision_curve(y, p, thresholds=(.01, .02, .03, .05, .1, .2, .3, .5)):
    y = np.asarray(y); p = np.asarray(p); n = len(y); prevalence = float(y.mean())
    rows = []
    for t in thresholds:
        pred = p >= t
        tp = float(np.sum(pred & (y == 1))); fp = float(np.sum(pred & (y == 0)))
        net = tp / n - fp / n * (t / (1 - t))
        treat_all = prevalence - (1 - prevalence) * (t / (1 - t))
        rows.append({"threshold": t, "model_net_benefit": net, "treat_all_net_benefit": treat_all, "treat_none_net_benefit": 0.0})
    return rows


def subgroup(df, y, p):
    masks = {
        "age_65_74": (df["age"] >= 65) & (df["age"] < 75),
        "age_75_plus": df["age"] >= 75,
        "female": df["gender"] == 0,
        "male": df["gender"] == 1,
        "missing_core_bp": df[["systo", "diasto"]].isna().any(axis=1),
    }
    rows = []
    for name, mask in masks.items():
        mask = mask.fillna(False).to_numpy()
        if int(mask.sum()) < 30:
            continue
        gy, gp = np.asarray(y)[mask], np.asarray(p)[mask]
        rows.append({"group": name, "n": int(mask.sum()), "positive": int(gy.sum()), "roc_auc": safe_auc(gy, gp), "brier": float(brier_score_loss(gy, gp))})
    return rows


def run_one(path: Path):
    df = pd.read_csv(path)
    features = [c for c in df.columns if c not in ("ID", "y")]
    X, y = df[features], df["y"].astype(int)
    X_train, X_test, y_train, y_test, idx_train, idx_test = train_test_split(
        X, y, df.index, test_size=.2, random_state=42, stratify=y
    )
    candidates = make_models(); scores = {}
    cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
    for name, model in candidates.items():
        aucs = []
        for tr, va in cv.split(X_train, y_train):
            m = make_models()[name]
            m.fit(X_train.iloc[tr], y_train.iloc[tr])
            aucs.append(safe_auc(y_train.iloc[va], m.predict_proba(X_train.iloc[va])[:, 1]))
        model.fit(X_train, y_train)
        scores[name] = {"cv_auc_mean": float(np.nanmean(aucs)), "cv_auc_std": float(np.nanstd(aucs)), "raw_test_auc": safe_auc(y_test, model.predict_proba(X_test)[:, 1])}
    selected = max(scores, key=lambda k: scores[k]["cv_auc_mean"])
    calibrated = CalibratedClassifierCV(make_models()[selected], method="sigmoid", cv=3, n_jobs=1)
    calibrated.fit(X_train, y_train)
    p = calibrated.predict_proba(X_test)[:, 1]
    test_df = df.loc[idx_test]
    return {
        "disease": path.stem.replace("_incidence_w1w2", ""),
        "dataset": {"path": path.as_posix(), "sha256": sha256(path), "n_total": int(len(df)), "positive": int(y.sum()), "positive_rate": float(y.mean())},
        "selection": {"candidates": scores, "selected": selected, "split": "stratified_random_80_20_seed42"},
        "test": {"n": int(len(y_test)), "positive": int(y_test.sum()), "roc_auc": safe_auc(y_test, p), "brier": float(brier_score_loss(y_test, p)), "bootstrap": bootstrap_metrics(y_test, p), "calibration": calibration(np.asarray(y_test), p), "decision_curve": decision_curve(np.asarray(y_test), p), "subgroups": subgroup(test_df, y_test, p)},
    }


def main():
    rows = [run_one(p) for p in sorted(DATA_DIR.glob("*_incidence_w1w2.csv"))]
    result = {
        "schema_version": "risk-evaluation.v2",
        "run_id": "risk-national-award-audit-20260821",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "code_revision": git_revision(),
        "data_class": "research",
        "models": rows,
        "temporal_external_validation": {"status": "unavailable", "temporal_design": "wave1_baseline_to_wave2_outcome", "individual_time_ordered_holdout": "unavailable", "reason": "当前 CHARLS 派生表只有 Wave1 基线和 Wave2 结局，没有个体测量日期/时间排序字段；不能用 ID 顺序冒充时间切分。", "required_next_step": "获得带测量日期的纵向队列或独立外部队列后，按时间前训后测重跑。"},
        "limitations": ["随机留出不等同于时间外部验证", "同一队列内分层不能替代不同地区/医院外部验证", "风险概率用于筛查和复测分层，不是诊断"],
    }
    OUT_JSON.parent.mkdir(parents=True, exist_ok=True); OUT_MD.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    lines = ["# 国家奖风险模型扩展审计（2026-08-21）", "", f"运行 ID：`{result['run_id']}`", "", "## 结果摘要", "", "| 疾病 | 选择模型 | 测试 AUC | Brier | Bootstrap AUC 95% CI |", "|---|---|---:|---:|---|"]
    for row in rows:
        t = row["test"]; ci = t["bootstrap"]["roc_auc"]["ci95"]
        lines.append(f"| {row['disease']} | {row['selection']['selected']} | {t['roc_auc']:.4f} | {t['brier']:.5f} | [{ci[0]:.4f}, {ci[1]:.4f}] |")
    lines += ["", "## 决策曲线", "", "决策曲线以净获益比较模型、全部干预和不干预；阈值仅作复测分层研究，不是临床处方阈值。结果与完整分层、校准分箱和 Bootstrap 明细保存在同名 JSON。", "", "## 不能宣称的部分", "", "当前数据没有个体日期，时间外部验证标记为 unavailable；不能把随机留出结果写成时间外验证，也不能替代医生审核或外部临床验证。"]
    OUT_MD.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(json.dumps({"run_id": result["run_id"], "diseases": len(rows), "output": str(OUT_JSON)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
