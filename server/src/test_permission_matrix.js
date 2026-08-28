import assert from 'node:assert/strict';
import { ROLES, PERMISSION_MATRIX, hasPermission } from './contracts/accessControl.js';

const allCapabilities = new Set(Object.values(PERMISSION_MATRIX).flat());
assert.deepEqual(Object.keys(PERMISSION_MATRIX).sort(), [...ROLES].sort());
for (const role of ROLES) {
  assert.ok(PERMISSION_MATRIX[role].length > 0, `${role} has no capabilities`);
  for (const capability of allCapabilities) {
    assert.equal(hasPermission(role, capability), PERMISSION_MATRIX[role].includes(capability), `${role}/${capability}`);
  }
}
assert.equal(hasPermission('senior', 'view_audit_log'), false);
assert.equal(hasPermission('caregiver', 'write_clinical_review'), false);
assert.equal(hasPermission('doctor', 'manage_accounts'), false);
assert.equal(hasPermission('admin', 'read_own_health'), false);
assert.equal(hasPermission('unknown', 'read_own_health'), false);
console.log('Permission matrix exhaustive contract: PASS');
