# -*- coding: utf-8 -*-
"""Temporal Wave4->Wave5 CHARLS risk audit.

The raw CHARLS file contains repeated participant IDs and wave=1..5.  This
script builds incident outcomes from adjacent waves, trains only on earlier
transitions (1->2, 2->3, 3->4), and evaluates the latest transition (4->5).
It is a research audit, not a clinical validation or diagnosis.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, brier_score_loss, roc_auc_score
from sklearn.model_selection import GroupKFold
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from xgboost import XGBClassifier


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_INPUT = Path(r"D:\大创数据2\CHARLS.csv")
OUT_JSON = ROOT / "reports" / "national-award-risk-temporal-evaluation-20260821.json"
OUT_MD = ROOT.parent / "reports" / "national-award-risk-temporal-evaluation-20260821.md"
OUT_JSON_DISJOINT = ROOT / "reports" / "national-award-risk-temporal-disjoint-evaluation-20260821.json"
OUT_MD_DISJOINT = ROOT.parent / "reports" / "national-award-risk-temporal-disjoint-evaluation-20260821.md"
DISEASES = {"hypertension": "hibpe", "diabetes": "diabe", "heart_disease": "hearte", "stroke": "stroke"}
FEATURES = ["age", "gender", "bmi", "systo", "diasto", "pulse", "bl_glu", "bl_hbalc", "smoken", "drinkev", "exercise", "sleep", "rural", "edu"]
USECOLS = ["ID", "wave", *DISEASES.values(), *FEATURES]


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def safe_auc(y, p):
    try:
        return float(roc_auc_score(y, p))
    except ValueError:
        return None


def safe_pr(y, p):
    try:
        return float(average_precision_score(y, p))
    except ValueError:
        return None


def bootstrap_auc(y, p, n=200, seed=42):
    rng = np.random.default_rng(seed)
    vals = []
    y = np.asarray(y); p = np.asarray(p)
    for _ in range(n):
        idx = rng.integers(0, len(y), len(y))
        if len(np.unique(y[idx])) < 2:
            continue
        vals.append(float(roc_auc_score(y[idx], p[idx])))
    if not vals:
        return {"n": 0, "ci95": [None, None]}
    return {"n": len(vals), "ci95": [float(np.percentile(vals, 2.5)), float(np.percentile(vals, 97.5))]}


def calibration(y, p, bins=(0.0, 0.05, 0.1, 0.2, 0.3, 0.5, 1.0)):
    rows = []
    y = np.asarray(y); p = np.asarray(p)
    for lo, hi in zip(bins[:-1], bins[1:]):
        mask = (p >= lo) & ((p < hi) if hi < 1 else (p <= hi))
        if not mask.any():
            continue
        rows.append({"bin": f"{lo:.2f}-{hi:.2f}", "n": int(mask.sum()), "predicted": float(p[mask].mean()), "observed": float(y[mask].mean())})
    # A simple logit calibration slope/intercept is reported only when both classes exist.
    slope = intercept = None
    if len(np.unique(y)) == 2:
        z = np.log(np.clip(p, 1e-6, 1 - 1e-6) / np.clip(1 - p, 1e-6, 1))
        cal = LogisticRegression(C=1e6, solver="lbfgs", max_iter=1000).fit(z.reshape(-1, 1), y)
        slope = float(cal.coef_[0][0]); intercept = float(cal.intercept_[0])
    return {"bins": rows, "slope": slope, "intercept": intercept}


def decision_curve(y, p):
    y = np.asarray(y); p = np.asarray(p); prevalence = float(y.mean())
    rows = []
    for threshold in (0.01, 0.02, 0.03, 0.05, 0.1, 0.2, 0.3, 0.5):
        predicted = p >= threshold
        tp = float(np.sum(predicted & (y == 1))); fp = float(np.sum(predicted & (y == 0)))
        n = max(1, len(y)); odds = threshold / max(1e-9, 1 - threshold)
        rows.append({"threshold": threshold, "model_net_benefit": tp / n - fp / n * odds, "treat_all_net_benefit": prevalence - (1 - prevalence) * odds, "treat_none_net_benefit": 0.0})
    return rows


def transition_rows(df: pd.DataFrame, disease: str, from_wave: int, to_wave: int) -> pd.DataFrame:
    col = DISEASES[disease]
    base = df[df.wave == from_wave][["ID", col, *FEATURES]].rename(columns={col: "baseline_condition"})
    future = df[df.wave == to_wave][["ID", col]].rename(columns={col: "future_condition"})
    merged = base.merge(future, on="ID", how="inner")
    merged = merged.dropna(subset=["baseline_condition", "future_condition"])
    # Incident outcome: condition absent at baseline, then either remains absent or appears.
    merged = merged[merged.baseline_condition == 0].copy()
    merged["y"] = (merged.future_condition == 1).astype(int)
    merged["from_wave"] = from_wave; merged["to_wave"] = to_wave
    return merged


def make_models():
    logistic = Pipeline([("imputer", SimpleImputer(strategy="median", add_indicator=True)), ("scale", StandardScaler()), ("model", LogisticRegression(max_iter=1200, class_weight="balanced", solver="liblinear"))])
    xgb = Pipeline([("imputer", SimpleImputer(strategy="median", add_indicator=True)), ("model", XGBClassifier(objective="binary:logistic", eval_metric="logloss", n_estimators=300, learning_rate=0.04, max_depth=2, min_child_weight=3, subsample=0.8, colsample_bytree=0.8, tree_method="hist", random_state=42, n_jobs=2))])
    return {"logistic": logistic, "xgboost": xgb}


def evaluate_one(df: pd.DataFrame, disease: str, participant_disjoint: bool = False) -> dict:
    train_parts = [transition_rows(df, disease, w, w + 1) for w in (1, 2, 3)]
    test = transition_rows(df, disease, 4, 5)
    train = pd.concat(train_parts, ignore_index=True)
    test_ids = set(test.ID.astype(str))
    if participant_disjoint:
        train = train[~train.ID.astype(str).isin(test_ids)].copy()
    X_train, y_train, groups = train[FEATURES], train.y.astype(int), train.ID
    X_test, y_test = test[FEATURES], test.y.astype(int)
    candidates = make_models(); scores = {}
    n_splits = min(5, max(2, groups.nunique()))
    cv = GroupKFold(n_splits=n_splits)
    for name, model in candidates.items():
        aucs = []; prs = []
        for train_idx, valid_idx in cv.split(X_train, y_train, groups):
            model.fit(X_train.iloc[train_idx], y_train.iloc[train_idx])
            p = model.predict_proba(X_train.iloc[valid_idx])[:, 1]
            aucs.append(safe_auc(y_train.iloc[valid_idx], p)); prs.append(safe_pr(y_train.iloc[valid_idx], p))
        scores[name] = {"group_cv_auc": float(np.nanmean(aucs)), "group_cv_pr_auc": float(np.nanmean(prs))}
    selected = max(scores, key=lambda name: (scores[name]["group_cv_pr_auc"], scores[name]["group_cv_auc"]))
    model = candidates[selected].fit(X_train, y_train)
    p = model.predict_proba(X_test)[:, 1]
    train_ids = set(train.ID.astype(str))
    return {
        "disease": disease,
        "participant_disjoint": participant_disjoint,
        "selected_model": selected,
        "candidate_group_cv": scores,
        "train_transitions": {"from_to": ["1->2", "2->3", "3->4"], "n": int(len(train)), "positive": int(y_train.sum()), "participants": int(train.ID.nunique())},
        "test_transition": {"from_to": "4->5", "n": int(len(test)), "positive": int(y_test.sum()), "participants": int(test.ID.nunique()), "participants_overlap_with_train": int(len(train_ids & test_ids))},
        "test_metrics": {"roc_auc": safe_auc(y_test, p), "pr_auc": safe_pr(y_test, p), "brier": float(brier_score_loss(y_test, p)), "bootstrap_auc": bootstrap_auc(y_test, p), "calibration": calibration(y_test, p), "decision_curve": decision_curve(y_test, p)},
        "features": FEATURES,
    }


def main() -> None:
    parser = argparse.ArgumentParser(); parser.add_argument("--input", default=str(DEFAULT_INPUT)); parser.add_argument("--out", default=None); parser.add_argument("--participant-disjoint", action="store_true", help="从训练过渡中排除测试 Wave4->5 的参与者")
    args = parser.parse_args()
    out_default = OUT_JSON_DISJOINT if args.participant_disjoint else OUT_JSON
    md_default = OUT_MD_DISJOINT if args.participant_disjoint else OUT_MD
    path = Path(args.input)
    use = [c for c in USECOLS]
    df = pd.read_csv(path, usecols=use)
    df["ID"] = df["ID"].astype(str); df["wave"] = pd.to_numeric(df["wave"], errors="coerce").astype("Int64")
    rows = [evaluate_one(df, disease, args.participant_disjoint) for disease in DISEASES]
    run_id = "risk-charls-wave4-wave5-participant-disjoint-20260821" if args.participant_disjoint else "risk-charls-wave4-wave5-audit-20260821"
    result = {"schema_version": "risk-temporal-evaluation.v1", "run_id": run_id, "generated_at": datetime.now(timezone.utc).isoformat(), "data_class": "research", "data_version": "charls_raw_waves.v1", "source": str(path.resolve()), "source_sha256": sha256(path), "wave_design": {"training": ["Wave1->Wave2", "Wave2->Wave3", "Wave3->Wave4"], "test": "Wave4->Wave5", "unit": "participant_id", "incident_definition": "baseline disease=0; future disease=1", "participant_disjoint": args.participant_disjoint}, "models": rows, "limitations": ["Wave 是调查轮次，不是日级测量日期；该审计是队列波次时间留出，不等同临床外部验证", "参与者独立模式排除了测试 Wave4->5 参与者在训练过渡中的记录，但仍不是独立地区外部队列", "概率仍需独立地区队列和医学审核后才能用于实际复测分层"]}
    out = Path(args.out or out_default); out.parent.mkdir(parents=True, exist_ok=True); out.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    lines = ["# CHARLS 波次时间留出风险审计（2026-08-21）", "", f"训练：Wave1→2、Wave2→3、Wave3→4；测试：Wave4→5；参与者独立模式：**{args.participant_disjoint}**。该设计使用原始 CHARLS 的重复 `participant_id` 与 `wave=1..5`，不把 ID 顺序冒充时间。", "", "| 疾病 | 选择模型 | 测试 N | 阳性 | AUC | Brier | Bootstrap AUC 95% CI | 训练/测试参与者重叠 |", "|---|---|---:|---:|---:|---:|---|---:|"]
    for row in rows:
        m = row["test_metrics"]; ci = m["bootstrap_auc"]["ci95"]; t = row["test_transition"]; lines.append(f"| {row['disease']} | {row['selected_model']} | {t['n']} | {t['positive']} | {m['roc_auc']:.4f} | {m['brier']:.5f} | [{ci[0]:.4f}, {ci[1]:.4f}] | {t['participants_overlap_with_train']} |")
    lines += ["", "## 解释边界", "", "这是比随机留出更接近时间前训后测的 CHARLS 波次审计；参与者独立模式进一步避免同一参与者跨过渡泄漏，但仍不是带日级测量日期的独立地区外部验证，不能宣称临床效果。"]
    md_default.parent.mkdir(parents=True, exist_ok=True); md_default.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(json.dumps({"run_id": result["run_id"], "diseases": len(rows), "output": str(out)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
