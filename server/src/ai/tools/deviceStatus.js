import db from '../../db.js';

export function getDeviceStatus(userId) {
  const devices = db.prepare('SELECT id, name, kind, status, battery_level, last_sync, sync_error FROM devices WHERE user_id = ? ORDER BY id DESC').all(userId);
  const recent = db.prepare(`SELECT m.type, m.value, m.value2, m.unit, m.recorded_at, m.source, m.device_id FROM metrics m WHERE m.user_id = ? AND m.source = 'device' ORDER BY m.recorded_at DESC LIMIT 10`).all(userId);
  return {
    success: true,
    devices,
    recent_device_metrics: recent,
    connected_count: devices.filter(d => d.status === 'connected').length,
    sync_failures: devices.filter(d => d.status === 'error' || d.sync_error).length,
  };
}

