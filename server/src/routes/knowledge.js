// 健康知识路由
import express from 'express';
import db from '../db.js';
import { queryKnowledgeGraph } from '../ai/tools/knowledgeGraph.js';
import { buildHealthContext } from '../ai/contextBuilder.js';

const router = express.Router();

// 列表（支持分类过滤 + 分页 + 关键词）
router.get('/', (req, res) => {
  const { category, q, audience } = req.query;
  const where = [];
  const params = [];

  if (category) { where.push('category = ?'); params.push(category); }
  if (audience) { where.push('audience = ?'); params.push(audience); }
  if (q) { where.push('(title LIKE ? OR summary LIKE ? OR body LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }

  const sql = `
    SELECT id, category, title, summary, tags, audience, view_count, created_at
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
router.get('/graph/query', async (req, res) => {
  const question = String(req.query.q || '').trim();
  if (!question) return res.status(400).json({ error: 'q is required' });
  const disease = req.query.disease ? String(req.query.disease) : null;
  try { res.json(await queryKnowledgeGraph(question, disease, buildHealthContext(req.user, 90))); }
  catch { res.status(503).json({ error: 'knowledge graph unavailable' }); }
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
