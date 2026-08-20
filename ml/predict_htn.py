# -*- coding: utf-8 -*-
"""
Phase 2.1: 高血压风险预测 Python Tool（Node.js 可调用的 CLI 封装）

用法（stdin 传 JSON，stdout 收 JSON，错误不输出 traceback）:
    echo '{"systo":130,"diasto":85,...}' | python ml/predict_htn.py

输入: 12 个特征（systo diasto pulse bmi mwaist lgrip rgrip
             bl_glu bl_hbalc bl_cho bl_ua sleep），允许 null（转 NaN）
输出: JSON { success, risk_probability, risk_percent, risk_level,
            threshold, calibration_method, model_version, warning, ... }

单位说明（与 CHARLS 训练数据一致）:
  bl_glu/bl_cho 单位为 mg/dl，bl_ua 单位为 mg/dl；
  APP 若以 mmol/L / μmol/L 存储，需在调用层换算后再传入。

风险等级仅为工程分层（模型阈值），不构成医学诊断。
"""
import json
import math
import pickle
import sys
from pathlib import Path

# ---------- 路径（项目相对，不写死盘符） ----------
HERE = Path(__file__).resolve().parent
MODEL_DIR = HERE / 'models' / 'htn_xgb'
MODEL_FILE = MODEL_DIR / 'candidate_model.json'
CALIB_FILE = MODEL_DIR / 'calibrator_isotonic.pkl'
PLATT_CALIB_FILE = MODEL_DIR / 'calibrator_platt.pkl'
THRESH_FILE = MODEL_DIR / 'threshold.json'
META_FILE = MODEL_DIR / 'candidate_metadata.json'

# ---------- 特征定义（顺序必须与训练一致） ----------
FEATURE_NAMES = ['systo', 'diasto', 'pulse', 'bmi', 'mwaist', 'lgrip', 'rgrip',
                 'bl_glu', 'bl_hbalc', 'bl_cho', 'bl_ua', 'sleep']

# 生理合理界限（超出即拒绝，与 build_dataset.py 一致；单位: 见上）
PHYSIO_BOUNDS = {
    'systo': (60, 260), 'diasto': (40, 150), 'pulse': (40, 150),
    'bmi': (10, 60), 'mwaist': (40, 160), 'lgrip': (0, 60), 'rgrip': (0, 60),
    'bl_glu': (20, 600), 'bl_hbalc': (3, 20), 'bl_cho': (20, 500),
    'bl_ua': (0, 20), 'sleep': (0, 16),
}

# ---------- 模型/校准器/阈值 惰性加载 ----------
_loaded = {}


def _load_artifacts():
    """加载模型、校准器、阈值和元数据（只加载一次）。"""
    if _loaded:
        return _loaded
    import xgboost as xgb

    model = xgb.XGBClassifier()
    model.load_model(str(MODEL_FILE))
    with open(THRESH_FILE, 'r', encoding='utf-8') as f:
        threshold = json.load(f)['recommended_threshold']
    with open(META_FILE, 'r', encoding='utf-8') as f:
        meta = json.load(f)
    calibration_method = meta.get('calibration', {}).get('selected', 'isotonic')
    if calibration_method == 'platt':
        # 阈值文件也是 Platt 概率尺度；缺文件时不能静默退回 Isotonic。
        if not PLATT_CALIB_FILE.exists():
            raise FileNotFoundError(f'缺少 Platt 校准器: {PLATT_CALIB_FILE}')
        calib_file = PLATT_CALIB_FILE
    else:
        calibration_method = 'isotonic'
        calib_file = CALIB_FILE
    with open(calib_file, 'rb') as f:
        calibrator = pickle.load(f)
    model_version = f"htn_xgb_{meta.get('dataset_version', 'v1')}_{meta.get('created_at', '')[:10]}"
    _loaded.update(model=model, calibrator=calibrator, threshold=float(threshold),
                   calibration_method=calibration_method, model_version=model_version,
                   meta=meta)
    return _loaded


def _validate(features):
    """
    输入校验。返回 (ok, err_msg_or_None)
    校验: 字段齐全 / 类型为数值或 null / 非 NaN/Inf / 生理范围
    """
    if not isinstance(features, dict):
        return False, '输入必须是 JSON 对象'
    unknown = set(features) - set(FEATURE_NAMES)
    if unknown:
        return False, f'未知字段: {sorted(unknown)}'
    missing = [f for f in FEATURE_NAMES if f not in features]
    if missing:
        return False, f'缺少字段: {missing}'
    for f in FEATURE_NAMES:
        v = features[f]
        if v is None:
            continue
        if isinstance(v, bool) or not isinstance(v, (int, float)):
            return False, f'字段 {f} 必须是数值或 null，收到: {type(v).__name__}'
        if math.isnan(v) or math.isinf(v):
            return False, f'字段 {f} 为 NaN/Infinity，不允许'
        lo, hi = PHYSIO_BOUNDS[f]
        if v < lo or v > hi:
            return False, f'字段 {f} 超出合理范围 [{lo}, {hi}]，收到: {v}'
    return True, None


def run_prediction(features):
    """
    核心函数: 特征 dict -> 结果 dict（错误时 success=false）
    任何异常都转为 JSON 错误，不抛出 traceback
    """
    try:
        ok, err = _validate(features)
        if not ok:
            return {'success': False, 'error': err}

        arts = _load_artifacts()
        model, calibrator = arts['model'], arts['calibrator']
        threshold = arts['threshold']

        # null -> NaN，固定特征顺序
        import numpy as np
        row = np.array([[float(features[f]) if features[f] is not None else np.nan
                         for f in FEATURE_NAMES]])
        assert list(model.get_booster().feature_names) == FEATURE_NAMES, '特征顺序与训练不一致!'

        raw_prob = float(model.predict_proba(row)[0, 1])
        if arts['calibration_method'] == 'platt':
            import numpy as np
            raw_logit = np.log(np.clip(raw_prob, 1e-6, 1 - 1e-6) /
                               np.clip(1 - raw_prob, 1e-6, 1))
            cal_prob = float(calibrator.predict_proba([[raw_logit]])[0, 1])
        else:
            cal_prob = float(calibrator.predict([raw_prob])[0])  # 兼容旧版 Isotonic
        cal_prob = max(0.0, min(1.0, cal_prob))

        risk_level = 'higher_than_threshold' if cal_prob >= threshold else 'lower_than_threshold'
        missing = [f for f in FEATURE_NAMES if features[f] is None]

        warn = ('该概率为 CHARLS 老年人群模型的工程参考，非医学诊断；'
                '血检字段单位: bl_glu/bl_cho/bl_ua 为 mg/dl。')
        if missing:
            warn += f' 以下指标缺失，结果仅供参考: {", ".join(missing)}。'

        return {
            'success': True,
            'risk_probability': round(cal_prob, 4),
            'risk_percent': round(cal_prob * 100, 1),
            'risk_level': risk_level,
            'threshold': threshold,
            'calibration_method': arts['calibration_method'],
            'model_version': arts['model_version'],
            'missing_features': missing,
            'warning': warn,
        }
    except Exception as e:  # 兜底: 绝不向 Node 吐 traceback
        return {'success': False, 'error': f'internal error: {type(e).__name__}: {e}'}


def main():
    raw = sys.stdin.buffer.read().decode('utf-8', errors='replace').strip()
    if not raw:
        out = {'success': False, 'error': 'stdin 为空，请输入 JSON'}
    else:
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError as e:
            out = {'success': False, 'error': f'JSON 解析失败: {e}'}
        else:
            out = run_prediction(payload)
    sys.stdout.buffer.write((json.dumps(out, ensure_ascii=False) + '\n').encode('utf-8'))


if __name__ == '__main__':
    main()
