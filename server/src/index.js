// 入口文件
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import db from './db.js';
import authRouter, { sessionMiddleware, requireAuth } from './auth.js';
import { getLLMStatus } from './ai/agent.js';
import { getModelBundleStatus } from './lib/modelBundle.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..', '..');
// 从 server/.env 加载本地演示配置；密钥仍只存在环境/设置表，不进入代码和前端。
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);

async function ensureSeedData() {
  const userCount = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
  if (userCount > 0) return;

  console.log('[seed] users table empty, loading demo data...');
  await import('../data/seed.js');
}

await ensureSeedData();

app.use(express.json({ limit: '1mb' }));

// CORS：开发期允许文件:// 和常见本地端口
const origins = (process.env.CORS_ORIGIN || '*').split(',').map(s => s.trim());
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || origins.includes('*') || origins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: ${origin} not allowed`));
  },
  credentials: true,
}));

// 简单日志
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// session 中间件（解析 cookie 挂 req.user）
app.use(sessionMiddleware);

// ===== 公共路由（不要求登录）=====
app.get('/api/health', (_req, res) => {
  const llm = getLLMStatus();
  const bundle = getModelBundleStatus();
  res.json({ ok: true, time: new Date().toISOString(), mode: llm.mode, provider: llm.provider, model: llm.model, populationModels: bundle.status === 'ready' ? 'ready' : 'degraded' });
});
app.use('/api/auth', authRouter);

// ===== 静态前端（Sealos / 单容器部署）=====
app.get('/login', (_req, res) => res.redirect('/login.html'));
app.get('/', (_req, res) => res.sendFile(path.join(ROOT_DIR, 'index.html')));
app.use(express.static(ROOT_DIR));

// ===== 鉴权守卫 =====
app.use('/api', requireAuth);

// ===== 业务路由（鉴权后）=====
// 这些在后续任务中逐个挂载
import healthRouter from './routes/health.js';
import apiRouter from './routes/api.js';
import profileRouter from './routes/profile.js';
import knowledgeRouter from './routes/knowledge.js';
import alertsRouter from './routes/alerts.js';
import trendRouter from './routes/trend.js';
import settingsRouter from './routes/settings.js';
import predictionRouter from './routes/prediction.js';
import actionsRouter from './routes/actions.js';
import careRouter from './routes/care.js';
import weatherRouter from './routes/weather.js';

app.use('/api/health', healthRouter);
app.use('/api', apiRouter);
app.use('/api/profile', profileRouter);
app.use('/api/knowledge', knowledgeRouter);
app.use('/api/alerts', alertsRouter);
app.use('/api/trend', trendRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/prediction', predictionRouter);
app.use('/api/actions', actionsRouter);
app.use('/api/care', careRouter);
app.use('/api/weather', weatherRouter);

// 错误处理
app.use((err, _req, res, _next) => {
  console.error('[error]', err);
  res.status(err.status || 500).json({ error: err.message || 'internal error' });
});

app.listen(PORT, () => {
  const llm = getLLMStatus();
  const mode = llm.configured ? `LLM (${llm.provider}/${llm.model})` : 'Mock（未配置 DeepSeek）';
  console.log(`\n🩺 老年人健康管家 API 已启动`);
  console.log(`   地址:  http://localhost:${PORT}`);
  console.log(`   模式:  ${mode}`);
  console.log(`   数据库: ${db.name}\n`);
});
