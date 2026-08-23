"""Build privacy-preserving age/sex reference summaries from CHARLS.

Only aggregate statistics are shipped with the application. Runtime code never
opens the raw research CSV.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd


METRICS = {
    "bp.systolic": ("systo", "mmHg", 60, 260),
    "bp.diastolic": ("diasto", "mmHg", 40, 150),
    "hr": ("pulse", "bpm", 40, 150),
    "weight": ("mweight", "kg", 20, 200),
    "bmi": ("bmi", "kg/m²", 10, 60),
    "sleep": ("sleep", "h", 0, 16),
}
AGE_GROUPS = (("60-69", 60, 69), ("70-79", 70, 79), ("80+", 80, 120))
SEX_CODES = {"female": 0, "male": 1}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def summary(values: pd.Series) -> dict | None:
    clean = pd.to_numeric(values, errors="coerce").dropna()
    if clean.empty:
        return None
    return {
        "n": int(clean.size),
        "p25": round(float(clean.quantile(0.25)), 2),
        "median": round(float(clean.median()), 2),
        "p75": round(float(clean.quantile(0.75)), 2),
    }


def build(source: Path) -> dict:
    columns = ["ID", "wave", "age", "gender"] + sorted({v[0] for v in METRICS.values()})
    frame = pd.read_csv(source, usecols=columns, low_memory=False)
    for column in columns:
        if column != "ID":
            frame[column] = pd.to_numeric(frame[column], errors="coerce")
    frame = frame.loc[frame.wave == 1].drop_duplicates("ID").copy()
    frame = frame.loc[frame.age.between(60, 120)]
    for _key, (field, _unit, low, high) in METRICS.items():
        frame.loc[~frame[field].between(low, high), field] = pd.NA

    cohorts: dict[str, dict] = {}
    for age_label, low_age, high_age in AGE_GROUPS:
        age_frame = frame.loc[frame.age.between(low_age, high_age)]
        cohorts[age_label] = {"all": {}, "female": {}, "male": {}}
        for sex_label, sex_code in (("all", None), *SEX_CODES.items()):
            cohort = age_frame if sex_code is None else age_frame.loc[age_frame.gender == sex_code]
            for metric, (field, unit, _low, _high) in METRICS.items():
                item = summary(cohort[field])
                if item:
                    cohorts[age_label][sex_label][metric] = {**item, "unit": unit}

    return {
        "schema_version": "charls-peer-reference.v1",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": "CHARLS baseline wave 1, participant-deduplicated",
        "source_sha256": sha256(source),
        "sex_encoding": {"female": 0, "male": 1},
        "minimum_cell_n": 50,
        "participants_60_plus": int(frame.ID.nunique()),
        "age_groups": cohorts,
        "limitations": [
            "人群四分位范围不是医学正常范围",
            "CHARLS调查口径与家庭设备口径可能不同",
            "不支持血氧、步数、体温、呼吸频率和条件化血糖的同口径比较",
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", default=r"D:\大创数据2\CHARLS.csv")
    parser.add_argument("--out", default=str(Path(__file__).with_name("peer_reference.v1.json")))
    args = parser.parse_args()
    source = Path(args.source)
    output = Path(args.out)
    output.parent.mkdir(parents=True, exist_ok=True)
    payload = build(source)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"output": str(output), "participants": payload["participants_60_plus"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
