# -*- coding: utf-8 -*-
"""GraphRAG 可替换检索后端接口。

演示环境只启用 lexical+graph；生产环境可在不改 Node 工具接口的情况下接入医学 Embedding、向量库和重排器。
"""
from dataclasses import dataclass
import re

@dataclass(frozen=True)
class RetrievalCapabilities:
    lexical: bool = True
    graph: bool = True
    vector: bool = False
    reranker: bool = False
    backend: str = 'local_hybrid'

class VectorRetriever:
    """可替换向量接口；无第三方依赖时提供确定性的词项向量降级。"""
    def __init__(self, backend='disabled'):
        self.backend = backend
    def available(self):
        return self.backend not in ('disabled', 'none')
    def search(self, query, documents, top_k=8):
        if not self.available(): return []
        q = set(re.findall(r'[\u4e00-\u9fff]{2}|[a-zA-Z]{3,}', str(query).lower()))
        scored = []
        for doc in documents or []:
            text = str(doc.get('text', '')).lower()
            terms = set(re.findall(r'[\u4e00-\u9fff]{2}|[a-zA-Z]{3,}', text))
            score = len(q & terms) / max(1, len(q))
            if score: scored.append((score, doc))
        return [doc for _, doc in sorted(scored, key=lambda x: -x[0])[:top_k]]

class CrossEncoderReranker:
    def __init__(self, backend='disabled'):
        self.backend = backend
    def available(self):
        return self.backend not in ('disabled', 'none')
    def rerank(self, query, documents):
        if not self.available(): return documents
        q = set(re.findall(r'[\u4e00-\u9fff]{2}|[a-zA-Z]{3,}', str(query).lower()))
        return sorted(documents or [], key=lambda d: len(q & set(d.get('tokens') or [])), reverse=True)

def capabilities(requested_backend='local_hybrid'):
    if requested_backend in ('vector', 'neo4j_hybrid'):
        return RetrievalCapabilities(vector=False, reranker=False, backend='local_hybrid_fallback',)
    return RetrievalCapabilities()
