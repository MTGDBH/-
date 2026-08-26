# -*- coding: utf-8 -*-
"""Offline hybrid retrieval stages for the auditable GraphRAG index.

No network access is performed. Learned models must already exist on disk. The
built-in hashing model is an explicit deterministic dense baseline, not a
semantic embedding model and is never reported as one.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from collections import Counter, defaultdict, deque
from dataclasses import asdict, dataclass, field
import hashlib
import json
import math
from pathlib import Path
import re
import time

TOKEN_RE = re.compile(r'[a-zA-Z]{2,}|[0-9]+(?:\.[0-9]+)?|[\u4e00-\u9fff]')
DEFAULT_RELATION_TYPES = {
    'measured_by', 'monitoring_signal', 'coexists_with', 'has_risk_factor',
    'has_nonmodifiable_factor', 'associated_with', 'predictive_factor_in_older_adults',
    'requires_remeasurement', 'urgent_signal', 'emergency_action', 'contextual_factor',
    'requires_medical_review', 'requires_clinician_review', 'supportive_evidence',
}
DEFAULT_NODE_TYPES = {'disease', 'metric', 'measurement', 'risk_factor', 'symptom', 'complication', 'population', 'care_action', 'intervention', 'behavior'}


def lexical_tokens(text):
    raw = ''.join(str(text or '').lower().split())
    tokens = TOKEN_RE.findall(raw)
    han = ''.join(x for x in raw if '\u4e00' <= x <= '\u9fff')
    tokens.extend(han[i:i + 2] for i in range(max(0, len(han) - 1)))
    return tokens


def document_text(document):
    # Repeating the short title is an explicit field weight, not a raw-score
    # fusion with vector similarity.
    section = document.get('section', '')
    return f"{section} {section} {document.get('text', '')}"


def medical_query_expansion(query):
    """Return a small, auditable vocabulary expansion for the BM25 stage.

    This is deliberately deterministic and domain-scoped.  It restores the
    section vocabulary used by the curated corpus without pretending that a
    lexical query expansion is semantic/vector retrieval.
    """
    normalized = ''.join(str(query or '').lower().split())
    terms = []

    def add(*values):
        for value in values:
            if value not in terms: terms.append(value)

    hypertension = any(value in normalized for value in ('高血压', '血压'))
    diabetes = any(value in normalized for value in ('糖尿病', '血糖'))
    if hypertension and any(value in normalized for value in ('关系', '并发', '胸痛', '肾', '危险')):
        add('并发症')
    if diabetes and '心血管' not in normalized and '慢性肾' not in normalized and any(value in normalized for value in ('复测', '监测', '记录', '关系', '并发')):
        add('监测', '并发症')
    if diabetes and any(value in normalized for value in ('生活方式', '预防', '运动', '饮食')):
        add('预防', '生活方式')
    if any(value in normalized for value in ('加药', '增加降压药', '停药', '自行用药')):
        add('生活方式干预')
    if hypertension and diabetes:
        add('风险因素')
    if any(value in normalized for value in ('慢性肾病', '慢性肾脏病')) and hypertension:
        add('血压与共病')
    if any(value in normalized for value in ('步数', '久坐', '活动量')) and any(value in normalized for value in ('记录', '观察', '指标')):
        add('可观察指标')
    if any(value in normalized for value in ('衰弱', '虚弱')) and any(value in normalized for value in ('记录', '评估', '观察')):
        add('评估维度')
    return terms


@dataclass
class StageStatus:
    requested: bool
    available: bool
    active: bool
    implementation: str
    model: str | None = None
    fallback_reason: str | None = None
    latency_ms: float = 0.0
    candidates: int = 0


@dataclass
class RetrievalCapabilities:
    lexical: bool = True
    graph: bool = True
    vector: bool = False
    reranker: bool = False
    backend: str = 'local_hybrid'
    stages: dict = field(default_factory=dict)
    degradations: list = field(default_factory=list)


class BM25Retriever:
    def __init__(self, documents, k1=1.5, b=0.75):
        self.documents = list(documents or [])
        self.k1, self.b = float(k1), float(b)
        self.tokens = [lexical_tokens(document_text(row)) for row in self.documents]
        self.lengths = [len(row) for row in self.tokens]
        self.avgdl = sum(self.lengths) / max(1, len(self.lengths))
        self.df = Counter()
        for row in self.tokens: self.df.update(set(row))

    def search(self, query, top_k=20, expansion_terms=None):
        expanded_query = f"{query} {' '.join(expansion_terms or [])}"
        qterms, n, ranked = lexical_tokens(expanded_query), len(self.documents), []
        for index, terms in enumerate(self.tokens):
            frequencies, score = Counter(terms), 0.0
            for term in qterms:
                frequency = frequencies.get(term, 0)
                if not frequency: continue
                df = self.df.get(term, 0)
                idf = math.log(1 + (n - df + 0.5) / (df + 0.5))
                denom = frequency + self.k1 * (1 - self.b + self.b * self.lengths[index] / max(self.avgdl, 1e-9))
                score += idf * frequency * (self.k1 + 1) / denom
            if score > 0: ranked.append({'chunk_id': self.documents[index]['id'], 'score': score})
        ranked.sort(key=lambda row: (-row['score'], row['chunk_id']))
        return ranked[:top_k]


def _hashing_vector(text, dimensions=384):
    normalized = ''.join(str(text or '').lower().split())
    features = [normalized[i:i + size] for size in (2, 3) for i in range(max(0, len(normalized) - size + 1))]
    vector = [0.0] * dimensions
    for feature in features:
        value = int.from_bytes(hashlib.blake2b(feature.encode('utf-8'), digest_size=8).digest(), 'big')
        vector[value % dimensions] += -1.0 if value & 1 else 1.0
    norm = math.sqrt(sum(value * value for value in vector)) or 1.0
    return [value / norm for value in vector]


def _cosine(left, right):
    return sum(a * b for a, b in zip(left, right))


class DenseVectorRetriever:
    BUILTIN_MODEL = 'hashing_char_ngram_v1'

    def __init__(self, model='disabled', index_path=None):
        self.model = str(model or 'disabled')
        self.index_path = Path(index_path) if index_path else None
        self._payload, self._encoder = None, None
        self.status = StageStatus(True, False, False, 'disabled', self.model, 'vector_model_not_configured')
        self._initialize()

    def _initialize(self):
        if self.model in {'disabled', 'none', ''}: return
        if self.model == self.BUILTIN_MODEL:
            if not self.index_path or not self.index_path.exists():
                self.status = StageStatus(True, False, False, 'dense_hashing', self.model, 'vector_index_missing'); return
            try:
                payload = json.loads(self.index_path.read_text(encoding='utf-8'))
                if payload.get('model') != self.model: raise ValueError('model_mismatch')
                self._payload = payload
                self.status = StageStatus(True, True, True, 'dense_hashing', self.model)
            except (OSError, ValueError, json.JSONDecodeError) as exc:
                self.status = StageStatus(True, False, False, 'dense_hashing', self.model, f'vector_index_invalid:{type(exc).__name__}')
            return
        model_path = Path(self.model)
        if not model_path.exists():
            self.status = StageStatus(True, False, False, 'sentence_transformers', self.model, 'vector_model_path_missing'); return
        try:
            from sentence_transformers import SentenceTransformer
            self._encoder = SentenceTransformer(str(model_path), local_files_only=True)
            if not self.index_path or not self.index_path.exists(): raise FileNotFoundError('vector_index_missing')
            self._payload = json.loads(self.index_path.read_text(encoding='utf-8'))
            self.status = StageStatus(True, True, True, 'sentence_transformers', self.model)
        except Exception as exc:
            self.status = StageStatus(True, False, False, 'sentence_transformers', self.model, f'vector_model_unavailable:{type(exc).__name__}')

    @classmethod
    def build_index(cls, documents, output_path, model=BUILTIN_MODEL, dimensions=384):
        output_path = Path(output_path)
        if model == cls.BUILTIN_MODEL:
            vectors = {row['id']: _hashing_vector(document_text(row), dimensions) for row in documents}
            payload = {'schema_version': 'dense-index.v1', 'model': model, 'dimensions': dimensions,
                       'document_count': len(vectors), 'vectors': vectors}
        else:
            model_path = Path(model)
            if not model_path.exists(): raise FileNotFoundError(f'local vector model not found: {model}')
            from sentence_transformers import SentenceTransformer
            encoder = SentenceTransformer(str(model_path), local_files_only=True)
            embeddings = encoder.encode([document_text(row) for row in documents], normalize_embeddings=True)
            payload = {'schema_version': 'dense-index.v1', 'model': str(model), 'dimensions': len(embeddings[0]),
                       'document_count': len(documents), 'vectors': {row['id']: vector.tolist() for row, vector in zip(documents, embeddings)}}
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(json.dumps(payload, ensure_ascii=False), encoding='utf-8')
        return {'model': model, 'documents': payload['document_count'], 'dimensions': payload['dimensions'], 'path': str(output_path)}

    def search(self, query, allowed_ids=None, top_k=20):
        if not self.status.active: return []
        started = time.perf_counter()
        query_vector = (_hashing_vector(query, int(self._payload['dimensions'])) if self.model == self.BUILTIN_MODEL
                        else self._encoder.encode([query], normalize_embeddings=True)[0].tolist())
        allowed_ids = set(allowed_ids or self._payload['vectors'])
        ranked = [{'chunk_id': chunk_id, 'score': _cosine(query_vector, vector)}
                  for chunk_id, vector in self._payload['vectors'].items() if chunk_id in allowed_ids]
        ranked.sort(key=lambda row: (-row['score'], row['chunk_id']))
        self.status.latency_ms = round((time.perf_counter() - started) * 1000, 3)
        self.status.candidates = min(top_k, len(ranked))
        return ranked[:top_k]


class CrossEncoderReranker:
    BUILTIN_MODEL = 'local_linear_v1'

    def __init__(self, model='disabled'):
        self.model, self._model = str(model or 'disabled'), None
        if self.model in {'disabled', 'none', ''}:
            self.status = StageStatus(True, False, False, 'disabled', self.model, 'reranker_model_not_configured')
        elif self.model == self.BUILTIN_MODEL:
            self.status = StageStatus(True, True, True, 'local_linear_reranker', self.model)
        elif not Path(self.model).exists():
            self.status = StageStatus(True, False, False, 'cross_encoder', self.model, 'reranker_model_path_missing')
        else:
            try:
                from sentence_transformers import CrossEncoder
                self._model = CrossEncoder(self.model, local_files_only=True)
                self.status = StageStatus(True, True, True, 'cross_encoder', self.model)
            except Exception as exc:
                self.status = StageStatus(True, False, False, 'cross_encoder', self.model, f'reranker_unavailable:{type(exc).__name__}')

    def rerank(self, query, documents, top_k=None):
        if not self.status.active: return []
        started = time.perf_counter()
        if self.model == self.BUILTIN_MODEL:
            query_terms, rows = Counter(lexical_tokens(query)), []
            for input_rank, document in enumerate(documents):
                text = document_text(document).lower(); document_terms = Counter(lexical_tokens(text))
                coverage = sum(min(count, document_terms.get(term, 0)) for term, count in query_terms.items()) / max(1, sum(query_terms.values()))
                phrase = 1.0 if ''.join(str(query).split()).lower() in ''.join(text.split()) else 0.0
                section = sum(1 for term in set(query_terms) if term in str(document.get('section', '')).lower()) / max(1, len(set(query_terms)))
                rows.append({'chunk_id': document['id'], 'score': 0.65 * coverage + 0.25 * section + 0.10 * phrase, '_input_rank': input_rank})
        else:
            scores = self._model.predict([(query, document_text(row)) for row in documents])
            rows = [{'chunk_id': document['id'], 'score': float(score)} for document, score in zip(documents, scores)]
        rows.sort(key=lambda row: (-row['score'], row.get('_input_rank', 0), row['chunk_id']))
        for row in rows: row.pop('_input_rank', None)
        self.status.latency_ms = round((time.perf_counter() - started) * 1000, 3); self.status.candidates = len(rows)
        return rows[:top_k] if top_k else rows


def rrf_fuse(rankings, k=60, weights=None):
    """Fuse ranks only; raw BM25/cosine scores are never added.

    Optional stage weights implement weighted RRF.  The base retrieval receives
    more weight than graph expansion so a weak graph neighbour cannot displace
    a strong direct evidence hit.
    """
    fused = defaultdict(float)
    weights = list(weights or [1.0] * len(rankings))
    for stage_index, ranking in enumerate(rankings):
        weight = float(weights[stage_index]) if stage_index < len(weights) else 1.0
        for rank, row in enumerate(ranking, 1): fused[row['chunk_id']] += weight / (k + rank)
    return [{'chunk_id': chunk_id, 'score': score} for chunk_id, score in sorted(fused.items(), key=lambda item: (-item[1], item[0]))]


class GraphStore(ABC):
    @abstractmethod
    def seed_entities(self, chunk_ids, disease=None): ...
    @abstractmethod
    def expand(self, seeds, max_hops=2, allowed_node_types=None, allowed_relation_types=None, max_nodes=40, max_edges=60): ...


class JsonGraphStore(GraphStore):
    def __init__(self, entities, relationships):
        self.entities = {row['id']: row for row in entities or []}; self.relationships = list(relationships or [])
        self.adjacency = defaultdict(list)
        for index, edge in enumerate(self.relationships):
            if edge.get('source') and edge.get('target'):
                self.adjacency[edge['source']].append((edge['target'], index, edge)); self.adjacency[edge['target']].append((edge['source'], index, edge))

    @classmethod
    def from_files(cls, entities_path, relationships_path):
        return cls(json.loads(Path(entities_path).read_text(encoding='utf-8')), json.loads(Path(relationships_path).read_text(encoding='utf-8')))

    def seed_entities(self, chunk_ids, disease=None):
        chunk_ids = set(chunk_ids or [])
        seeds = {entity_id for entity_id, entity in self.entities.items() if chunk_ids & set(entity.get('chunk_ids') or [])}
        if disease and f'disease:{disease}' in self.entities: seeds.add(f'disease:{disease}')
        return seeds

    def expand(self, seeds, max_hops=2, allowed_node_types=None, allowed_relation_types=None, max_nodes=40, max_edges=60):
        allowed_node_types = set(allowed_node_types or DEFAULT_NODE_TYPES); allowed_relation_types = set(allowed_relation_types or DEFAULT_RELATION_TYPES)
        seeds = set(seeds or []); visited = set(seeds); queue = deque((seed, 0) for seed in sorted(seeds)); edges, chunk_scores = [], defaultdict(float)
        while queue and len(visited) < max_nodes and len(edges) < max_edges:
            node, hop = queue.popleft()
            if hop >= max_hops: continue
            for neighbor, index, edge in self.adjacency.get(node, []):
                if len(edges) >= max_edges: break
                if edge.get('type') not in allowed_relation_types or self.entities.get(neighbor, {}).get('type') not in allowed_node_types: continue
                edges.append({'relation_index': index, 'hop': hop + 1, **edge})
                if edge.get('chunk_id'): chunk_scores[edge['chunk_id']] = max(chunk_scores[edge['chunk_id']], 1.0 / (hop + 1))
                for chunk_id in self.entities.get(neighbor, {}).get('chunk_ids') or []: chunk_scores[chunk_id] = max(chunk_scores[chunk_id], 0.75 / (hop + 1))
                if neighbor not in visited and len(visited) < max_nodes: visited.add(neighbor); queue.append((neighbor, hop + 1))
        graph_ranking = [{'chunk_id': chunk_id, 'score': score} for chunk_id, score in sorted(chunk_scores.items(), key=lambda item: (-item[1], item[0]))]
        return {'seed_entities': sorted(seeds), 'expanded_nodes': sorted(visited - seeds), 'edges': edges, 'chunk_ranking': graph_ranking,
                'limits': {'max_hops': max_hops, 'max_nodes': max_nodes, 'max_edges': max_edges,
                'allowed_node_types': sorted(allowed_node_types), 'allowed_relation_types': sorted(allowed_relation_types)}}


class Neo4jGraphStore(GraphStore):
    """Optional placeholder; never opens a network connection implicitly."""
    def __init__(self, *_, **__): raise RuntimeError('neo4j_backend_not_installed_or_configured')
    def seed_entities(self, chunk_ids, disease=None): return set()
    def expand(self, seeds, **kwargs): return {}


def filter_documents(documents, filters=None):
    filters = filters or {}; allowed_review = filters.get('review_status')
    if isinstance(allowed_review, str): allowed_review = {x.strip() for x in allowed_review.split(',') if x.strip()}
    elif allowed_review: allowed_review = set(allowed_review)
    audience = str(filters.get('audience') or 'elderly').lower(); privileged = audience in {'doctor', 'clinician', 'audit'}
    disease = filters.get('disease'); disease_scope = {'heart_disease', 'cardiovascular'} if disease in {'heart_disease', 'cardiovascular'} else {disease} if disease else None
    after = int(filters['published_after']) if str(filters.get('published_after', '')).isdigit() else None
    before = int(filters['published_before']) if str(filters.get('published_before', '')).isdigit() else None
    rows = []
    for row in documents:
        status = str(row.get('review_status') or '')
        if allowed_review and status not in allowed_review: continue
        if not privileged and any(marker in status.lower() for marker in ('rejected', 'revoked', 'expired', 'invalid', 'unavailable')): continue
        if disease_scope and row.get('disease') not in disease_scope: continue
        year = int(row['publication_year']) if str(row.get('publication_year', '')).isdigit() else None
        if after and (year is None or year < after): continue
        if before and (year is None or year > before): continue
        rows.append(row)
    return rows


class HybridRetrievalPipeline:
    def __init__(self, documents, graph_store=None, vector_model='disabled', vector_index=None, reranker_model='disabled', rrf_k=60):
        self.documents = list(documents or []); self.by_id = {row['id']: row for row in self.documents}; self.graph_store = graph_store
        self.vector = DenseVectorRetriever(vector_model, vector_index); self.reranker = CrossEncoderReranker(reranker_model); self.rrf_k = int(rrf_k)

    def search(self, query, top_k=10, candidate_k=40, filters=None, use_lexical=True, use_vector=True, use_graph=True,
               use_reranker=True, disease=None, max_hops=2, max_graph_nodes=40, max_graph_edges=60,
               allowed_node_types=None, allowed_relation_types=None):
        total_started = time.perf_counter(); documents = filter_documents(self.documents, filters or {})
        allowed_ids = {row['id'] for row in documents}; stages, degradations = {}, []
        started = time.perf_counter(); query_expansion = medical_query_expansion(query) if use_lexical else []
        lexical = BM25Retriever(documents).search(query, candidate_k, query_expansion) if use_lexical else []
        stages['lexical'] = asdict(StageStatus(use_lexical, True, use_lexical, 'bm25', candidates=len(lexical), latency_ms=round((time.perf_counter() - started) * 1000, 3)))
        stages['lexical']['query_expansion_terms'] = query_expansion
        vector = self.vector.search(query, allowed_ids, candidate_k) if use_vector else []
        vector_status = asdict(self.vector.status); vector_status['requested'] = use_vector; vector_status['active'] = bool(use_vector and self.vector.status.active)
        if use_vector and not self.vector.status.active: degradations.append({'stage': 'vector', 'reason': self.vector.status.fallback_reason})
        stages['vector'] = vector_status
        rankings = [ranking for ranking in (lexical if use_lexical else [], vector if use_vector and self.vector.status.active else []) if ranking]
        fused = rrf_fuse(rankings, self.rrf_k) if rankings else []
        stages['fusion'] = {'requested': True, 'available': True, 'active': bool(fused), 'implementation': 'rrf', 'rrf_k': self.rrf_k, 'candidates': len(fused)}
        graph_result = {'seed_entities': [], 'expanded_nodes': [], 'edges': [], 'chunk_ranking': [], 'limits': {}}
        if use_graph and self.graph_store and fused:
            seed_chunks = [row['chunk_id'] for row in fused[:min(10, len(fused))]]
            discovered_seeds = self.graph_store.seed_entities(seed_chunks, disease)
            disease_seed = f'disease:{disease}' if disease and f'disease:{disease}' in discovered_seeds else None
            seeds = set(sorted(discovered_seeds - ({disease_seed} if disease_seed else set()))[:min(20, max_graph_nodes)])
            if disease_seed: seeds.add(disease_seed)
            graph_result = self.graph_store.expand(seeds, max_hops=max_hops, allowed_node_types=allowed_node_types,
                allowed_relation_types=allowed_relation_types, max_nodes=max_graph_nodes, max_edges=max_graph_edges)
            graph_result['seed_provenance'] = {'retrieved_chunk_ids': seed_chunks, 'explicit_disease': disease_seed}
            graph_ranking = [row for row in graph_result['chunk_ranking'] if row['chunk_id'] in allowed_ids]
            fused = rrf_fuse([fused, graph_ranking], self.rrf_k, weights=[4.0, 1.0]) if graph_ranking else fused
            stages['graph'] = asdict(StageStatus(True, True, True, 'json_graph_expansion', candidates=len(graph_ranking)))
        else:
            reason = 'graph_disabled' if not use_graph else 'graph_store_missing' if not self.graph_store else 'no_retrieval_seeds'
            stages['graph'] = asdict(StageStatus(use_graph, bool(self.graph_store), False, 'json_graph_expansion', fallback_reason=reason))
            if use_graph and reason != 'no_retrieval_seeds': degradations.append({'stage': 'graph', 'reason': reason})
        candidates = [self.by_id[row['chunk_id']] for row in fused[:candidate_k] if row['chunk_id'] in self.by_id]
        reranked = self.reranker.rerank(query, candidates, candidate_k) if use_reranker else []
        rerank_status = asdict(self.reranker.status); rerank_status['requested'] = use_reranker; rerank_status['active'] = bool(use_reranker and self.reranker.status.active)
        if use_reranker and not self.reranker.status.active: degradations.append({'stage': 'reranker', 'reason': self.reranker.status.fallback_reason})
        stages['reranker'] = rerank_status; final = reranked if use_reranker and self.reranker.status.active else fused
        lexical_by_id = {row['chunk_id']: row['score'] for row in lexical}; vector_by_id = {row['chunk_id']: row['score'] for row in vector}
        graph_by_id = {row['chunk_id']: row['score'] for row in graph_result.get('chunk_ranking', [])}; rerank_by_id = {row['chunk_id']: row['score'] for row in reranked}
        results = []
        for rank, row in enumerate(final[:top_k], 1):
            document = self.by_id.get(row['chunk_id'])
            if not document or document['id'] not in allowed_ids: continue
            results.append({**document, 'chunk_id': document['id'], 'stage_scores': {'lexical_score': round(lexical_by_id.get(document['id'], 0.0), 6),
                'vector_score': round(vector_by_id.get(document['id'], 0.0), 6), 'graph_score': round(graph_by_id.get(document['id'], 0.0), 6),
                'rerank_score': round(rerank_by_id.get(document['id'], 0.0), 6), 'final_rank': rank}})
        vector_active, graph_active, reranker_active = (bool(stages[name]['active']) for name in ('vector', 'graph', 'reranker'))
        if use_lexical and vector_active and graph_active and reranker_active: backend = 'full_hybrid'
        elif use_lexical and vector_active and reranker_active: backend = 'bm25_dense_reranker'
        elif use_lexical and vector_active: backend = 'bm25_dense'
        elif not use_lexical and vector_active: backend = 'dense_rag'
        elif use_lexical and graph_active: backend = 'local_hybrid'
        elif use_lexical: backend = 'bm25'
        else: backend = 'structured_fallback'
        caps = RetrievalCapabilities(bool(use_lexical), bool(stages['graph']['active']), bool(stages['vector']['active']),
            bool(stages['reranker']['active']), backend, stages, degradations)
        return {'results': results, 'capabilities': asdict(caps), 'graph': graph_result,
                'latency_ms': round((time.perf_counter() - total_started) * 1000, 3), 'filtered_documents': len(documents)}


def capabilities(requested_backend='local_hybrid', vector_model='disabled', vector_index=None, reranker_model='disabled'):
    vector, reranker = DenseVectorRetriever(vector_model, vector_index), CrossEncoderReranker(reranker_model)
    requested_vector = requested_backend not in {'local_hybrid', 'bm25'}; requested_reranker = requested_backend in {'full_hybrid', 'graphrag'}
    degradations = []
    if requested_vector and not vector.status.active: degradations.append({'stage': 'vector', 'reason': vector.status.fallback_reason})
    if requested_reranker and not reranker.status.active: degradations.append({'stage': 'reranker', 'reason': reranker.status.fallback_reason})
    return RetrievalCapabilities(True, True, requested_vector and vector.status.active, requested_reranker and reranker.status.active,
        requested_backend if not degradations else 'local_hybrid_fallback',
        {'vector': asdict(vector.status), 'reranker': asdict(reranker.status)}, degradations)
