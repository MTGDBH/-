import assert from 'node:assert/strict';
import {
  buildEuropePmcQuery,
  clearOnlineKnowledgeCache,
  normalizeEuropePmcResult,
  normalizeOnlineQuery,
  searchOnlineKnowledge,
} from './lib/onlineKnowledgeSearch.js';

assert.equal(normalizeOnlineQuery('  血压\n复测  '), '血压 复测');
assert.match(buildEuropePmcQuery('老年人血压和跌倒'), /hypertension blood pressure/);
assert.match(buildEuropePmcQuery('老年人血压和跌倒'), /falls balance/);
assert.match(buildEuropePmcQuery('老年人血压和跌倒'), /older adults/);

const normalized = normalizeEuropePmcResult({
  source: 'MED', pmid: '123', title: '<b>Safe title</b>', authorString: 'A; B',
  journalTitle: 'Journal', pubYear: '2026', abstractText: '<p>Abstract text</p>', citedByCount: '9',
});
assert.equal(normalized.title_original, 'Safe title');
assert.equal(normalized.abstract, 'Abstract text');
assert.equal(normalized.cited_by_count, 9);
assert.match(normalized.source_url, /^https:\/\/europepmc\.org\//);

clearOnlineKnowledgeCache();
let requests = 0;
const fetchImpl = async url => {
  requests += 1;
  assert.equal(url.searchParams.get('format'), 'json');
  assert.equal(url.searchParams.get('resultType'), 'core');
  return {
    ok: true,
    async json() {
      return { hitCount: 1, resultList: { result: [{ source: 'MED', pmid: '456', title: 'Older adult sleep study' }] } };
    },
  };
};
const first = await searchOnlineKnowledge('睡眠测试主题', { fetchImpl });
const second = await searchOnlineKnowledge('睡眠测试主题', { fetchImpl });
assert.equal(first.items.length, 1);
assert.equal(first.source.review_status, 'external_unreviewed');
assert.equal(second.cached, true);
assert.equal(requests, 1, '相同查询应使用十分钟缓存');
assert.ok(!JSON.stringify(first).includes('subject_user_id'), '联网结果不应含个人健康对象');

console.log('online knowledge search: PASS');
