import db from '../../db.js';

// 预警工具只读取当前登录用户的提醒，不替代规则引擎，也不直接改变提醒状态。
export function getAlertStatus(userId) {
  const alerts = db.prepare(`
    SELECT id, metric_type, severity, title, message, status, created_at
    FROM alerts WHERE user_id = ? ORDER BY id DESC LIMIT 30
  `).all(userId);
  return {
    success: true,
    total: alerts.length,
    pending: alerts.filter(a => a.status === 'pending').length,
    critical: alerts.filter(a => a.status === 'pending' && a.severity === 'critical').length,
    alerts,
  };
}

