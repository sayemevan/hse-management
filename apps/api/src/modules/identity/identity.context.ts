import type { AppConfig } from '../../config/config';
import type { TenantContext } from '../../core/context/tenant';
import type { RequestMeta } from '../../core/http/request-meta';
import type { Logger } from '../../core/logging/logger';
import type { Database } from '../../database/client';
import { AuditLogService } from '../../platform/audit-log';
import { EmailService } from '../../platform/email';
import { type JobMessage, publishJobs } from '../../platform/jobs';
import { OneTimeTokenService } from '../../platform/one-time-token';
import { CompanyRepository, CompanySettingsRepository } from '../company';
import { SubscriptionService } from '../subscription';
import type { UserRow } from './identity.schema';
import { InvitationRepository } from './invitation.repository';
import { RoleRepository } from './role.repository';
import { SessionRepository } from './session.repository';
import { UserRepository } from './user.repository';

/** Everything an identity service needs for one request. Built by `identity.factory.ts`. */
export interface IdentityDependencies {
  db: Database;
  config: AppConfig;
  tenant: TenantContext;
  meta: RequestMeta;
  logger: Logger;
  /** The JOBS queue, for emails (US-006, US-002). */
  queue: Queue;
  /** Injected so tests can control time (session expiry, lockout). */
  clock: () => number;
}

/** Repositories and the services of other modules, created once per request. */
export class IdentityContext {
  readonly users: UserRepository;
  readonly sessions: SessionRepository;
  readonly roles: RoleRepository;
  readonly invitations: InvitationRepository;
  readonly audit: AuditLogService;
  readonly tokens: OneTimeTokenService;
  readonly emails: EmailService;
  readonly companies: CompanyRepository;
  readonly companySettings: CompanySettingsRepository;
  readonly subscriptions: SubscriptionService;

  constructor(readonly deps: IdentityDependencies) {
    this.users = new UserRepository(deps.db);
    this.sessions = new SessionRepository(deps.db);
    this.roles = new RoleRepository(deps.db);
    this.invitations = new InvitationRepository(deps.db);
    this.audit = new AuditLogService(deps.db, deps.meta, deps.clock);
    this.tokens = new OneTimeTokenService(deps.db, deps.clock);
    this.emails = new EmailService(deps.db, deps.clock);
    this.companies = new CompanyRepository(deps.db);
    this.companySettings = new CompanySettingsRepository(deps.db);
    this.subscriptions = new SubscriptionService(deps.db, deps.clock);
  }

  now(): number {
    return this.deps.clock();
  }

  publish(jobs: JobMessage[]): Promise<void> {
    return publishJobs(this.deps.queue, jobs, this.deps.logger);
  }
}

/** A company user may only act on their company's subdomain; platform users on the base domain (O-3). */
export function belongsToTenant(
  account: Pick<UserRow, 'companyId'>,
  tenant: TenantContext,
): boolean {
  return tenant.kind === 'company'
    ? account.companyId === tenant.company.id
    : account.companyId === null;
}
