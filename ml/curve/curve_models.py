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
        w = np.where(np.abs(r) <= delta * scale, 1.0, np.clip((delta * scale) / np.abs(r), 0.0, 1e9))
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


# 模型注册表：fit/predict 函数对
MODELS = {
    'linear': (linear_fit, linear_predict),
    'poly2': (poly2_fit, poly2_predict),
    'huber': (huber_fit, huber_predict),
}
