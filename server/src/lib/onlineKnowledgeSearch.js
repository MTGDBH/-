const EUROPE_PMC_ENDPOINT = 'https://www.ebi.ac.uk/europepmc/webservices/rest/search';
const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_RESULTS = 8;
const cache = new Map();

const HEALTH_TERMS = [
  [/血压|高血压|低压|高压/, 'hypertension blood pressure'],
  [/血糖|糖尿病|低血糖/, 'diabetes blood glucose hypoglycemia'],
  [/睡眠|失眠|打鼾|憋醒/, 'sleep insomnia sleep apnea'],
  [/跌倒|摔倒|平衡/, 'falls balance'],
  [/头晕|眩晕/, 'dizziness vertigo'],
  [/心脏|心率|心血管/, 'cardiovascular heart rate'],
  [/脑卒中|中风/, 'stroke'],
  [/认知|记忆|痴呆/, 'cognition memory dementia'],
  [/情绪|抑郁|焦虑/, 'depression anxiety mental health'],
  [/营养|食欲|体重/, 'nutrition appetite body weight'],
  [/肌力|衰弱|握力/, 'frailty muscle strength sarcopenia'],
  [/运动|活动|步数/, 'physical activity exercise'],
  [/用药|药物|吃药/, 'medication polypharmacy'],
  [/听力|耳聋/, 'hearing loss'],
  [/视力|眼睛/, 'vision impairment'],
  [/疼痛|关节/, 'pain osteoarthritis'],
  [/便秘|排便/, 'constipation'],
  [/尿失禁|漏尿/, 'urinary incontinence'],
  [/照护|家属|孤独|社交/, 'caregiving social isolation'],
];

export function normalizeOnlineQuery(value) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
}

export function buildEuropePmcQuery(value) {
  const query = normalizeOnlineQuery(value);
  const terms = [];
  for (const [pattern, english] of HEALTH_TERMS) {
    if (pattern.test(query) && !terms.includes(english)) terms.push(english);
  }
  if (!terms.length) return query;
  return `(${terms.map(term => `(${term})`).join(' AND ')}) AND ("older adults" OR elderly OR aged)`;
}

function cleanText(value, maxLength) {
  return String(value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

export function normalizeEuropePmcResult(row, index = 0) {
  const source = cleanText(row?.source, 12) || 'MED';
  const id = cleanText(row?.pmid || row?.pmcid || row?.id, 40);
  return {
    id: `${source}:${id || index}`,
    title_original: cleanText(row?.title, 300) || '题目信息暂缺',
    authors: cleanText(row?.authorString, 220) || '作者信息暂缺',
    journal: cleanText(row?.journalTitle, 120) || '期刊信息暂缺',
    publication_year: cleanText(row?.pubYear || row?.firstPublicationDate, 16) || '年份暂缺',
    abstract: cleanText(row?.abstractText, 520),
    pmid: cleanText(row?.pmid, 24) || null,
    pmcid: cleanText(row?.pmcid, 24) || null,
    doi: cleanText(row?.doi, 100) || null,
    cited_by_count: Number.isFinite(Number(row?.citedByCount)) ? Number(row.citedByCount) : null,
    source_url: id ? `https://europepmc.org/article/${encodeURIComponent(source)}/${encodeURIComponent(id)}` : 'https://europepmc.org/',
  };
}

export async function searchOnlineKnowledge(value, { fetchImpl = globalThis.fetch } = {}) {
  const query = normalizeOnlineQuery(value);
  if (!query) {
    const error = new Error('请输入要查询的健康主题');
    error.code = 'ONLINE_QUERY_REQUIRED';
    error.status = 400;
    throw error;
  }
  if (typeof fetchImpl !== 'function') {
    const error = new Error('当前运行环境不支持联网检索');
    error.code = 'ONLINE_KNOWLEDGE_UNAVAILABLE';
    error.status = 503;
    throw error;
  }

  const cacheKey = query.toLocaleLowerCase('zh-CN');
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.createdAt < CACHE_TTL_MS) return { ...cached.value, cached: true };

  const externalQuery = buildEuropePmcQuery(query);
  const url = new URL(EUROPE_PMC_ENDPOINT);
  url.searchParams.set('query', externalQuery);
  url.searchParams.set('format', 'json');
  url.searchParams.set('resultType', 'core');
  url.searchParams.set('pageSize', String(MAX_RESULTS));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9000);
  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'Xiaokang-Health-Test/1.0' },
    });
    if (!response.ok) throw new Error(`Europe PMC ${response.status}`);
    const payload = await response.json();
    const rows = Array.isArray(payload?.resultList?.result) ? payload.resultList.result : [];
    const value = {
      query,
      source: {
        label: 'Europe PMC 生物医学文献库',
        url: 'https://europepmc.org/',
        fetched_at: new Date().toISOString(),
        review_status: 'external_unreviewed',
      },
      items: rows.slice(0, MAX_RESULTS).map(normalizeEuropePmcResult),
      total_available: Number(payload?.hitCount || rows.length),
      search_note: externalQuery === query ? '按原关键词查询' : '已将常见中文健康主题转换为老年医学检索词',
      disclaimer: '联网结果来自外部研究文献库，尚未经过本项目医学审核，仅用于查找资料，不会自动进入个人健康结论。',
      cached: false,
    };
    cache.set(cacheKey, { createdAt: Date.now(), value });
    return value;
  } catch (cause) {
    const error = new Error(cause?.name === 'AbortError' ? '联网检索超时，请稍后重试' : '联网研究检索暂时不可用');
    error.code = cause?.name === 'AbortError' ? 'ONLINE_KNOWLEDGE_TIMEOUT' : 'ONLINE_KNOWLEDGE_UNAVAILABLE';
    error.status = 503;
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function clearOnlineKnowledgeCache() { cache.clear(); }
