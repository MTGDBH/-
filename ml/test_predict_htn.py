# -*- coding: utf-8 -*-
"""
Phase 2.1: predict_htn.py 测试套件

覆盖:
  A. 完整 12 项
  B. 部分指标缺失（null）
  C. 合理边界值
  D. 非法字符串
  E. 缺少字段
  F. Infinity/NaN
  G. 模型重载后结果一致 + 3 次重复一致性
退出码: 全过 = 0，否则 = 1
"""
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import predict_htn as p  # noqa: E402

PASS, FAIL = 0, 0


def check(name, cond, detail=''):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f'  ✅ {name}')
    else:
        FAIL += 1
        print(f'  ❌ {name} {detail}')


VALID = {'systo': 130, 'diasto': 85, 'pulse': 72, 'bmi': 24.0, 'mwaist': 85,
         'lgrip': 25.0, 'rgrip': 27.0, 'bl_glu': 100.0, 'bl_hbalc': 5.6,
         'bl_cho': 200.0, 'bl_ua': 6.0, 'sleep': 7.0}

print('=== A. 完整 12 项 ===')
r = p.run_prediction(dict(VALID))
check('success=True', r.get('success') is True, str(r))
check('risk_probability 在 [0,1]', 0 <= r.get('risk_probability', -1) <= 1)
check('risk_percent = prob*100', abs(r.get('risk_percent') - r.get('risk_probability') * 100) < 0.2)
check('risk_level 合法', r.get('risk_level') in ('lower_than_threshold', 'higher_than_threshold'))
check('threshold 输出', isinstance(r.get('threshold'), float))
print('  输出:', json.dumps(r, ensure_ascii=False))

print('=== B. 部分指标缺失（null）===')
m = dict(VALID)
for k in ('bl_hbalc', 'bl_ua', 'sleep'):
    m[k] = None
r = p.run_prediction(m)
check('success=True 且缺失列表正确', r.get('success') is True and
      set(r.get('missing_features', [])) == {'bl_hbalc', 'bl_ua', 'sleep'}, str(r))
check('warning 提示缺失', '缺失' in r.get('warning', ''))
print('  输出:', json.dumps(r, ensure_ascii=False))

print('=== C. 合理边界值 ===')
low = dict(VALID, systo=90, diasto=60, bmi=18.5, bl_glu=70, sleep=4)
r = p.run_prediction(low)
check('低边界 success', r.get('success') is True, str(r))
high = dict(VALID, systo=200, diasto=110, bmi=35, bl_glu=300, sleep=10)
r = p.run_prediction(high)
check('高边界 success', r.get('success') is True, str(r))

print('=== D. 非法字符串 ===')
r = p.run_prediction(dict(VALID, systo='high'))
check('字符串被拒', r.get('success') is False and 'systo' in r.get('error', ''), str(r))
r = p.run_prediction(dict(VALID, bmi='abc'))
check('字符串被拒2', r.get('success') is False, str(r))

print('=== E. 缺少字段 ===')
r = p.run_prediction({k: v for k, v in VALID.items() if k != 'systo'})
check('缺字段被拒且指明', r.get('success') is False and 'systo' in r.get('error', ''), str(r))
r = p.run_prediction({})
check('空对象被拒', r.get('success') is False, str(r))

print('=== F. Infinity / NaN ===')
r = p.run_prediction(dict(VALID, systo=float('inf')))
check('Infinity 被拒', r.get('success') is False, str(r))
r = p.run_prediction(dict(VALID, bmi=float('nan')))
check('NaN 被拒', r.get('success') is False, str(r))

print('=== 生理范围越界 ===')
r = p.run_prediction(dict(VALID, systo=400))
check('systo=400 被拒', r.get('success') is False and '超出合理范围' in r.get('error', ''), str(r))
r = p.run_prediction(dict(VALID, bl_hbalc=30))
check('hba1c=30 被拒', r.get('success') is False, str(r))

print('=== G. 模型重载一致 + 3 次重复 ===')
# 3 次直接调用
probs = [p.run_prediction(dict(VALID))['risk_probability'] for _ in range(3)]
check('3 次调用概率一致', len(set(probs)) == 1, str(probs))
# CLI 子进程管线（echo | python predict_htn.py）
payload = json.dumps(VALID)
cli_script = Path(p.__file__).parent / 'predict_htn.py'
proc = subprocess.run([sys.executable, str(cli_script)], input=payload,
                      capture_output=True, text=True, encoding='utf-8')
cli_ok = proc.returncode == 0
try:
    cli = json.loads(proc.stdout)
except json.JSONDecodeError:
    cli = {'success': False, 'error': 'stdout 非 JSON'}
check('CLI 返回合法 JSON', cli_ok and cli.get('success') is True, f'rc={proc.returncode} out={proc.stdout[:100]}')
check('CLI 与直接调用一致', cli_ok and abs(cli.get('risk_probability', -1) - probs[0]) < 1e-6, str(cli))
# 错误输入走 CLI 不吐 traceback
proc_err = subprocess.run([sys.executable, str(cli_script)], input=json.dumps({'systo': 'bad'}),
                          capture_output=True, text=True, encoding='utf-8')
try:
    err = json.loads(proc_err.stdout)
except json.JSONDecodeError:
    err = {'success': False, 'error': 'stdout 非 JSON'}
check('CLI 错误输入返回 JSON 错误且无 traceback',
      err.get('success') is False and 'traceback' not in (proc_err.stdout + proc_err.stderr).lower(), proc_err.stderr[:100])

print(f'\n结果: {PASS} 通过 / {FAIL} 失败')
sys.exit(0 if FAIL == 0 else 1)
