# -*- coding: utf-8 -*-
"""Small, auditable curve models for genuine time extrapolation.

The module intentionally contains only low-capacity models.  Every candidate
is fitted again at every rolling origin; none may inspect future observations.
"""
import numpy as np


MODEL_SPECS = {
    'last_value': {
        'min_points': 1, 'metrics': 'all forecastable numeric metrics',
        'missing': 'use the most recent observed value; never fill a target',
        'measurement_conditions': 'one compatible condition group', 'max_horizon_days': 14,
        'complexity_penalty': 0.0, 'baseline': True,
    },
    'rolling_median': {
        'min_points': 5, 'metrics': 'all forecastable numeric metrics',
        'missing': 'median of up to 14 most recent observed days',
        'measurement_conditions': 'one compatible condition group', 'max_horizon_days': 14,
        'complexity_penalty': 0.0, 'baseline': True,
    },
    'seasonal_naive': {
        'min_points': 28, 'metrics': 'daily home measurements with a verified weekly cycle',
        'missing': 'same weekday observation, falling back to weekday median only',
        'measurement_conditions': 'one condition group; >=80% day coverage; reliable 7-day cycle',
        'max_horizon_days': 14, 'complexity_penalty': 0.015, 'baseline': False,
    },
    'ets_damped_trend': {
        'min_points': 14, 'metrics': 'blood pressure, resting pulse, weight, condition-specific glucose',
        'missing': 'state is propagated across calendar gaps; targets are never imputed',
        'measurement_conditions': 'one compatible condition group', 'max_horizon_days': 14,
        'complexity_penalty': 0.035, 'baseline': False,
    },
    'kalman_local_level': {
        'min_points': 10, 'metrics': 'noisy level-like physiological measurements',
        'missing': 'predict-only state transition across gaps',
        'measurement_conditions': 'one compatible condition group', 'max_horizon_days': 7,
        'complexity_penalty': 0.025, 'baseline': False,
    },
    'kalman_local_linear': {
        'min_points': 14, 'metrics': 'slowly changing physiological measurements',
        'missing': 'predict-only state transition across gaps',
        'measurement_conditions': 'one compatible condition group', 'max_horizon_days': 14,
        'complexity_penalty': 0.045, 'baseline': False,
    },
    'robust_quantile_trend': {
        'min_points': 12, 'metrics': 'monotone or slowly drifting physiological measurements',
        'missing': 'fit on observed calendar-day coordinates only',
        'measurement_conditions': 'one compatible condition group', 'max_horizon_days': 14,
        'complexity_penalty': 0.025, 'baseline': False,
    },
    'population_prior_residual': {
        'min_points': 7, 'metrics': 'metrics with a versioned external population prior',
        'missing': 'population path plus median observed personal residual',
        'measurement_conditions': 'prior must match metric/unit/condition group', 'max_horizon_days': 14,
        'complexity_penalty': 0.05, 'baseline': False,
    },
}


def linear_fit(x, y):
    """x: 自起始的天数(float)；y: 值。返回 [slope, intercept]"""
    A = np.vstack([x, np.ones_like(x)]).T
    coef, *_ = np.linalg.lstsq(A, y, rcond=None)
    return coef


def linear_predict(coef, x):
    return coef[0] * x + coef[1]


def poly2_fit(x, y):
    """返回 [a, b, c]（y = a x² + b x + c）"""
    return np.polyfit(x, y, 2)


def poly2_predict(coef, x):
    return coef[0] * x ** 2 + coef[1] * x + coef[2]


def huber_fit(x, y, delta=1.345, iters=25):
    """
    Huber 稳健回归（IRLS）。delta 控制稳健度（1.345 为 95% 渐近效率）。
    返回 [slope, intercept]
    """
    A = np.vstack([x, np.ones_like(x)]).T
    coef = np.linalg.lstsq(A, y, rcond=None)[0]
    r = y - linear_predict(coef, x)
    scale = 1.4826 * np.median(np.abs(r))          # MAD 尺度估计
    scale = max(scale, 1e-9)
    for _ in range(iters):
        r = y - linear_predict(coef, x)
        abs_r = np.abs(r)
        w = np.ones_like(abs_r)
        outlier = abs_r > delta * scale
        w[outlier] = np.clip((delta * scale) / abs_r[outlier], 0.0, 1e9)
        W = np.sqrt(w)
        coef = np.linalg.lstsq(A * W[:, None], y * W, rcond=None)[0]
    return coef


def huber_predict(coef, x):
    return linear_predict(coef, x)


def ewma_smooth(y, alpha=0.3):
    """
    EWMA 指数加权平滑（仅用于近期趋势参考与绘图）。
    返回与 y 等长的平滑序列。
    """
    y = np.asarray(y, dtype=float)
    s = np.empty_like(y)
    s[0] = y[0]
    for i in range(1, len(y)):
        s[i] = alpha * y[i] + (1 - alpha) * s[i - 1]
    return s


def robust_local_smooth(x, y, target_x=None, span=0.45, iters=3):
    """稳健局部线性平滑（LOWESS 风格，纯 numpy 实现）。

    每个目标位置只使用附近观测点，距离越远权重越低，并用 Huber 权重
    降低单次异常测量对趋势线的影响。它只用于历史趋势展示，不承担远期外推。
    """
    x = np.asarray(x, dtype=float)
    y = np.asarray(y, dtype=float)
    target = x if target_x is None else np.asarray(target_x, dtype=float)
    if len(x) == 0:
        return np.asarray([], dtype=float)
    q = max(3, min(len(x), int(np.ceil(len(x) * float(span)))))
    out = np.empty(len(target), dtype=float)
    for j, tx in enumerate(target):
        distances = np.abs(x - tx)
        order = np.argsort(distances)[:q]
        local_x, local_y = x[order], y[order]
        bandwidth = max(float(distances[order[-1]]), 1e-9)
        base_w = (1.0 - (distances[order] / bandwidth) ** 3) ** 3
        base_w[distances[order] >= bandwidth] = 0.0
        if not np.any(base_w > 0):
            base_w[:] = 1.0
        robust_w = np.ones_like(base_w)
        coef = np.array([0.0, float(np.average(local_y, weights=base_w))])
        for _ in range(max(1, int(iters))):
            w = base_w * robust_w
            A = np.vstack([local_x, np.ones_like(local_x)]).T
            sw = np.sqrt(np.maximum(w, 1e-12))
            coef = np.linalg.lstsq(A * sw[:, None], local_y * sw, rcond=None)[0]
            resid = local_y - (coef[0] * local_x + coef[1])
            scale = max(1.4826 * float(np.median(np.abs(resid))), 1e-9)
            cutoff = 1.345 * scale
            abs_r = np.abs(resid)
            robust_w = np.where(abs_r <= cutoff, 1.0, cutoff / np.maximum(abs_r, 1e-12))
        out[j] = coef[0] * tx + coef[1]
    return out


def damped_fit(x, y, window=5, damping=0.88):
    """拟合局部趋势，并为未来外推保存阻尼斜率，避免长期爆炸。"""
    x = np.asarray(x, dtype=float)
    y = np.asarray(y, dtype=float)
    n = min(len(x), max(3, int(window)))
    local_x, local_y = x[-n:], y[-n:]
    coef = huber_fit(local_x, local_y)
    return np.array([coef[0], coef[1], x[-1], y[-1], float(damping)], dtype=float)


def damped_predict(coef, x):
    """局部线性趋势预测；未来斜率按天阻尼，历史点仍按局部直线计算。"""
    scalar = np.ndim(x) == 0
    x = np.atleast_1d(np.asarray(x, dtype=float))
    slope, intercept, last_x, last_y, damping = [float(v) for v in coef]
    out = slope * x + intercept
    future = x > last_x
    if np.any(future):
        h = x[future] - last_x
        damping = min(max(damping, 0.5), 0.99)
        accumulated = (1.0 - damping ** h) / (1.0 - damping)
        out[future] = last_y + slope * accumulated
    return float(out[0]) if scalar else out


def quantile_trend_fit(x, y, max_pairs=4096):
    """Median (0.5-quantile) trend using a deterministic Theil-Sen slope."""
    x, y = np.asarray(x, dtype=float), np.asarray(y, dtype=float)
    slopes = []
    stride = max(1, int(np.ceil((len(x) * max(len(x) - 1, 1) / 2) / max_pairs)))
    pair_index = 0
    for i in range(len(x) - 1):
        for j in range(i + 1, len(x)):
            pair_index += 1
            if pair_index % stride:
                continue
            dx = x[j] - x[i]
            if abs(dx) > 1e-9:
                slopes.append((y[j] - y[i]) / dx)
    slope = float(np.median(slopes)) if slopes else 0.0
    intercept = float(np.median(y - slope * x))
    return np.array([slope, intercept], dtype=float)


def quantile_trend_predict(coef, x):
    return linear_predict(coef, np.asarray(x, dtype=float))


def ets_damped_fit(x, y):
    """Holt ETS(A,A,N) with damped trend and a tiny deterministic grid search."""
    x, y = np.asarray(x, dtype=float), np.asarray(y, dtype=float)
    best = None
    initial_slope = float(np.median(np.diff(y) / np.maximum(np.diff(x), 1e-6))) if len(y) > 1 else 0.0
    for alpha in (0.2, 0.4, 0.6, 0.8):
        for beta in (0.05, 0.15, 0.3):
            for phi in (0.80, 0.90, 0.96):
                level, trend, sse = float(y[0]), initial_slope, 0.0
                for i in range(1, len(y)):
                    gap = max(float(x[i] - x[i - 1]), 1.0)
                    damp_sum = (1.0 - phi ** gap) / max(1.0 - phi, 1e-9)
                    forecast = level + trend * damp_sum
                    error = float(y[i] - forecast)
                    sse += min(error * error, 9.0 * max(np.var(y), 1e-6))
                    old_level = level
                    level = alpha * float(y[i]) + (1.0 - alpha) * forecast
                    trend = beta * ((level - old_level) / gap) + (1.0 - beta) * (phi ** gap) * trend
                candidate = (sse, level, trend, float(x[-1]), phi, alpha, beta)
                if best is None or candidate[0] < best[0]:
                    best = candidate
    return np.asarray(best[1:], dtype=float)


def ets_damped_predict(coef, target):
    level, trend, last_x, phi, _, _ = [float(value) for value in coef]
    h = np.maximum(np.asarray(target, dtype=float) - last_x, 0.0)
    damp_sum = (1.0 - phi ** h) / max(1.0 - phi, 1e-9)
    return level + trend * damp_sum


def kalman_fit(x, y, linear=False):
    """Robust local-level/local-linear Kalman filter with fixed low-capacity noise ratios."""
    x, y = np.asarray(x, dtype=float), np.asarray(y, dtype=float)
    obs_scale = max(1.4826 * float(np.median(np.abs(y - np.median(y)))), abs(float(np.median(y))) * 0.005, 1e-3)
    level = float(y[0])
    slope = float(np.median(np.diff(y) / np.maximum(np.diff(x), 1e-6))) if linear and len(y) > 1 else 0.0
    covariance = np.diag([obs_scale ** 2, (obs_scale * 0.10) ** 2])
    observation_var = obs_scale ** 2
    for i in range(1, len(y)):
        gap = max(float(x[i] - x[i - 1]), 1.0)
        transition = np.array([[1.0, gap], [0.0, 1.0]]) if linear else np.eye(2)
        process = np.diag([(obs_scale * 0.08 * np.sqrt(gap)) ** 2, (obs_scale * 0.015 * np.sqrt(gap)) ** 2 if linear else 1e-12])
        state = transition @ np.array([level, slope])
        covariance = transition @ covariance @ transition.T + process
        innovation = float(y[i] - state[0])
        innovation = float(np.clip(innovation, -3.0 * obs_scale, 3.0 * obs_scale))
        gain = covariance[:, 0] / max(covariance[0, 0] + observation_var, 1e-12)
        state = state + gain * innovation
        covariance = covariance - np.outer(gain, covariance[0, :])
        level, slope = float(state[0]), float(state[1]) if linear else 0.0
    return np.array([level, slope, float(x[-1]), 1.0 if linear else 0.0], dtype=float)


def kalman_predict(coef, target):
    level, slope, last_x, linear = [float(value) for value in coef]
    h = np.maximum(np.asarray(target, dtype=float) - last_x, 0.0)
    return level + (slope * h if linear else np.zeros_like(h))


# 模型注册表：fit/predict 函数对
MODELS = {
    'linear': (linear_fit, linear_predict),
    'poly2': (poly2_fit, poly2_predict),
    'huber': (huber_fit, huber_predict),
    'damped': (damped_fit, damped_predict),
    'ets_damped_trend': (ets_damped_fit, ets_damped_predict),
    'robust_quantile_trend': (quantile_trend_fit, quantile_trend_predict),
    'kalman_local_level': (lambda x, y: kalman_fit(x, y, False), kalman_predict),
    'kalman_local_linear': (lambda x, y: kalman_fit(x, y, True), kalman_predict),
}
