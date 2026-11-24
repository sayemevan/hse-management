import type { AppConfig } from '../../config/config';
import type { RequestMeta } from '../../core/http/request-meta';
import type { Logger } from '../../core/logging/logger';
import type { Database } from '../../database/client';
import { AuditLogService } from '../../platform/audit-log';
import type { BotCheck } from '../../platform/bot-check';
import { EmailService } from '../../platform/email';
import { type JobMessage, publishJobs } from '../../platform/jobs';
import { OneTimeTokenService } from '../../platform/one-time-token';
import { CompanyProvisioning } from '../company';
import { AccountProvisioning } from '../identity';
import { SubscriptionService } from '../subscription';
import { RegistrationRepository } from './registration.repository';

/** Everything a registration service needs for one request (or one scheduled run). */
export interface RegistrationDependencies {
  db: Database;
  config: AppConfig;
  meta: RequestMeta;
  logger: Logger;
  queue: Queue;
  cache: KVNamespace;
  botCheck: BotCheck;
  clock: () => number;
}

/** Repositories and the services of other modules, created once per request. */
export class RegistrationContext {
  readonly registrations: RegistrationRepository;
  readonly tokens: OneTimeTokenService;
  readonly emails: EmailService;
  readonly audit: AuditLogService;
  readonly companies: CompanyProvisioning;
  readonly accounts: AccountProvisioning;
  readonly subscriptions: SubscriptionService;

  constructor(readonly deps: RegistrationDependencies) {
    this.registrations = new RegistrationRepository(deps.db);
    this.tokens = new OneTimeTokenService(deps.db, deps.clock);
    this.emails = new EmailService(deps.db, deps.clock);
    this.audit = new AuditLogService(deps.db, deps.meta, deps.clock);
    this.companies = new CompanyProvisioning(deps.db);
    this.accounts = new AccountProvisioning(deps.db);
    this.subscriptions = new SubscriptionService(deps.db, deps.clock);
  }

  now(): number {
    return this.deps.clock();
  }

  publish(jobs: JobMessage[]): Promise<void> {
    return publishJobs(this.deps.queue, jobs, this.deps.logger);
  }
}
