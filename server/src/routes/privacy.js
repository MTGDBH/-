import express from 'express';
import bcrypt from 'bcryptjs';
import db from '../db.js';
import { audit, requestFingerprint } from '../services/auditService.js';
import { cookieHeader } from '../services/authService.js';
import {
  buildPersonalExport, containsForbiddenExportKey, createDeletionRequest, deleteAccountData,
  enforceExportRate, getDeletionRequest, listAccessRecords, listAuthorizations, privacyOverview,
  recordExport, serializeExport, DELETION_CONFIRM_TEXT,
} from '../services/privacyService.js';

const router = express.Router();
function auditPrivacy(req, action, outcome, metadata = {}) {
  audit({ actor_user_id: req.user?.id, subject_user_id: req.user?.id, event_type: 'privacy_data_management', resource: req.path,
    action, outcome, request_id: req.request_id, ...requestFingerprint(req), metadata });
}

router.get('/overview', (req, res) => res.json(privacyOverview(req.user.id)));
router.get('/authorizations', (req, res) => res.json({ items: listAuthorizations(req.user.id) }));
router.get('/access-records', (req, res) => res.json({ items: listAccessRecords(req.user.id, req.query.limit) }));

router.post('/exports', (req, res, next) => {
  const format = String(req.body?.format || 'json').toLowerCase();
  try {
    const quota = enforceExportRate(req.user.id);
    const payload = buildPersonalExport(req.user.id);
    if (containsForbiddenExportKey(payload)) throw Object.assign(new Error('导出安全检查未通过'), { status: 500, code: 'EXPORT_SAFETY_CHECK_FAILED' });
    const file = serializeExport(payload, format);
    const bytes = Buffer.byteLength(file.body, 'utf8');
    recordExport(req.user.id, format, 'completed', bytes);
    auditPrivacy(req, 'personal_data_export', 'success', { format, byte_count: bytes, quota_remaining: quota.remaining - 1 });
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="xiaokang-personal-data-${new Date().toISOString().slice(0, 10)}.${file.extension}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Export-Quota-Remaining', String(Math.max(0, quota.remaining - 1)));
    res.send(file.body);
  } catch (error) {
    if (['EXPORT_RATE_LIMITED', 'EXPORT_SAFETY_CHECK_FAILED'].includes(error.code)) auditPrivacy(req, 'personal_data_export', 'denied', { reason_code: error.code, format });
    next(error);
  }
});

router.post('/deletion-requests', (req, res) => {
  const request = createDeletionRequest(req.user.id);
  auditPrivacy(req, 'account_deletion_requested', 'awaiting_confirmation', { deletion_request_id: request.id, category_count: request.categories.length });
  res.status(201).json(request);
});
router.get('/deletion-requests/:id', (req, res) => {
  const request = getDeletionRequest(req.params.id, req.user.id);
  if (!request) return res.status(404).json({ error: '删除请求不存在' });
  res.json({ ...request, categories: JSON.parse(request.categories || '[]') });
});
router.post('/deletion-requests/:id/confirm', async (req, res, next) => {
  try {
    if (String(req.body?.confirmation_text || '') !== DELETION_CONFIRM_TEXT) return res.status(400).json({ error: `请输入“${DELETION_CONFIRM_TEXT}”完成二次确认` });
    const password = String(req.body?.password || '');
    const valid = req.user.password?.startsWith('$2') ? await bcrypt.compare(password, req.user.password) : password === String(req.user.password || '');
    if (!valid) { auditPrivacy(req, 'account_deletion_confirmed', 'denied', { reason_code: 'PASSWORD_MISMATCH' }); return res.status(401).json({ error: '密码不正确，账号未删除' }); }
    auditPrivacy(req, 'account_deletion_confirmed', 'processing', { deletion_request_id: req.params.id });
    const result = deleteAccountData(req.user.id, req.params.id);
    res.setHeader('Set-Cookie', cookieHeader('', { clear: true }));
    res.json({ ok: true, ...result, retained: ['不含健康内容的最小化审计事件', '删除请求状态'] });
  } catch (error) { next(error); }
});

export default router;
