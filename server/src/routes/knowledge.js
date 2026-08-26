// 健康知识路由
import express from 'express';
import db from '../db.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { queryKnowledgeGraph } from '../ai/tools/knowledgeGraph.js';
import { buildHealthContext } from '../ai/contextBuilder.js';
import { searchOnlineKnowledge } from '../lib/onlineKnowledgeSearch.js';

const router = express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST = path.resolve(__dirname, '..', '..', '..', 'elderly-health-rag', 'output', 'source_manifest.json');

function sourceManifest() {
  try { const raw = JSON.parse(fs.readFileSync(MANIFEST, 'utf8')); return raw.sources || raw; } catch { return []; }
}

function requireDoctor(req, res) {
  if (req.user?.role !== 'doctor') { res.status(403).json({ error: 'doctor role required' }); return false; }
  return true;
}

function roleAudience(req) {
  return ['doctor', 'clinician', 'audit'].includes(req.user?.role) ? req.user.role : req.user?.role === 'caregiver' ? 'caregiver' : 'elderly';
}

function hasResearchPreviewAccess(req) {
  if (['doctor', 'clinician', 'audit'].includes(req.user?.role)) return true;
  const permissions = Array.isArray(req.user?.permissions) ? req.user.permissions : [];
  return req.user?.research_preview_authorized === true || permissions.includes('knowledge_graph_research_preview');
}

// 列表（支持分类过滤 + 分页 + 关键词）
router.get('/', (req, res) => {
  const { category, q, audience } = req.query;
  const where = [];
  const params = [];

  if (category) { where.push('category = ?'); params.push(category); }
  if (audience) { where.push('audience = ?'); params.push(audience); }
  if (q) { where.push('(title LIKE ? OR summary LIKE ? OR body LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }

  const sql = `
    SELECT id, category, title, summary, tags, audience, view_count, review_status, review_version, reviewed_at, source_label, source_url, created_at
    FROM knowledge_articles
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY id DESC
    LIMIT 100
  `;
  const rows = db.prepare(sql).all(...params).map(r => ({
    ...r,
    tags: r.tags ? JSON.parse(r.tags) : [],
  }));
  res.json({ items: rows, total: rows.length });
});

// GraphRAG 检索：返回可引用的来源、章节和证据等级，不与数据库文章列表混淆。
router.get('/graph/sources', (req, res) => {
  const reviews = db.prepare('SELECT source_id, status, notes, reviewed_at FROM knowledge_source_reviews WHERE reviewer_id = ?').all(req.user.id);
  const reviewMap = Object.fromEntries(reviews.map(r => [r.source_id, r]));
  res.json({ index_version: (() => { try { return JSON.parse(fs.readFileSync(MANIFEST, 'utf8')).index_version; } catch { return null; } })(), sources: sourceManifest().map(s => ({ ...s, review: reviewMap[s.source_id] || { status: 'pending' } })) });
});

router.get('/graph/reviews', (req, res) => {
  if (!requireDoctor(req, res)) return;
  res.json({ items: db.prepare(`SELECT r.*, u.name AS reviewer_name FROM knowledge_source_reviews r JOIN users u ON u.id = r.reviewer_id ORDER BY r.reviewed_at DESC`).all() });
});

router.post('/graph/reviews', (req, res) => {
  if (!requireDoctor(req, res)) return;
  const sourceId = String(req.body?.source_id || '').trim();
  const status = String(req.body?.status || 'pending');
  if (!sourceId || !['pending', 'approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'invalid source_id or status' });
  if (!sourceManifest().some(s => s.source_id === sourceId || s.file === sourceId || s.file?.replace(/\.md$/, '') === sourceId)) return res.status(404).json({ error: 'source not found in index' });
  db.prepare(`INSERT INTO knowledge_source_reviews (source_id, reviewer_id, status, notes, reviewed_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(source_id, reviewer_id) DO UPDATE SET status = excluded.status, notes = excluded.notes, reviewed_at = excluded.reviewed_at`)
    .run(sourceId.replace(/\.md$/, ''), req.user.id, status, req.body?.notes ? String(req.body.notes).slice(0, 500) : null, new Date().toISOString());
  res.json(db.prepare('SELECT * FROM knowledge_source_reviews WHERE source_id = ? AND reviewer_id = ?').get(sourceId.replace(/\.md$/, ''), req.user.id));
});

router.get('/graph/query', async (req, res) => {
  const question = String(req.query.q || '').trim();
  if (!question) return res.status(400).json({ error: 'q is required' });
  const disease = req.query.disease ? String(req.query.disease) : null;
  const userAudience = roleAudience(req);
  const requestedAudience = ['elderly', 'caregiver', 'doctor', 'clinician', 'audit'].includes(req.query.audience) ? req.query.audience : userAudience;
  // 查询者不能通过 URL 参数把自己提升到医生视图。
  const elevatedAudience = ['doctor', 'clinician', 'audit'].includes(requestedAudience);
  const audience = elevatedAudience && requestedAudience !== req.user?.role ? userAudience : requestedAudience;
  const researchPreview = req.query.research_preview === 'true';
  const researchPreviewAuthorized = researchPreview && hasResearchPreviewAccess(req);
  try {
    res.json(await queryKnowledgeGraph(question, disease, buildHealthContext(req.user, 90), {
      audience,
      topK: req.query.top_k,
      maxHops: req.query.max_hops,
      includeTrace: req.query.trace !== '0',
      explainLevel: req.query.explain_level,
      sourceGate: req.query.source_gate,
      researchPreview,
      researchPreviewAuthorized,
    }));
  }
  catch { res.status(503).json({ error: 'knowledge graph unavailable' }); }
});

// 测试版关系发现：医生/临床/审计，或显式预览且具备授权者可只读查看。
router.get('/graph/relationship-candidates', async (req, res) => {
  const question = String(req.query.q || '老年人 功能 情绪 认知 跌倒 多重用药 睡眠 营养').trim();
  const audience = roleAudience(req);
  const privileged = ['doctor', 'clinician', 'audit'].includes(req.user?.role);
  const researchPreview = req.query.research_preview === 'true';
  if (!privileged && !(researchPreview && hasResearchPreviewAccess(req))) {
    return res.status(403).json({ error: 'research preview authorization required' });
  }
  try {
    const result = await queryKnowledgeGraph(question, null, {}, {
      audience, topK: 8, maxHops: 2, includeTrace: false,
      explainLevel: privileged ? 'audit' : 'standard',
      researchPreview: true,
      researchPreviewAuthorized: true,
    });
    res.json({
      index_version: result.index_version,
      items: result.relationship_candidates || [],
      summary: result.relationship_candidate_summary,
      disclaimer: '测试版已启用这些两跳关联线索。它们可帮助拓展观察方向，但不代表直接因果，也不会自动生成诊断、用药或健康行动。',
    });
  } catch {
    res.status(503).json({ error: '关系发现暂时不可用' });
  }
});

// 热门关键词（从 tags 提取）
router.get('/meta/popular-tags', (_req, res) => {
  const rows = db.prepare('SELECT tags FROM knowledge_articles').all();
  const counts = {};
  for (const r of rows) {
    try { for (const t of (r.tags ? JSON.parse(r.tags) : [])) counts[t] = (counts[t] || 0) + 1; } catch {}
  }
  res.json(Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([tag, count]) => ({ tag, count })));
});

// 显式联网检索：只发送用户键入的主题，不发送身份、健康档案或测量数据。
router.get('/online-search', async (req, res) => {
  try {
    res.json(await searchOnlineKnowledge(req.query.q));
  } catch (error) {
    res.status(error.status || 503).json({
      error: error.message || '联网研究检索暂时不可用',
      code: error.code || 'ONLINE_KNOWLEDGE_UNAVAILABLE',
    });
  }
});

// 文章级医学审核；每日贴士只有 approved 才允许个性化。
router.post('/articles/:id/review', (req, res) => {
  if (!requireDoctor(req, res)) return;
  const id = Number(req.params.id);
  const status = String(req.body?.status || '').trim();
  const version = String(req.body?.review_version || '').trim().slice(0, 80) || null;
  if (!Number.isInteger(id) || !['pending', 'approved', 'rejected'].includes(status)) return res.status(400).json({ error: '审核参数不正确' });
  if (!db.prepare('SELECT id FROM knowledge_articles WHERE id=?').get(id)) return res.status(404).json({ error: '文章不存在' });
  const reviewedAt = status === 'pending' ? null : new Date().toISOString();
  db.prepare(`UPDATE knowledge_articles SET review_status=?,review_version=?,reviewed_by=?,reviewed_at=? WHERE id=?`)
    .run(status, version, status === 'pending' ? null : req.user.id, reviewedAt, id);
  res.json(db.prepare(`SELECT id,category,title,review_status,review_version,reviewed_by,reviewed_at FROM knowledge_articles WHERE id=?`).get(id));
});

// 单篇
router.get('/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const row = db.prepare('SELECT * FROM knowledge_articles WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: '文章不存在' });
  db.prepare('UPDATE knowledge_articles SET view_count = view_count + 1 WHERE id = ?').run(id);
  res.json({
    ...row,
    tags: row.tags ? JSON.parse(row.tags) : [],
    view_count: row.view_count + 1,
  });
});

export default router;
