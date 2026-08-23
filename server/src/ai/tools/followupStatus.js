import { listFollowups } from '../../lib/followups.js';

export function getFollowupStatus(userId) {
  const rows = listFollowups(userId);
  const active = rows.filter(row => ['scheduled', 'due', 'overdue', 'pending_result_confirmation'].includes(row.status));
  return {
    success: true,
    total: active.length,
    due: active.filter(row => row.status === 'due').length,
    overdue: active.filter(row => row.status === 'overdue').length,
    pending_confirmation: active.filter(row => row.status === 'pending_result_confirmation').length,
    items: active.slice(0, 10),
    recently_completed: rows.filter(row => row.status === 'completed').slice(-5),
    data_freshness: new Date().toISOString(),
  };
}
