# -*- coding: utf-8 -*-
"""
curve_utils.py — 数据清洗 / 模型评估 / 趋势与异常识别

原则:
  - 时间升序、去重（重复时间取均值）
  - 医学合理范围 + MAD 异常点剔除（128,130,129,210,131,132 中 210 应被清洗，
    不直接判为持续强上升）
  - 短期/长期趋势分离（recent vs long_term），不使用 latest-first 判断
"""
import numpy as np

# 医学合理范围（超界 → 异常点，与 build_dataset.py 口径一致；单位随指标）
MEDICAL_BOUNDS = {
    'systo': (60, 260), 'diasto': (40, 150), 'pulse': (40, 150),
    'weight': (20, 200), 'bmi': (10, 60), 'mwaist': (40, 160),
    'glucose': (1, 33), 'hbalc': (3, 20), 'hba1c': (3, 20), 'cholesterol': (1, 20),
    'uricacid': (50, 1200), 'sleep': (0, 16),
    'waist': (40, 160), 'spo2': (50, 100), 'steps': (0, 100000), 'temp': (30, 45),
    'resp': (5, 60), 'grip': (0, 100), 'bodyfat': (5, 70),
    'pulse_pressure': (5, 160),
    'health_score': (0, 100),
}


def parse_points(points):
    """points: [{'t': ISO 或 epoch 秒, 'v': 数值}] → (ts[], values[]) 按时间升序"""
    rows = []
    for p in points or []:
        t, v = p.get('t'), p.get('v')
        if t is None or v is None:
            continue
        try:
            v = float(v)
        except (TypeError, ValueError):
            continue
        if isinstance(t, (int, float)):
            ts = float(t)
        else:
            from datetime import datetime, timezone
            s = str(t).strip()
            if s.endswith('Z'):
                s = s[:-1] + '+00:00'
            ts = datetime.fromisoformat(s).timestamp()
        if np.isnan(v) or np.isinf(v):
            continue
        rows.append((ts, v))
    if not rows:
        return np.array([]), np.array([])
    rows.sort(key=lambda r: r[0])
    ts = np.array([r[0] for r in rows])
    vs = np.array([r[1] for r in rows])
    return ts, vs


def dedup_time(ts, vs):
    """重复时间戳 → 该时间点的均值（保持升序）"""
    if len(ts) == 0:
        return ts, vs
    out_t, out_v = [], []
    i = 0
    while i < len(ts):
        j = i
        while j + 1 < len(ts) and abs(ts[j + 1] - ts[i]) < 1e-6:
            j += 1
        out_t.append(ts[i])
        out_v.append(float(np.mean(vs[i:j + 1])))
        i = j + 1
    return np.array(out_t), np.array(out_v)


def aggregate_daily(ts, vs, method='median'):
    """按本地日聚合重复采集，保留日期级趋势，避免一天多次测量放大权重。"""
    if len(ts) == 0:
        return ts, vs
    days = np.floor(np.asarray(ts, dtype=float) / 86400.0)
    out_t, out_v = [], []
    for day in np.unique(days):
        vals = np.asarray(vs)[days == day]
        if method == 'sum': value = float(np.sum(vals))
        elif method == 'mean': value = float(np.mean(vals))
        else: value = float(np.median(vals))
        out_t.append(float(day * 86400.0 + 43200.0))
        out_v.append(value)
    return np.asarray(out_t), np.asarray(out_v)


def clean_series(ts, vs, metric):
    """
    清洗: 医学范围过滤 + MAD 异常点剔除（仅用于拟合，raw 保留）
    返回 (ts_clean, vs_clean, removed_indices)
    """
    mask = np.ones(len(ts), dtype=bool)
    lo, hi = MEDICAL_BOUNDS.get(metric, (None, None))
    if lo is not None and hi is not None:
        mask &= (vs >= lo) & (vs <= hi)
    if mask.sum() >= 3:
        med = np.median(vs[mask])
        mad = 1.4826 * np.median(np.abs(vs[mask] - med))
        if mad > 1e-9:
            mask &= (np.abs(vs - med) <= 4.0 * mad)  # MAD z-score 阈值
    idx = np.where(mask)[0]
    return ts[idx], vs[idx], np.where(~mask)[0]


def model_metrics(y_true, y_pred):
    """MAE / RMSE / R²"""
    y_true = np.asarray(y_true, dtype=float)
    y_pred = np.asarray(y_pred, dtype=float)
    mae = float(np.mean(np.abs(y_true - y_pred)))
    rmse = float(np.sqrt(np.mean((y_true - y_pred) ** 2)))
    ss_res = float(np.sum((y_true - y_pred) ** 2))
    ss_tot = float(np.sum((y_true - np.mean(y_true)) ** 2))
    r2 = 1.0 - ss_res / ss_tot if ss_tot > 1e-12 else 0.0
    return mae, rmse, r2


def time_ordered_split(ts, vs):
    """
    时间顺序划分（禁止随机 train_test_split）。
    n>=10: 前 80% 训练，后 20% 验证；5<=n<10: 前 n-2 训练，末 2 点验证。
    返回 (train_x, train_y, val_x, val_y) 或 None（不足以验证）
    """
    n = len(ts)
    if n < 5:
        return None
    if n >= 10:
        split = max(2, int(np.ceil(n * 0.2)))
    else:
        split = 2
    train_x, train_y = ts[:n - split], vs[:n - split]
    val_x, val_y = ts[n - split:], vs[n - split:]
    return train_x, train_y, val_x, val_y


def classify_trend(vel, med, span_days, fluct):
    """
    趋势分类：stable / rising / falling
    归一化速度 = |vel| / med（每天比例），乘窗口天数 = 窗口内相对变化
    波动大时提高阈值，避免把噪声当趋势
    """
    if med <= 1e-9:
        return 'stable', 'weak'
    rel = abs(vel) / med * span_days
    thr = 0.03 if fluct == 'low' else (0.06 if fluct == 'moderate' else 0.12)
    if rel < thr:
        return 'stable', 'weak'
    direction = 'rising' if vel > 0 else 'falling'
    if rel < 0.05:
        strength = 'weak'
    elif rel < 0.15:
        strength = 'moderate'
    else:
        strength = 'strong'
    return direction, strength


def detect_spike(ts, vs):
    """MAD 孤立异常点检测（保留原始值，标记 spike）"""
    if len(vs) < 5:
        return False
    med = np.median(vs)
    mad = 1.4826 * np.median(np.abs(vs - med))
    if mad <= 1e-9:
        return False
    z = np.abs(vs - med) / mad
    return bool((z >= 4.0).any())
