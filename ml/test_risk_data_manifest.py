# -*- coding: utf-8 -*-
"""验证风险模型数据血缘清单与磁盘派生数据一致。"""
import hashlib
import json
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent
MANIFEST = json.loads((ROOT / 'risk_data_manifest.json').read_text(encoding='utf-8'))


def sha256(path):
    h = hashlib.sha256()
    with path.open('rb') as fh:
        for block in iter(lambda: fh.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def main():
    failures = []
    source_path = Path(MANIFEST['source']['path'])
    if source_path.exists() and sha256(source_path).lower() != MANIFEST['source']['sha256'].lower():
        failures.append('raw source sha256 mismatch')
    for item in MANIFEST['artifacts']:
        path = ROOT.parent / item['path']
        if not path.exists():
            failures.append(f"missing: {item['path']}")
            continue
        frame = pd.read_csv(path)
        target = item['target']
        positive = int((pd.to_numeric(frame[target], errors='coerce') == 1).sum())
        checks = {
            'sha256': sha256(path).lower() == item['sha256'].lower(),
            'n_total': len(frame) == item['n_total'],
            'n_positive': positive == item['n_positive'],
        }
        if not all(checks.values()):
            failures.append(f"{item['disease']}/{item['pipeline']}: {checks}")
    result = {'pass': not failures, 'manifest_id': MANIFEST['manifest_id'], 'artifacts': len(MANIFEST['artifacts']), 'failures': failures}
    print(json.dumps(result, ensure_ascii=False, indent=2))
    raise SystemExit(0 if result['pass'] else 1)


if __name__ == '__main__':
    main()
