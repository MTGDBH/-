# -*- coding: utf-8 -*-
"""Render the real-data quality dashboard without creating or imputing records."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from validate_external_dataset import validate


def _fmt(value):
    return 'NA' if value is None else f'{100 * value:.2f}%'


def render(result: dict) -> str:
    dashboard = result['quality_dashboard']
    lines = [
        '# 真实纵向数据质量看板', '',
        f"状态：`{dashboard['status']}`；schema：`{result['schema_version']}`。", '',
        '> 本看板只汇总输入文件；不补测、不插值、不生成记录。NA 表示尚无数据或分母为零。', '',
        '## 总览', '',
        '| 记录 | 参与者 | 站点 | 有值记录 | 计划缺测行 | 计划行缺测率 | 条件字段缺失率 | 单位异常 | 重复键 |',
        '|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
        f"| {result['n_rows']} | {result['participants']} | {result['sites']} | {result['observed_rows']} | "
        f"{result['missing_schedule_rows']} | {_fmt(dashboard['overall_scheduled_row_missing_rate'])} | "
        f"{_fmt(dashboard['condition_field_missing_rate'])} | {dashboard['unit_anomalies']['count']} | "
        f"{dashboard['duplicates']['duplicate_keys']} |", '',
        '## 每人有效日', '',
        '| participant_id | site_id | 日历跨度 | 有效日 | 计划行 | 缺测行 | 计划行缺测率 | 各指标有效日 |',
        '|---|---|---:|---:|---:|---:|---:|---|',
    ]
    for participant_id, row in dashboard['per_participant_valid_days'].items():
        by_metric = ', '.join(f'{key}:{value}' for key, value in row['valid_days_by_metric'].items())
        lines.append(f"| {participant_id} | {row['site_id']} | {row['calendar_span_days']:.1f} | {row['valid_days']} | {row['scheduled_rows']} | "
                     f"{row['missing_schedule_rows']} | {_fmt(row['scheduled_row_missing_rate'])} | {by_metric or 'NA'} |")
    if not dashboard['per_participant_valid_days']:
        lines.append('| NA | NA | NA | NA | NA | NA | NA | NA |')
    lines += ['', '## 条件缺失率（metric × condition）', '',
              '| metric × condition | 计划行 | 缺测行 | 缺测率 |', '|---|---:|---:|---:|']
    for label, row in dashboard['missing_rate_by_metric_condition'].items():
        lines.append(f"| {label} | {row['rows']} | {row['missing_schedule_rows']} | {_fmt(row['scheduled_row_missing_rate'])} |")
    if not dashboard['missing_rate_by_metric_condition']:
        lines.append('| NA | 0 | 0 | NA |')
    lines += ['', '## 设备分布', '', '| device_id | 记录 | 占比 |', '|---|---:|---:|']
    for device_id, row in dashboard['device_distribution'].items():
        lines.append(f"| {device_id} | {row['rows']} | {_fmt(row['row_fraction'])} |")
    if not dashboard['device_distribution']:
        lines.append('| NA | 0 | NA |')
    lines += ['', '## 站点差异', '',
              '| site_id | 参与者 | 记录 | 有效记录 | 每人有效日 min/median/max | 计划行缺测率 | 条件字段缺失率 |',
              '|---|---:|---:|---:|---|---:|---:|']
    for site_id, row in dashboard['site_differences'].items():
        days = row['valid_days_per_participant']
        lines.append(f"| {site_id} | {row['participants']} | {row['rows']} | {row['valid_rows']} | "
                     f"{days['minimum']}/{days['median']}/{days['maximum']} | {_fmt(row['scheduled_row_missing_rate'])} | "
                     f"{_fmt(row['condition_field_missing_rate'])} |")
    if not dashboard['site_differences']:
        lines.append('| NA | 0 | 0 | 0 | NA/NA/NA | NA | NA |')
    lines += ['', '## 单位异常与重复记录', '',
              f"- 单位异常记录数：`{dashboard['unit_anomalies']['count']}`。",
              f"- 重复键数：`{dashboard['duplicates']['duplicate_keys']}`；超额重复行：`{dashboard['duplicates']['excess_rows']}`。",
              '', '## 口径限制', '',
              f"- 有效日：{dashboard['definitions']['valid_day']}。",
              f"- 缺测率：{dashboard['definitions']['missing_rate']}。",
              '- 若采集系统没有为应测但未测的时点写入空值计划行，本看板会低估缺测；必须由站点按采集计划补齐缺测状态行，不能补造测量值。',
              '- device_id 是去标识化设备实例，不等同于厂商/型号；跨型号分析需机构另提供合规的设备型号字典。']
    return '\n'.join(lines) + '\n'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('csv', type=Path)
    parser.add_argument('--out-json', type=Path, required=True)
    parser.add_argument('--out-md', type=Path, required=True)
    args = parser.parse_args()
    result = validate(args.csv)
    args.out_json.parent.mkdir(parents=True, exist_ok=True)
    args.out_md.parent.mkdir(parents=True, exist_ok=True)
    args.out_json.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    args.out_md.write_text(render(result), encoding='utf-8')
    print(json.dumps({'valid': result['valid'], 'json': str(args.out_json.resolve()),
                      'markdown': str(args.out_md.resolve())}, ensure_ascii=False))


if __name__ == '__main__':
    main()
