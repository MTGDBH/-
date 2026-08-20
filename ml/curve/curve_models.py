# -*- coding: utf-8 -*-
"""
curve_models.py — 曲线拟合候选模型（纯 numpy，启动快、可解释）

候选方法（Phase 2.5）:
  1. Linear Regression            np.linalg.lstsq
  2. Polynomial Regression deg=2  np.polyfit
  3. HuberRegressor               IRLS M-估计（对异常值稳健）
  4. EWMA                         指数加权平滑（近期趋势参考，非预测模型）

禁止深度学习时间序列模型（LSTM/Transformer）。
"""
import numpy as np


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


# 模型注册表：fit/predict 函数对
MODELS = {
    'linear': (linear_fit, linear_predict),
    'poly2': (poly2_fit, poly2_predict),
    'huber': (huber_fit, huber_predict),
    'damped': (damped_fit, damped_predict),
}
