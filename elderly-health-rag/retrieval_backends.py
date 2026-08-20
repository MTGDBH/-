# -*- coding: utf-8 -*-
"""GraphRAG 可替换检索后端接口。

演示环境只启用 lexical+graph；生产环境可在不改 Node 工具接口的情况下接入医学 Embedding、向量库和重排器。
"""
from dataclasses import dataclass

@dataclass(frozen=True)
class RetrievalCapabilities:
    lexical: bool = True
    graph: bool = True
    vector: bool = False
    reranker: bool = False
    backend: str = 'local_hybrid'

class VectorRetriever:
    def __init__(self, backend='disabled'):
        self.backend = backend
    def available(self):
        return False
    def search(self, _query, _documents, _top_k=8):
        return []

class CrossEncoderReranker:
    def __init__(self, backend='disabled'):
        self.backend = backend
    def available(self):
        return False
    def rerank(self, _query, documents):
        return documents

def capabilities(requested_backend='local_hybrid'):
    if requested_backend in ('vector', 'neo4j_hybrid'):
        return RetrievalCapabilities(vector=False, reranker=False, backend='local_hybrid_fallback')
    return RetrievalCapabilities()
