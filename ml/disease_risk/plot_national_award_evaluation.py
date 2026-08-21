"""Render transparent evaluation figures from the frozen risk-model audit JSON.

The figures are descriptive audit artifacts, not evidence of clinical efficacy.
"""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INPUT = ROOT / "reports" / "national-award-risk-evaluation-20260821.json"
OUT = ROOT / "reports" / "national-award-risk-figures"


def svg_escape(value: object) -> str:
    return str(value).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def make_svg(payload: dict, kind: str) -> str:
    width, height = 1000, 700
    pad_left, pad_top = 75, 55
    panel_w, panel_h = 430, 260
    items = payload.get("models", [])
    panels = []
    for idx, row in enumerate(items):
        x0 = pad_left + (idx % 2) * 470
        y0 = pad_top + (idx // 2) * 315
        title = svg_escape(row.get("disease", "unknown"))
        panels.append(f'<text x="{x0}" y="{y0}" font-size="18" font-family="Arial" fill="#3E342D">{title}</text>')
        panels.append(f'<line x1="{x0}" y1="{y0+panel_h}" x2="{x0+panel_w}" y2="{y0+panel_h}" stroke="#A99D91"/>')
        panels.append(f'<line x1="{x0}" y1="{y0+20}" x2="{x0}" y2="{y0+panel_h}" stroke="#A99D91"/>')
        if kind == "calibration":
            points = row.get("test", {}).get("calibration", {}).get("bins", [])
            maxv = max(0.1, max([b.get("predicted", 0.0) for b in points] + [b.get("observed", 0.0) for b in points] + [0.1])) * 1.15
            def xy(a, b):
                return (x0 + panel_w * a / maxv, y0 + panel_h - panel_h * b / maxv)
            ax, ay = xy(0, 0); bx, by = xy(maxv, maxv)
            panels.append(f'<line x1="{ax:.1f}" y1="{ay:.1f}" x2="{bx:.1f}" y2="{by:.1f}" stroke="#B9AFA2" stroke-dasharray="6 5"/>')
            coords = [xy(b.get("predicted", 0.0), b.get("observed", 0.0)) for b in points]
            if coords:
                panels.append(f'<polyline points="{" ".join(f"{a:.1f},{b:.1f}" for a,b in coords)}" fill="none" stroke="#E8864A" stroke-width="3"/>')
                for a, b in coords:
                    panels.append(f'<circle cx="{a:.1f}" cy="{b:.1f}" r="4" fill="#E8864A"/>')
            panels.append(f'<text x="{x0}" y="{y0+panel_h+22}" font-size="12" font-family="Arial" fill="#6E6257">预测概率</text>')
            panels.append(f'<text x="{x0+panel_w-80}" y="{y0+panel_h+22}" font-size="12" font-family="Arial" fill="#6E6257">实际率</text>')
        else:
            points = row.get("test", {}).get("decision_curve", [])
            ys = [p.get("model_net_benefit", 0.0) for p in points] + [p.get("treat_all_net_benefit", 0.0) for p in points] + [0.0]
            ymin, ymax = min(ys + [-0.01]), max(ys + [0.01])
            span = max(0.001, ymax - ymin)
            def xy(a, b):
                return (x0 + panel_w * a, y0 + panel_h - panel_h * (b-ymin)/span)
            def polyline(key, color, dash=""):
                coords = [xy(p.get("threshold", 0.0), p.get(key, 0.0)) for p in points]
                if coords:
                    d = f' stroke-dasharray="{dash}"' if dash else ""
                    panels.append(f'<polyline points="{" ".join(f"{a:.1f},{b:.1f}" for a,b in coords)}" fill="none" stroke="{color}" stroke-width="3"{d}/>')
            polyline("model_net_benefit", "#E8864A")
            polyline("treat_all_net_benefit", "#8D6E97", "7 5")
            polyline("treat_none_net_benefit", "#777777", "2 5")
            panels.append(f'<text x="{x0}" y="{y0+panel_h+22}" font-size="12" font-family="Arial" fill="#6E6257">阈值</text>')
            panels.append(f'<text x="{x0+panel_w-65}" y="{y0+panel_h+22}" font-size="12" font-family="Arial" fill="#6E6257">净获益</text>')
    title = "风险模型校准图（严格随机留出审计）" if kind == "calibration" else "风险模型决策曲线（阈值仅作复测分层研究）"
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}"><rect width="100%" height="100%" fill="white"/><text x="{width/2}" y="28" text-anchor="middle" font-size="22" font-family="Arial" fill="#3E342D">{title}</text>{"".join(panels)}</svg>'


def main() -> None:
    payload = json.loads(INPUT.read_text(encoding="utf-8"))
    OUT.mkdir(parents=True, exist_ok=True)
    diseases = payload.get("models", [])

    (OUT / "calibration-curves.svg").write_text(make_svg(payload, "calibration"), encoding="utf-8")
    (OUT / "decision-curves.svg").write_text(make_svg(payload, "decision"), encoding="utf-8")

    manifest = {
        "schema_version": "risk-figure-manifest.v1",
        "input": str(INPUT),
        "figures": ["calibration-curves.svg", "decision-curves.svg"],
        "limitations": ["图形来自严格随机留出审计，不是时间外部验证", "阈值不是临床处方阈值", "概率用于筛查和复测分层，不是诊断"],
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"output": str(OUT), "figures": manifest["figures"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
