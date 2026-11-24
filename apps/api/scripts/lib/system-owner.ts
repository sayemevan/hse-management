import { sqlString } from './d1-cli';

export interface SystemOwnerInput {
  userId: string;
  roleId: string;
  auditId: string;
  email: string;
  fullName: string;
  passwordHash: string;
  now: number;
}

/**
 * SQL that creates a System Owner (PLT-04): the user, the platform-scope role and the audit
 * record, applied together in one file so they succeed or fail as one.
 */
export function buildSystemOwnerStatements(input: SystemOwnerInput): string[] {
  const now = String(input.now);
  return [
    `INSERT INTO user (id, company_id, email, full_name, password_hash, status, failed_login_count, created_at, updated_at) VALUES (${sqlString(input.userId)}, NULL, ${sqlString(input.email)}, ${sqlString(input.fullName)}, ${sqlString(input.passwordHash)}, 'active', 0, ${now}, ${now})`,
    `INSERT INTO user_role (id, user_id, role_code, scope_level, company_id, project_id, created_at, updated_at) VALUES (${sqlString(input.roleId)}, ${sqlString(input.userId)}, 'system_owner', 'platform', NULL, NULL, ${now}, ${now})`,
    `INSERT INTO audit_log (id, occurred_at, actor_user_id, action, entity_type, entity_id, outcome, new_value) VALUES (${sqlString(input.auditId)}, ${now}, NULL, 'platform.system_owner.created', 'user', ${sqlString(input.userId)}, 'success', ${sqlString(JSON.stringify({ email: input.email, source: 'bootstrap' }))})`,
  ];
}
