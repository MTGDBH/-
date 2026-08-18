// 健康知识路由
import express from 'express';
import db from '../db.js';

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

// 热门关键词（从 tags 提取）
router.get('/meta/popular-tags', (_req, res) => {
  const rows = db.prepare('SELECT tags FROM knowledge_articles').all();
  const counts = {};
  for (const r of rows) {
    try {
      const tags = r.tags ? JSON.parse(r.tags) : [];
      for (const t of tags) counts[t] = (counts[t] || 0) + 1;
    } catch {}
  }
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([tag, count]) => ({ tag, count }));
  res.json(top);
});

export default router;
