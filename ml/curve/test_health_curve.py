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

from curve_utils import parse_points, dedup_time, clean_series, time_ordered_split, model_metrics
from health_curve import analyze

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
ok('极端值被标记', r['abnormal_spike'] is True, str(r['abnormal_spike']))
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
ok('空腹血糖可按条件预测', r['forecast']['available'] is True, str(r['forecast']))
r = analyze('glucose', 'mmol/L', [dict(p, condition='unknown') for p in glu], forecast_days=7, condition_group='unknown')
ok('未标记血糖不混合预测', r['forecast']['available'] is False and 'unknown' in r['forecast']['reason'], str(r['forecast']))

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

print(f'\n结果: {PASS} 通过 / {FAIL} 失败')
sys.exit(0 if FAIL == 0 else 1)
