"""Reusable modeling and evaluation utilities for CHARLS predictors."""
from __future__ import annotations

import importlib.util
from dataclasses import dataclass
from typing import Any

import numpy as np
import pandas as pd
from sklearn.calibration import CalibratedClassifierCV
from sklearn.compose import TransformedTargetRegressor
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression, Ridge
from sklearn.metrics import (
    average_precision_score,
    brier_score_loss,
    mean_absolute_error,
    mean_squared_error,
    r2_score,
    roc_auc_score,
    roc_curve,
)
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler


PREFERRED_BACKENDS = ("catboost", "lightgbm", "xgboost")


def available_backends() -> list[str]:
    return [name for name in PREFERRED_BACKENDS if importlib.util.find_spec(name) is not None]


def resolve_backend(requested: str = "auto") -> str:
    available = available_backends()
    if requested != "auto":
        if requested not in PREFERRED_BACKENDS:
            raise ValueError(f"unknown backend: {requested}")
        if requested not in available:
            raise RuntimeError(f"requested backend is not installed: {requested}")
        return requested
    if not available:
        raise RuntimeError("install at least one of catboost, lightgbm or xgboost")
    return available[0]


def linear_regressor():
    return make_pipeline(
        SimpleImputer(strategy="median", add_indicator=True),
        StandardScaler(),
        Ridge(alpha=10.0),
    )


def logistic_classifier():
    return make_pipeline(
        SimpleImputer(strategy="median", add_indicator=True),
        StandardScaler(),
        LogisticRegression(max_iter=1000, class_weight="balanced", C=0.5),
    )


def boosting_regressor(backend: str, seed: int = 42):
    if backend == "catboost":
        from catboost import CatBoostRegressor
        estimator = CatBoostRegressor(
            iterations=350, depth=6, learning_rate=0.04, loss_function="MAE",
            random_seed=seed, verbose=False, allow_writing_files=False,
        )
    elif backend == "lightgbm":
        from lightgbm import LGBMRegressor
        estimator = LGBMRegressor(
            n_estimators=350, learning_rate=0.04, num_leaves=31,
            subsample=0.85, colsample_bytree=0.85, reg_lambda=1.0,
            random_state=seed, verbosity=-1,
        )
    elif backend == "xgboost":
        from xgboost import XGBRegressor
        estimator = XGBRegressor(
            n_estimators=350, max_depth=5, learning_rate=0.04,
            subsample=0.85, colsample_bytree=0.85, reg_lambda=2.0,
            objective="reg:absoluteerror", tree_method="hist", random_state=seed,
            n_jobs=4,
        )
    else:
        raise ValueError(backend)
    return make_pipeline(SimpleImputer(strategy="median", add_indicator=True), estimator)


def boosting_classifier(backend: str, seed: int = 42):
    if backend == "catboost":
        from catboost import CatBoostClassifier
        estimator = CatBoostClassifier(
            iterations=350, depth=6, learning_rate=0.04, loss_function="Logloss",
            random_seed=seed, verbose=False, auto_class_weights="Balanced",
            allow_writing_files=False,
        )
    elif backend == "lightgbm":
        from lightgbm import LGBMClassifier
        estimator = LGBMClassifier(
            n_estimators=350, learning_rate=0.04, num_leaves=31,
            subsample=0.85, colsample_bytree=0.85, reg_lambda=1.0,
            class_weight="balanced", random_state=seed, verbosity=-1,
        )
    elif backend == "xgboost":
        from xgboost import XGBClassifier
        estimator = XGBClassifier(
            n_estimators=350, max_depth=5, learning_rate=0.04,
            subsample=0.85, colsample_bytree=0.85, reg_lambda=2.0,
            objective="binary:logistic", eval_metric="logloss", tree_method="hist",
            random_state=seed, n_jobs=4,
        )
    else:
        raise ValueError(backend)
    base = make_pipeline(SimpleImputer(strategy="median", add_indicator=True), estimator)
    return CalibratedClassifierCV(base, method="sigmoid", cv=3)


def safe_auc(y_true: np.ndarray, probability: np.ndarray) -> float | None:
    return float(roc_auc_score(y_true, probability)) if len(np.unique(y_true)) > 1 else None


def choose_threshold(y_true: np.ndarray, probability: np.ndarray) -> float:
    if len(np.unique(y_true)) < 2:
        return 0.5
    fpr, tpr, thresholds = roc_curve(y_true, probability)
    finite = np.isfinite(thresholds)
    if not finite.any():
        return 0.5
    index = int(np.argmax((tpr - fpr)[finite]))
    value = float(thresholds[finite][index])
    return float(np.clip(value, 0.05, 0.50))


def calibration_bins(y_true: np.ndarray, probability: np.ndarray, bins: int = 10) -> list[dict[str, Any]]:
    edges = np.linspace(0.0, 1.0, bins + 1)
    output = []
    for index in range(bins):
        mask = (probability >= edges[index]) & (probability < edges[index + 1] if index < bins - 1 else probability <= edges[index + 1])
        if not mask.any():
            continue
        output.append({
            "lower": round(float(edges[index]), 4),
            "upper": round(float(edges[index + 1]), 4),
            "n": int(mask.sum()),
            "mean_probability": round(float(np.mean(probability[mask])), 6),
            "observed_rate": round(float(np.mean(y_true[mask])), 6),
        })
    return output


def classification_metrics(y_true, probability, threshold: float) -> dict[str, Any]:
    y = np.asarray(y_true, dtype=int)
    p = np.asarray(probability, dtype=float)
    predicted = p >= threshold
    positive = y == 1
    negative = ~positive
    sensitivity = float(np.mean(predicted[positive])) if positive.any() else None
    specificity = float(np.mean(~predicted[negative])) if negative.any() else None
    return {
        "n": int(len(y)),
        "positives": int(positive.sum()),
        "prevalence": round(float(np.mean(y)), 6),
        "auroc": round(safe_auc(y, p), 6) if safe_auc(y, p) is not None else None,
        "pr_auc": round(float(average_precision_score(y, p)), 6) if positive.any() else None,
        "sensitivity": round(sensitivity, 6) if sensitivity is not None else None,
        "specificity": round(specificity, 6) if specificity is not None else None,
        "brier": round(float(brier_score_loss(y, p)), 6),
        "threshold": round(float(threshold), 6),
        "calibration": calibration_bins(y, p),
    }


def numeric_metrics(y_true, predicted, *, scale: float, lower=None, upper=None, accepted=None) -> dict[str, Any]:
    y = np.asarray(y_true, dtype=float)
    p = np.asarray(predicted, dtype=float)
    mask = np.ones(len(y), dtype=bool) if accepted is None else np.asarray(accepted, dtype=bool)
    if not mask.any():
        return {"n": int(len(y)), "accepted_n": 0, "refusal_rate": 1.0}
    yy, pp = y[mask], p[mask]
    result = {
        "n": int(len(y)),
        "accepted_n": int(mask.sum()),
        "mae": round(float(mean_absolute_error(yy, pp)), 6),
        "rmse": round(float(np.sqrt(mean_squared_error(yy, pp))), 6),
        "mase": round(float(mean_absolute_error(yy, pp) / max(float(scale), 1e-9)), 6),
        "r2": round(float(r2_score(yy, pp)), 6) if len(yy) > 1 else None,
        "refusal_rate": round(float(1.0 - np.mean(mask)), 6),
    }
    if lower is not None and upper is not None:
        lo, hi = np.asarray(lower, dtype=float)[mask], np.asarray(upper, dtype=float)[mask]
        result["interval_coverage"] = round(float(np.mean((yy >= lo) & (yy <= hi))), 6)
        result["interval_width"] = round(float(np.mean(hi - lo)), 6)
    return result


def feature_completeness(frame: pd.DataFrame, features: list[str]) -> np.ndarray:
    return frame[features].notna().mean(axis=1).to_numpy(dtype=float)


def risk_levels(probability: np.ndarray, threshold: float) -> np.ndarray:
    p = np.asarray(probability, dtype=float)
    return np.where(p >= threshold, "high", np.where(p >= threshold / 2.0, "medium", "low"))


def project_blood_pressure(systolic, diastolic, minimum_pulse_pressure: float = 5.0):
    s = np.asarray(systolic, dtype=float).copy()
    d = np.asarray(diastolic, dtype=float).copy()
    violation = s - d < minimum_pulse_pressure
    center = (s[violation] + d[violation]) / 2.0
    s[violation] = center + minimum_pulse_pressure / 2.0
    d[violation] = center - minimum_pulse_pressure / 2.0
    s = np.clip(s, 60.0, 260.0)
    d = np.clip(d, 40.0, 150.0)
    return s, d, violation


def subgroup_labels(frame: pd.DataFrame, completeness: np.ndarray) -> dict[str, np.ndarray]:
    age = pd.to_numeric(frame.get("age_x"), errors="coerce").to_numpy(dtype=float)
    gender = pd.to_numeric(frame.get("gender_x"), errors="coerce").to_numpy(dtype=float)
    chronic = pd.to_numeric(frame.get("chronic_x"), errors="coerce").to_numpy(dtype=float)
    return {
        "age": np.select([age < 60, age < 70, age < 80], ["<60", "60-69", "70-79"], default="80+"),
        "gender": np.where(gender == 1, "male", np.where(gender == 0, "female", "unknown")),
        "missingness": np.where(completeness >= 0.85, "low", np.where(completeness >= 0.60, "moderate", "high")),
        "disease_status": np.where(chronic == 1, "chronic", np.where(chronic == 0, "none_reported", "unknown")),
        "device": np.full(len(frame), "charls_survey_no_device", dtype=object),
    }
