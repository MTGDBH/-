# -*- coding: utf-8 -*-
"""Offline six-way retrieval evaluation with explicit ranking metrics.

Relevance is a reproducible engineering qrel derived from the pre-existing
golden question disease scope and must-have evidence concepts. It is not an
external clinical relevance judgment.
"""
from __future__ import annotations

import argparse
from collections import defaultdict
from datetime import date
import json
import math
from pathlib import Path
import statistics
import sys

from retrieval_backends import HybridRetrievalPipeline, JsonGraphStore, filter_documents

if hasattr(sys.stdout, 'reconfigure'): sys.stdout.reconfigure(encoding='utf-8')

ROOT = Path(__file__).parent
REPORTS = ROOT.parent / 'reports'
DEFAULT_CONFIG = ROOT / 'eval' / 'retrieval_methods_config.json'
URGENT_TERMS = ('急救', '危险信号', '单侧无力', '言语不清', '胸痛', '呼吸困难', '意识改变', '叫不醒')


def load_json(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def relevance_ids(documents, case):
    terms = case.get('must_have_any') or ([case.get('must_have')] if case.get('must_have') else [])
    scoped = filter_documents(documents, {'disease': case.get('disease'), 'audience': 'elderly'})
    return {row['id'] for row in scoped if any(term and term in f"{row.get('section', '')} {row.get('text', '')}" for term in terms)}


def dcg(relevances):
    return sum(value / math.log2(index + 2) for index, value in enumerate(relevances))


def query_metrics(results, relevant, case):
    ranked = [row['id'] for row in results]
    relevant_count = max(1, len(relevant))
    metrics = {f'recall@{k}': len(set(ranked[:k]) & relevant) / relevant_count for k in (1, 3, 5, 10)}
    first = next((index for index, chunk_id in enumerate(ranked, 1) if chunk_id in relevant), None)
    metrics['mrr'] = 1 / first if first else 0.0
    gains = [1 if chunk_id in relevant else 0 for chunk_id in ranked[:10]]
    ideal = [1] * min(len(relevant), 10)
    metrics['ndcg@10'] = dcg(gains) / max(dcg(ideal), 1e-9)
    metrics['evidence_coverage'] = 1.0 if set(ranked[:10]) & relevant else 0.0
    metrics['irrelevant_evidence_rate'] = sum(chunk_id not in relevant for chunk_id in ranked[:10]) / max(1, len(ranked[:10]))
    urgent_hit = any(any(term in f"{row.get('section', '')} {row.get('text', '')}" for term in URGENT_TERMS) for row in results[:10])
    metrics['urgent_expected'] = bool(case.get('urgent'))
    metrics['urgent_hit'] = urgent_hit if case.get('urgent') else None
    metrics['citation_valid_rate'] = sum(bool(row.get('source_url', '').startswith('http')) for row in results[:10]) / max(1, len(results[:10]))
    return metrics


def aggregate(rows):
    numeric = ('recall@1', 'recall@3', 'recall@5', 'recall@10', 'mrr', 'ndcg@10', 'evidence_coverage', 'irrelevant_evidence_rate', 'citation_valid_rate')
    summary = {key: sum(row[key] for row in rows) / max(1, len(rows)) for key in numeric}
    urgent = [row for row in rows if row['urgent_expected']]
    summary['urgent_recall_rate'] = sum(row['urgent_hit'] is True for row in urgent) / max(1, len(urgent))
    latencies = sorted(row['latency_ms'] for row in rows)
    summary['average_latency_ms'] = statistics.fmean(latencies) if latencies else 0.0
    summary['p95_latency_ms'] = latencies[min(len(latencies) - 1, math.ceil(len(latencies) * 0.95) - 1)] if latencies else 0.0
    return {key: round(value, 6) for key, value in summary.items()}


def main(config_path=DEFAULT_CONFIG):
    config = load_json(config_path)
    chunks = load_json(ROOT / 'output' / 'chunks.json')
    entities = load_json(ROOT / 'output' / 'entities.json')
    relationships = load_json(ROOT / 'output' / 'relationships.json')
    stats = load_json(ROOT / 'output' / 'index_stats.json')
    cases = load_json(ROOT / 'eval' / 'golden_questions.json')
    vector_index = ROOT / config['vector_index']
    if not vector_index.exists():
        raise SystemExit(f"dense index missing: run `python graphrag_index.py build-retrieval-index --vector-model {config['vector_model']}`")
    graph_store = JsonGraphStore(entities, relationships)
    pipeline = HybridRetrievalPipeline(chunks, graph_store, config['vector_model'], vector_index,
                                       config['reranker_model'], config.get('rrf_k', 60))
    rows, stage_statuses = [], {}
    for method, flags in config['methods'].items():
        for case in cases:
            relevant = relevance_ids(chunks, case)
            result = pipeline.search(case['question'], top_k=config.get('top_k', 10), candidate_k=config.get('candidate_k', 40),
                filters={'audience': 'elderly', 'disease': case.get('disease')}, disease=case.get('disease'),
                use_lexical=flags['lexical'], use_vector=flags['vector'], use_graph=flags['graph'], use_reranker=flags['reranker'],
                max_hops=config['graph']['max_hops'], max_graph_nodes=config['graph']['max_nodes'], max_graph_edges=config['graph']['max_edges'])
            metrics = query_metrics(result['results'], relevant, case)
            rows.append({'case': case['id'], 'method': method, 'relevant_count': len(relevant), 'result_count': len(result['results']),
                         'latency_ms': result['latency_ms'], 'ranked_chunk_ids': [row['id'] for row in result['results']], **metrics})
            stage_statuses[method] = result['capabilities']
    summary = {method: aggregate([row for row in rows if row['method'] == method]) for method in config['methods']}
    report = {
        'schema_version': 'retrieval-method-comparison.v2', 'generated_at': str(date.today()),
        'index_version': stats['index_version'], 'qrel_policy': 'golden disease scope + pre-registered must-have evidence concepts',
        'models': {'vector_model': config['vector_model'], 'vector_implementation': pipeline.vector.status.implementation,
                   'reranker_model': config['reranker_model'], 'reranker_implementation': pipeline.reranker.status.implementation},
        'method_labels': config['labels'], 'stage_statuses': stage_statuses, 'summary': summary, 'rows': rows,
        'limitations': ['工程 qrel 来自既有黄金集，不是外部临床标注',
                        'hashing_char_ngram_v1 是可复现稠密向量基线，不是学习型语义 embedding',
                        '安装本地 SentenceTransformers 模型后必须重新构建索引和复跑评测，不能沿用本报告'],
    }
    REPORTS.mkdir(exist_ok=True)
    json_path = REPORTS / 'graphrag-method-comparison-20260826.json'
    json_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    headers = ['method', 'R@1', 'R@3', 'R@5', 'R@10', 'MRR', 'nDCG@10', 'coverage', 'irrelevant', 'urgent', 'citation', 'avg ms', 'P95 ms']
    lines = ['# 六路离线混合检索与图消融评测', '',
             f"索引：`{stats['index_version']}`；向量：`{config['vector_model']}`；重排：`{config['reranker_model']}`。", '',
             '> `dense_rag` 是真实余弦向量召回，但当前配置使用确定性 hashing 稠密基线，不冒充学习型语义模型。', '',
             '| ' + ' | '.join(headers) + ' |', '|' + '|'.join(['---'] + ['---:'] * (len(headers) - 1)) + '|']
    for method in config['methods']:
        row = summary[method]
        values = [method, row['recall@1'], row['recall@3'], row['recall@5'], row['recall@10'], row['mrr'], row['ndcg@10'],
                  row['evidence_coverage'], row['irrelevant_evidence_rate'], row['urgent_recall_rate'], row['citation_valid_rate'],
                  row['average_latency_ms'], row['p95_latency_ms']]
        lines.append('| ' + ' | '.join(str(value) for value in values) + ' |')
    lines += ['', '## 方法边界', '', '- BM25 是 lexical baseline。', '- dense RAG 仅使用配置的向量模型与余弦相似度。',
              '- BM25+dense 使用 RRF 融合排名，不相加原始分数。', '- full GraphRAG 在融合候选上执行有界图扩展，再执行重排。',
              '- graph_ablation 与完整管线配置相同，仅关闭图扩展。']
    (REPORTS / 'graphrag-method-comparison-20260826.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')
    print(json.dumps({'pass': True, 'report': str(json_path), 'summary': summary}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--config', default=str(DEFAULT_CONFIG)); args = parser.parse_args()
    main(Path(args.config))
