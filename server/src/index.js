// 入口文件
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import db from './db.js';
import authRouter, { sessionMiddleware, requireAuth } from './auth.js';
import { getLLMStatus } from './ai/agent.js';
import { getModelBundleStatus } from './lib/modelBundle.js';
import { auditMutations } from './services/auditService.js';
import opsRouter from './routes/ops.js';
import { pythonRuntimeHealth } from './services/pythonRuntime.js';
import { requestLimits } from './middleware/requestLimits.js';
import { cleanupPrivacyRetention } from './services/privacyService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..', '..');
const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);
app.set('trust proxy', process.env.TRUST_PROXY === '1' ? 1 : false);

async function ensureSeedData() {
  const userCount = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
  if (userCount > 0) return;

  console.log('[seed] users table empty, loading demo data...');
  await import('../data/seed.js');
}

await ensureSeedData();
cleanupPrivacyRetention();

// 请求编号必须在排队和超时中间件之前建立，确保所有错误都可以追踪。
app.use((req, res, next) => {
  req.request_id = String(req.get('x-request-id') || crypto.randomUUID()).slice(0, 100);
  res.setHeader('X-Request-Id', req.request_id);
  next();
});
app.use(requestLimits);
app.use(express.json({ limit: process.env.HTTP_MAX_BODY_SIZE || '1mb' }));

// CORS：开发期允许文件:// 和常见本地端口
const origins = (process.env.CORS_ORIGIN || '*').split(',').map(s => s.trim());
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || origins.includes('*') || origins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: ${origin} not allowed`));
  },
  credentials: true,
}));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self' https:; frame-ancestors 'none'");
  console.log(JSON.stringify({ time: new Date().toISOString(), request_id: req.request_id, method: req.method, path: req.path }));
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
app.get('/api/health/dependencies', async (_req, res) => {
  const python = await pythonRuntimeHealth();
  res.status(python.status === 'degraded' ? 503 : 200).json({ ok: python.status !== 'degraded', python });
});
app.use('/api/auth', authRouter);

// ===== 静态前端（Sealos / 单容器部署）=====
app.get('/login', (_req, res) => res.redirect('/login.html'));
app.get('/', (_req, res) => res.sendFile(path.join(ROOT_DIR, 'index.html')));
app.use(express.static(ROOT_DIR));

// ===== 鉴权守卫 =====
app.use('/api', requireAuth);
app.use('/api', auditMutations);

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
import privacyRouter from './routes/privacy.js';

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
app.use('/api/privacy', privacyRouter);
app.use('/api/ops', opsRouter);

// 错误处理
app.use((err, req, res, _next) => {
  console.error(JSON.stringify({ event: 'request_error', request_id: req.request_id, code: err.code || 'INTERNAL', status: err.status || 500 }));
  const status = err.status || 500;
  res.status(status).json({
    error: status < 500 ? err.message : '服务暂时没有响应，请稍后再试',
    code: err.code || (status >= 500 ? 'INTERNAL' : `HTTP_${status}`), request_id: req.request_id,
    retryable: err.retryable ?? [408, 425, 429, 502, 503, 504].includes(status),
    retry_after_ms: err.retryAfterMs || null, stage: err.stage || 'server',
  });
});

app.listen(PORT, () => {
  const llm = getLLMStatus();
  const mode = llm.configured ? `LLM (${llm.provider}/${llm.model})` : 'Mock（未配置 DeepSeek）';
  console.log(`\n🩺 老年人健康管家 API 已启动`);
  console.log(`   地址:  http://localhost:${PORT}`);
  console.log(`   模式:  ${mode}`);
  console.log(`   数据库: ${db.name}\n`);
});
