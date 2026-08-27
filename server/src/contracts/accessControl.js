export const ROLES = Object.freeze(['senior', 'caregiver', 'doctor', 'admin']);

export const PERMISSION_MATRIX = Object.freeze({
  senior: ['read_own_health', 'write_own_health', 'use_agent', 'manage_own_profile', 'manage_care_access'],
  caregiver: ['read_authorized_health', 'write_authorized_intake', 'use_agent_for_authorized', 'manage_authorized_followups'],
  doctor: ['read_authorized_health', 'write_clinical_review', 'use_agent_for_authorized', 'view_clinical_evidence'],
  admin: ['manage_system_settings', 'view_audit_log', 'view_operational_metrics', 'manage_accounts'],
});

export function hasPermission(role, capability) {
  return (PERMISSION_MATRIX[role] || []).includes(capability);
}

