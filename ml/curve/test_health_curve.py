# -*- coding: utf-8 -*-
"""
test_health_curve.py — 曲线拟合与趋势分析测试（Phase 2.5）

运行: <venv>/python.exe ml/curve/test_health_curve.py
覆盖: 稳定/上升/下降/单次异常/数据不足/长升近降/长降近升/缺失值/无序时间/
      重复时间/极端异常值/多指标/forecast
"""
import json
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

from curve_utils import FoldLocalPipeline, parse_points, dedup_time, clean_series, time_ordered_split, model_metrics
from health_curve import _backtest, _rows, analyze

PASS, FAIL = 0, 0


def ok(name, cond, detail=''):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f'  ✅ {name}')
    else:
        FAIL += 1
        print(f'  ❌ {name} {detail}')


def iso(days_ago, h=8):
    d = datetime.now(timezone.utc) - timedelta(days=days_ago)
    return d.replace(hour=h, minute=0, second=0, microsecond=0).isoformat()


def pts(vals, days=None):
    days = days or list(range(len(vals) - 1, -1, -1))
    return [{'t': iso(d), 'v': v} for v, d in zip(vals, days)]


print('=== 1. 稳定数据 ===')
r = analyze('systo', 'mmHg', pts([128, 129, 127, 128, 130, 128, 129, 127, 128, 129, 128, 127], range(11, -1, -1)))
ok('status=ok', r['status'] == 'ok', str(r.get('status')))
ok('趋势 stable', r['long_term_trend'] == 'stable', r['long_term_trend'])
ok('abnormal_spike=false', r['abnormal_spike'] is False)

print('=== 2. 持续上升 ===')
r = analyze('systo', 'mmHg', pts([120, 122, 124, 126, 128, 130, 132, 134, 136, 138, 140, 142]))
ok('long_term_trend=rising', r['long_term_trend'] == 'rising', r['long_term_trend'])
ok('latest>previous', r['latest_value'] > r['previous_value'])

print('=== 3. 持续下降 ===')
r = analyze('systo', 'mmHg', pts([150, 147, 145, 142, 140, 138, 135, 132, 130, 128, 125, 122]))
ok('long_term_trend=falling', r['long_term_trend'] == 'falling', r['long_term_trend'])

print('=== 4. 单次异常点 ===')
# 128,130,129,210,131,132 → 不得判为持续强上升
r = analyze('systo', 'mmHg', pts([128, 130, 129, 210, 131, 132], range(5, -1, -1)))
ok('异常点被标记', r['abnormal_spike'] is True, str(r['abnormal_spike']))
ok('趋势非强上升（stable/weak 均可，不得 strong rising）',
   not (r['long_term_trend'] == 'rising' and r['trend_strength'] == 'strong'),
   f"{r['long_term_trend']}/{r['trend_strength']}")

print('=== 5. 数据不足 ===')
r = analyze('systo', 'mmHg', pts([128, 130, 129]))
ok('insufficient_data', r['status'] == 'insufficient_data', r.get('status'))

print('=== 6. 长期上升近期下降 ===')
vals = [115, 118, 121, 124, 127, 130, 133, 136, 139, 142, 139, 134]
r = analyze('systo', 'mmHg', pts(vals))
ok('long_term=rising', r['long_term_trend'] == 'rising', r['long_term_trend'])
ok('recent=falling', r['recent_trend'] == 'falling', f"recent={r['recent_trend']}")

print('=== 7. 长期下降近期上升 ===')
vals = [148, 145, 142, 139, 136, 133, 130, 127, 124, 120, 126, 130]
r = analyze('systo', 'mmHg', pts(vals))
ok('long_term=falling', r['long_term_trend'] == 'falling', r['long_term_trend'])
ok('recent=rising', r['recent_trend'] == 'rising', f"recent={r['recent_trend']}")

print('=== 8. 缺失值（null 点被忽略）===')
raw = [{'t': iso(d), 'v': v if d % 3 != 1 else None} for d, v in enumerate([128, 129, 130, 131, 132, 133, 134, 135])]
r = analyze('systo', 'mmHg', raw)
ok('有效日不足时只保留观测点', r['status'] == 'insufficient_data', r.get('status'))

print('=== 9. 无序时间（自动升序）===')
r = analyze('systo', 'mmHg', pts([132, 128, 134, 130, 136, 126, 138], [6, 2, 5, 1, 4, 0, 3]))
ok('时间已排序且可分析', r['status'] == 'ok', r.get('status'))

print('=== 10. 重复时间（取均值）===')
raw = [{'t': iso(1), 'v': 128}, {'t': iso(1), 'v': 132}, {'t': iso(2), 'v': 130}]
ts, vs = parse_points(raw)
ts, vs = dedup_time(ts, vs)
ok('重复时间合并为均值', len(vs) == 2 and abs(vs[0] - 130) < 1e-6, str(vs))

print('=== 11. 极端异常值（MAD 清洗后仍可拟合）===')
vals = [128, 129, 127, 128, 999, 126, 128, 127, 129, 128]
r = analyze('systo', 'mmHg', pts(vals))
ok('医学范围外值标记为 measurement_error', bool(r['measurement_error_indices']) and r['abnormal_spike'] is False, str(r))
ok('清洗后趋势稳定', r['long_term_trend'] == 'stable', r['long_term_trend'])

print('=== 12. 多指标（逐指标分析，无数据指标 insufficient）===')
r_glu = analyze('glucose', 'mmol/L', pts([5.4, 5.6, 5.5, 5.7, 5.6, 5.8, 5.5, 5.7]))
r_empty = analyze('hbalc', '%', [])
ok('glucose 可分析', r_glu['status'] == 'ok')
ok('hbalc 无数据 → insufficient_data', r_empty['status'] == 'insufficient_data', r_empty.get('status'))

print('=== 13. forecast ===')
r = analyze('systo', 'mmHg', pts([120 + int(i * 0.6) for i in range(35)],
                                 days=list(range(34, -1, -1))), forecast_days=7)
ok('forecast.available=true', r['forecast']['available'] is True, str(r['forecast']))
ok('estimated_value 合理（>latest）', r['forecast']['estimated_value'] is not None and r['forecast']['estimated_value'] > r['latest_value'],
   str(r['forecast']))
ok('curve 三数组齐全', len(r['curve']['timestamps']) == len(r['curve']['actual']) == len(r['curve']['fitted']))

print('=== 14. 条件分组 ===')
glu = []
for i in range(30):
    glu.append({'t': iso(35 - i), 'v': 5.2 + i * 0.01, 'condition': 'fasting'})
r = analyze('glucose', 'mmol/L', glu, forecast_days=7, condition_group='fasting')
ok('30天记录在严格选择/独立校准不足时拒绝', r['forecast']['available'] is False and r['forecast']['reason_code'] in {'NO_STABLE_MODEL', 'INSUFFICIENT_CALIBRATION_RESIDUALS'}, str(r['forecast']))
r = analyze('glucose', 'mmol/L', [dict(p, condition='unknown') for p in glu], forecast_days=7, condition_group='unknown')
ok('未标记血糖不混合预测', r['forecast']['available'] is False and r['forecast']['reason_code'] == 'MEASUREMENT_CONDITION_NOT_READY', str(r['forecast']))

print('=== 15. conservative forecast gate ===')
r = analyze('systo', 'mmHg', pts([120, 122, 124, 126, 128, 130, 132, 134, 136, 138]), forecast_days=30)
ok('跨度不足不预测', r['forecast']['available'] is False and '14天' in r['forecast']['reason'],
   str(r['forecast']))

print('=== 16. 脉压只展示历史趋势 ===')
r = analyze('pulse_pressure', 'mmHg', pts([42, 43, 41, 44, 45, 43, 44, 46, 45, 44]))
ok('脉压可形成历史趋势', r['status'] == 'ok' and r['eligibility']['trend'] is True, str(r.get('status')))
ok('脉压不进行未来数值外推', r['forecast']['available'] is False and r['metric_policy']['forecast'] is False, str(r['forecast']))

print('=== CLI 管道测试 ===')
payload = json.dumps({'metric': 'systo', 'unit': 'mmHg', 'points': pts([128, 129, 127, 128, 130, 128, 129, 127, 128, 129])})
proc = subprocess.run([sys.executable, str(Path(__file__).parent / 'health_curve.py')],
                      input=payload, capture_output=True, text=True, encoding='utf-8')
try:
    cli = json.loads(proc.stdout)
    ok('CLI 返回合法 JSON 且 success', cli.get('success') is True, proc.stdout[:120])
    ok('CLI 无 traceback', 'Traceback' not in proc.stdout + proc.stderr)
except json.JSONDecodeError:
    ok('CLI 返回合法 JSON', False, proc.stdout[:120])

print('=== 17. fold-local：末尾未来极端点不改变更早 origin ===')
start = datetime(2026, 1, 1, 8, tzinfo=timezone.utc)
base_points = [{'t': (start + timedelta(days=i)).isoformat(), 'v': 120 + i * 0.4, 'condition': 'morning_rest'} for i in range(42)]
future_points = base_points + [{'t': (start + timedelta(days=60)).isoformat(), 'v': 999, 'condition': 'morning_rest'}]
base_bt = _backtest(_rows(base_points, 'systo'), 'systo')
future_bt = _backtest(_rows(future_points, 'systo'), 'systo')
base_audit = {row['origin_day']: row for row in base_bt['selection_fold_audit'] + base_bt['calibration_fold_audit']}
future_audit = {row['origin_day']: row for row in future_bt['selection_fold_audit'] + future_bt['calibration_fold_audit']}
shared = sorted(set(base_audit) & set(future_audit))
ok('存在可比较的共同历史折', bool(shared))
ok('共同 origin 的清洗结果与预测完全一致', all(base_audit[day]['train_clean_values'] == future_audit[day]['train_clean_values'] and base_audit[day]['predicted'] == future_audit[day]['predicted'] for day in shared))

print('=== 18. 连续水平迁移保留为 change_point ===')
shift_points = [{'t': (start + timedelta(days=i)).isoformat(), 'v': 120 + (30 if i >= 10 else 0), 'condition': 'morning_rest'} for i in range(15)]
shift_result = analyze('systo', 'mmHg', shift_points)
ok('连续迁移被标记 change_point', shift_result['change_point'] is True, str(shift_result.get('change_point_indices')))
ok('连续迁移点没有全部删除', shift_result['data_points'] >= 14, str(shift_result['data_points']))

print('=== 19. 模型选择集与校准集不重叠 ===')
bt = _backtest(_rows(base_points, 'systo'), 'systo')
ok('selection/calibration origin 不重叠', set(bt['selection_origin_indices']).isdisjoint(bt['calibration_origin_indices']))
ok('选择目标严格早于校准 origin', bt['selection_target_before_calibration'] is True, str(bt))

print('=== 20. 不同测量条件不混合 ===')
mixed_glucose = []
for i in range(30):
    mixed_glucose.append({'t': (start + timedelta(days=i)).isoformat(), 'v': 5.2 + i * 0.01, 'condition': 'fasting' if i % 2 == 0 else 'random'})
mixed_result = analyze('glucose', 'mmol/L', mixed_glucose)
ok('混合条件结构化拒绝', mixed_result['forecast']['reason_code'] == 'MIXED_MEASUREMENT_CONDITIONS', str(mixed_result['forecast']))
fasting_result = analyze('glucose', 'mmol/L', mixed_glucose, condition_group='fasting')
ok('显式组只保留 fasting', fasting_result['measurement_groups'] == ['glucose:fasting'], str(fasting_result.get('measurement_groups')))
bp_mixed = []
for i in range(30):
    bp_mixed.append({'t': (start + timedelta(days=i)).isoformat(), 'v': 125 + i * 0.05, 'posture': 'seated' if i % 2 == 0 else 'standing', 'measurement_period': 'morning', 'device_source': 'home_cuff_a', 'repeat_status': 'confirmed'})
bp_mixed_result = analyze('systo', 'mmHg', bp_mixed)
ok('血压姿势不同不混合', bp_mixed_result['forecast']['reason_code'] == 'MIXED_MEASUREMENT_CONDITIONS', str(bp_mixed_result['forecast']))
pulse_result = analyze('pulse', 'bpm', [dict(point, v=68 + i * 0.02, condition='resting') for i, point in enumerate(base_points[:30])], condition_group='resting')
ok('pulse 仅 resting 组可进入预测策略', pulse_result.get('selected_measurement_group') == 'pulse:resting', str(pulse_result.get('selected_measurement_group')))
weight_result = analyze('weight', 'kg', [dict(point, v=70 + i * 0.01, condition='morning_similar_clothing') for i, point in enumerate(base_points[:30])], condition_group='morning_similar_clothing')
ok('weight 使用晨起相近衣着组', weight_result.get('selected_measurement_group') == 'weight:morning_similar_clothing', str(weight_result.get('selected_measurement_group')))

print('=== 21. 医学边界保留原始预测并标记 ===')
boundary_points = [{'t': (start + timedelta(days=i)).isoformat(), 'v': 100 + 4 * i, 'condition': 'morning_rest'} for i in range(35)]
boundary_result = analyze('systo', 'mmHg', boundary_points, forecast_days=7)
ok('boundary_hit=true', boundary_result['forecast']['available'] and boundary_result['forecast']['boundary_hit'] is True, str(boundary_result['forecast']))
ok('保留越界原始预测并限制展示值', max(boundary_result['forecast']['unclipped_prediction']) > 260 and max(boundary_result['forecast']['curve']['predicted']) <= 260 and bool(boundary_result['forecast']['safety_message']))

print('=== 22. 时区与夏令时不改变本地日期分组 ===')
dst_points = [
    {'t': '2026-11-01T01:30:00-04:00', 'v': 70, 'condition': 'morning_similar_clothing', 'timezone': 'America/New_York'},
    {'t': '2026-11-01T01:30:00-05:00', 'v': 72, 'condition': 'morning_similar_clothing', 'timezone': 'America/New_York'},
]
dst_rows = _rows(dst_points, 'weight')
dst_daily = FoldLocalPipeline('weight')._daily(dst_rows)
ok('DST 重复小时仍属于同一测量日', len(dst_daily) == 1 and dst_daily[0]['local_day'] == '2026-11-01', str(dst_daily))

print(f'\n结果: {PASS} 通过 / {FAIL} 失败')
sys.exit(0 if FAIL == 0 else 1)
