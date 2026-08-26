# -*- coding: utf-8 -*-
"""Automated contracts for BM25/dense/RRF/graph/reranker and structured fallback."""
from __future__ import annotations

import json
from pathlib import Path

from retrieval_backends import DenseVectorRetriever, HybridRetrievalPipeline, JsonGraphStore, rrf_fuse

ROOT = Path(__file__).parent
OUTPUT = ROOT / 'output'


def main():
    chunks = json.loads((OUTPUT / 'chunks.json').read_text(encoding='utf-8'))
    entities = json.loads((OUTPUT / 'entities.json').read_text(encoding='utf-8'))
    relationships = json.loads((OUTPUT / 'relationships.json').read_text(encoding='utf-8'))
    dense_index = OUTPUT / 'dense_index.json'
    if not dense_index.exists(): DenseVectorRetriever.build_index(chunks, dense_index)
    store = JsonGraphStore(entities, relationships)

    full = HybridRetrievalPipeline(chunks, store, 'hashing_char_ngram_v1', dense_index, 'local_linear_v1')
    result = full.search('血压连续偏高怎么复测', 10, 10, filters={'audience': 'elderly', 'disease': 'hypertension'},
                         disease='hypertension', use_lexical=True, use_vector=True, use_graph=True, use_reranker=True,
                         max_hops=2, max_graph_nodes=30, max_graph_edges=40)
    assert result['results']
    assert result['capabilities']['backend'] == 'full_hybrid'
    assert all(result['capabilities']['stages'][stage]['active'] for stage in ('lexical', 'vector', 'graph', 'reranker'))
    required_metadata = {'source_id', 'chunk_id', 'source_version', 'review_status', 'retrieved_at', 'evidence_level'}
    required_scores = {'lexical_score', 'vector_score', 'graph_score', 'rerank_score', 'final_rank'}
    assert all(required_metadata <= set(row) and required_scores == set(row['stage_scores']) for row in result['results'])
    assert all(row['disease'] == 'hypertension' for row in result['results'])
    assert [row['stage_scores']['final_rank'] for row in result['results']] == list(range(1, len(result['results']) + 1))

    provenance = result['graph']['seed_provenance']
    valid_seeds = store.seed_entities(provenance['retrieved_chunk_ids'], 'hypertension')
    assert set(result['graph']['seed_entities']) <= valid_seeds
    assert len(result['graph']['edges']) <= 40 and len(result['graph']['expanded_nodes']) + len(result['graph']['seed_entities']) <= 30
    assert all(edge['hop'] <= 2 for edge in result['graph']['edges'])

    # RRF depends on rank only: incomparable raw score magnitudes cannot change fusion.
    left = [{'chunk_id': 'a', 'score': 1000000}, {'chunk_id': 'b', 'score': 1}]
    right = [{'chunk_id': 'b', 'score': 0.9}, {'chunk_id': 'a', 'score': 0.8}]
    scaled = [{'chunk_id': 'a', 'score': 0.00001}, {'chunk_id': 'b', 'score': -999}]
    assert rrf_fuse([left, right]) == rrf_fuse([scaled, right])

    missing = HybridRetrievalPipeline(chunks, store, str(ROOT / 'missing-vector-model'), dense_index, str(ROOT / 'missing-reranker'))
    degraded = missing.search('血压怎么复测', 5, 10, filters={'disease': 'hypertension'}, disease='hypertension',
                              use_lexical=True, use_vector=True, use_graph=True, use_reranker=True)
    assert degraded['capabilities']['vector'] is False and degraded['capabilities']['reranker'] is False
    assert {row['stage'] for row in degraded['capabilities']['degradations']} == {'vector', 'reranker'}
    assert degraded['capabilities']['stages']['vector']['fallback_reason'] == 'vector_model_path_missing'

    filtered = full.search('血压', 10, 20, filters={'audience': 'doctor', 'disease': 'hypertension', 'published_after': 2025},
                           disease='hypertension', use_lexical=True, use_vector=False, use_graph=False, use_reranker=False)
    assert all(int(row['publication_year']) >= 2025 for row in filtered['results'])
    review_status = next(row['review_status'] for row in chunks if row.get('review_status'))
    review_filtered = full.search('健康', 10, 40, filters={'audience': 'doctor', 'review_status': review_status},
                                  use_lexical=True, use_vector=False, use_graph=False, use_reranker=False)
    assert review_filtered['results'] and all(row['review_status'] == review_status for row in review_filtered['results'])
    date_window = full.search('健康', 10, 40, filters={'audience': 'doctor', 'published_after': 2024, 'published_before': 2025},
                              use_lexical=True, use_vector=False, use_graph=False, use_reranker=False)
    assert all(2024 <= int(row['publication_year']) <= 2025 for row in date_window['results'])
    ablated = full.search('血压', 5, 10, filters={'disease': 'hypertension'}, disease='hypertension',
                          use_lexical=True, use_vector=True, use_graph=False, use_reranker=True)
    assert ablated['capabilities']['stages']['graph']['active'] is False

    print(json.dumps({'passed': True, 'results': len(result['results']), 'graph_seeds': len(result['graph']['seed_entities']),
                      'graph_edges': len(result['graph']['edges']), 'degradations_checked': 2}, ensure_ascii=False))


if __name__ == '__main__': main()
