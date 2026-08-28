export const ROLES = Object.freeze(['senior', 'caregiver', 'doctor', 'admin']);

export const PERMISSION_MATRIX = Object.freeze({
  senior: ['read_own_health', 'write_own_health', 'use_agent', 'manage_own_profile', 'manage_care_access', 'manage_own_interventions'],
  caregiver: ['read_authorized_health', 'write_authorized_intake', 'use_agent_for_authorized', 'manage_authorized_followups', 'view_authorized_interventions', 'record_authorized_intervention_adherence', 'remind_authorized_execution'],
  doctor: ['read_authorized_health', 'write_clinical_review', 'use_agent_for_authorized', 'view_clinical_evidence', 'view_authorized_interventions', 'review_graphrag_relationships', 'review_authorized_interventions'],
  admin: ['manage_system_settings', 'view_audit_log', 'view_operational_metrics', 'manage_accounts'],
});

export function hasPermission(role, capability) {
  return (PERMISSION_MATRIX[role] || []).includes(capability);
}
