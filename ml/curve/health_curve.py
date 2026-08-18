# -*- coding: utf-8 -*-
"""
health_curve.py — 健康指标曲线拟合与趋势分析 Tool（CLI，stdin/stdout JSON）

输入（stdin JSON）:
{
  "metric": "systo",                       # systo|diasto|pulse|weight|bmi|mwaist|glucose|hbalc|cholesterol|uricacid|sleep
  "unit": "mmHg",                          # 展示用（Node 传入）
  "points": [{"t": "2026-08-10T00:00:00Z", "v": 128}, ...],
  "forecast_days": 30                      # 7~30，默认 30
}

输出: Phase 2.5 规范的结构化 JSON（所有数字真实计算，禁止写死）。
用法: echo '{...}' | python ml/curve/health_curve.py
"""
import json
import sys
import time
import numpy as np

from curve_models import MODELS, ewma_smooth
from curve_utils import (parse_points, dedup_time, clean_series, model_metrics,
                         time_ordered_split, classify_trend, detect_spike,
                         MEDICAL_BOUNDS)

MIN_POINTS = 5


def _pick_model(train_x, train_y, val_x, val_y):
    """
    候选模型比较（linear / poly2 / huber），按验证集 MAE 选优。
    返回 (name, coef, score_dict, val_y, val_pred)
    """
    results = []
    for name, (fit, predict) in MODELS.items():
        try:
            coef = fit(train_x, train_y)
            pred = predict(coef, val_x)
            if not np.all(np.isfinite(pred)):
                continue
            mae, rmse, r2 = model_metrics(val_y, pred)
            results.append((mae, name, coef, {'mae': mae, 'rmse': rmse, 'r2': r2}, pred))
        except Exception:
            continue
    if not results:
        return None
    results.sort(key=lambda r: r[0])  # 最小验证 MAE
    return {'name': results[0][1], 'coef': results[0][2],
            'score': results[0][3], 'val_y': val_y, 'val_pred': results[0][4]}


def analyze(metric, unit, points, forecast_days=30):
    ts, vs = parse_points(points)
    ts, vs = dedup_time(ts, vs)
    n_raw = len(vs)
    if n_raw < MIN_POINTS:
        return {
            'success': True, 'status': 'insufficient_data', 'metric': metric,
            'unit': unit, 'data_points': n_raw, 'warning': f'有效数据点不足（{n_raw}/{MIN_POINTS}），无法进行趋势分析',
        }

    ts_clean, vs_clean, removed = clean_series(ts, vs, metric)
    n_clean = len(vs_clean)
    if n_clean < MIN_POINTS:
        return {
            'success': True, 'status': 'insufficient_data', 'metric': metric,
            'unit': unit, 'data_points': n_raw,
            'warning': f'清洗后有效数据点不足（{n_clean}/{MIN_POINTS}），无法进行趋势分析',
        }

    x = (ts_clean - ts_clean[0]) / 86400.0        # 天数
    med = float(np.median(vs_clean))
    span_days = max((ts_clean[-1] - ts_clean[0]) / 86400.0, 1e-6)

    # 短期（最近 30% 或最近 7 天，取点较多者）vs 长期
    if n_clean >= 8:
        recent_n = max(3, int(np.ceil(n_clean * 0.3)))
        recent_x, recent_y = x[-recent_n:], vs_clean[-recent_n:]
    else:
        recent_x, recent_y = x, vs_clean
    recent_span = max((recent_x[-1] - recent_x[0]), 1e-6)
    long_span = max(x[-1] - x[0], 1e-6)

    # 长期趋势：Huber 稳健拟合（不受个别异常点影响）
    l_coef = None
    try:
        from curve_models import huber_fit, huber_predict
        l_coef = huber_fit(x, vs_clean)
        l_pred = huber_predict(l_coef, x)
    except Exception:
        from curve_models import linear_fit, linear_predict
        l_coef = linear_fit(x, vs_clean)
        l_pred = linear_predict(l_coef, x)
    long_vel = float(l_coef[0])                   # 单位/天

    # 近期趋势：线性拟合 recent 段
    from curve_models import linear_fit, linear_predict
    r_coef = linear_fit(recent_x, recent_y)
    recent_vel = float(r_coef[0])

    # 波动：去趋势后残差 CV
    resid = vs_clean - l_pred
    fluct_cv = float(np.std(resid) / med) if med > 1e-9 else 0.0
    fluctuation = 'low' if fluct_cv < 0.03 else ('moderate' if fluct_cv < 0.10 else 'high')

    long_dir, long_strength = classify_trend(long_vel, med, long_span, fluctuation)
    recent_dir, _ = classify_trend(recent_vel, med, recent_span, fluctuation)

    spike = detect_spike(ts_clean, vs_clean) or len(removed) > 0

    # 模型选择（时间顺序验证划分）
    model_info = None
    split = time_ordered_split(x, vs_clean)
    if split is not None:
        train_x, train_y, val_x, val_y = split
        model_info = _pick_model(train_x, train_y, val_x, val_y)

    # 拟合曲线（选中的模型或默认 huber，用于实际/fitted 曲线输出）
    fitted = []
    if model_info is not None:
        model_name = model_info['name']
        _, predict = MODELS[model_name]
        fitted_y = predict(model_info['coef'], x)
    else:
        model_name = 'huber'
        _, predict = MODELS[model_name]
        fitted_y = predict(l_coef if model_name == 'huber' else l_coef, x)

    # 置信度：验证 R² / 数据量 / 波动综合
    confidence = 0.5
    if model_info is not None:
        r2 = model_info['score']['r2']
        confidence = 0.45 + 0.45 * max(0.0, min(1.0, r2))
        if n_clean < 8:
            confidence -= 0.15
        if fluctuation == 'high':
            confidence -= 0.1
    confidence = round(max(0.1, min(0.95, confidence)), 2)

    # Forecast：7~30 天外推（明确为模型估计）
    forecast_available = (
        n_clean >= 10 and model_info is not None
        and model_info['score']['r2'] >= 0.2 and fluctuation != 'high'
    )
    forecast = {'available': forecast_available, 'days': int(forecast_days),
                'estimated_value': None,
                'note': '短期趋势外推，为模型估计值，不代表真实未来'}
    if forecast_available:
        _, predict = MODELS[model_name]
        h = int(max(7, min(30, forecast_days)))
        est = float(predict(model_info['coef'], x[-1] + h))
        forecast['days'] = h
        forecast['estimated_value'] = round(est, 2)

    latest = float(vs[-1])
    previous = float(vs[-2]) if n_clean >= 2 else latest
    change = latest - previous
    change_pct = round(change / previous * 100, 2) if abs(previous) > 1e-9 else 0.0

    out = {
        'success': True, 'status': 'ok', 'metric': metric, 'unit': unit,
        'data_points': n_clean, 'raw_points': n_raw,
        'removed_outliers': int(len(removed)),
        'time_span_days': round(span_days, 1),
        'stats': {
            'mean': round(float(np.mean(vs_clean)), 2),
            'median': round(med, 2),
            'std': round(float(np.std(vs_clean)), 2),
            'min': round(float(np.min(vs_clean)), 2),
            'max': round(float(np.max(vs_clean)), 2),
        },
        'latest_value': round(latest, 2),
        'previous_value': round(previous, 2),
        'change': round(change, 2),
        'change_percent': change_pct,
        'long_term_trend': long_dir,
        'recent_trend': recent_dir,
        'trend_strength': long_strength,
        'recent_velocity': round(recent_vel, 4),
        'long_term_velocity': round(long_vel, 4),
        'fluctuation': fluctuation,
        'abnormal_spike': spike,
        'model': model_name if model_info else 'huber',
        'model_score': model_info['score'] if model_info else None,
        'confidence': confidence,
        'forecast': forecast,
        'curve': {
            'timestamps': [ts_clean[i].item() for i in range(len(ts_clean))],
            'actual': [round(float(v), 2) for v in vs_clean],
            'fitted': [round(float(v), 2) for v in fitted_y],
        },
        'warning': None,
    }
    return out


def main():
    raw = sys.stdin.buffer.read().decode('utf-8', errors='replace').strip()
    if not raw:
        out = {'success': False, 'error': 'stdin 为空'}
    else:
        try:
            req = json.loads(raw)
        except json.JSONDecodeError as e:
            out = {'success': False, 'error': f'JSON 解析失败: {e}'}
        else:
            try:
                # 批量模式：一次调用分析多个指标（性能优化，单次 spawn）
                if 'batch' in req and isinstance(req['batch'], list):
                    fdays = int(req.get('forecast_days') or 30)
                    results = []
                    for item in req['batch']:
                        m = str(item.get('metric') or '')
                        pts = item.get('points') or []
                        unit = str(item.get('unit') or '')
                        if m not in MEDICAL_BOUNDS:
                            results.append({'success': False, 'metric': m, 'error': f'不支持的指标: {m}'})
                            continue
                        results.append(analyze(m, unit, pts, fdays))
                    out = {'success': True, 'metric': 'all', 'metrics': results}
                else:
                    metric = str(req.get('metric', ''))
                    points = req.get('points') or []
                    unit = str(req.get('unit') or '')
                    fdays = int(req.get('forecast_days') or 30)
                    if metric not in MEDICAL_BOUNDS:
                        out = {'success': False, 'error': f'不支持的指标: {metric}'}
                    elif not isinstance(points, list):
                        out = {'success': False, 'error': 'points 必须为数组'}
                    else:
                        out = analyze(metric, unit, points, fdays)
            except Exception as e:  # 绝不向 Node 吐 traceback
                out = {'success': False, 'error': f'internal error: {type(e).__name__}: {e}'}
    sys.stdout.buffer.write((json.dumps(out, ensure_ascii=False) + '\n').encode('utf-8'))


if __name__ == '__main__':
    main()
