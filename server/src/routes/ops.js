import express from 'express';
import { requireCapability } from '../middleware/accessControl.js';
import { listAuditEvents } from '../repositories/auditRepository.js';
import { metricsSnapshot } from '../services/opsMetrics.js';
import { pythonRuntimeHealth } from '../services/pythonRuntime.js';

const router = express.Router();
router.get('/metrics', requireCapability('view_operational_metrics'), (_req, res) => res.json(metricsSnapshot()));
router.get('/audit', requireCapability('view_audit_log'), (req, res) => res.json({ schema_version: 'audit-log.v1', events: listAuditEvents(req.query.limit) }));
router.get('/dependencies', requireCapability('view_operational_metrics'), async (_req, res) => res.json({ python: await pythonRuntimeHealth() }));
export default router;

