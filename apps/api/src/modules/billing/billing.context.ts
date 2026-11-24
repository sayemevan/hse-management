import type { AppConfig } from '../../config/config';
import type { RequestMeta } from '../../core/http/request-meta';
import type { Logger } from '../../core/logging/logger';
import type { Database } from '../../database/client';
import { AuditLogService } from '../../platform/audit-log';
import { EmailService } from '../../platform/email';
import { FileStorageService } from '../../platform/file-storage';
import { type JobMessage, publishJobs } from '../../platform/jobs';
import { ReminderService } from '../../platform/reminders';
import { CompanyDirectory, CompanyRepository } from '../company';
import { AccountProvisioning, UserCounter } from '../identity';
import { ProjectCounter } from '../project';
import {
  type LifecycleSettings,
  PaymentRepository,
  PlanLimitService,
  type SubscriptionAccess,
  SubscriptionService,
} from '../subscription';
import type { UsageDto } from '@hse/shared';

/** Everything a billing service needs for one request or one scheduled run. */
export interface BillingDependencies {
  db: Database;
  config: AppConfig;
  meta: RequestMeta;
  logger: Logger;
  queue: Queue;
  cache: KVNamespace;
  bucket: R2Bucket;
  clock: () => number;
}

/** Repositories and the services of other modules, created once per request. */
export class BillingContext {
  readonly subscriptions: SubscriptionService;
  readonly payments: PaymentRepository;
  readonly limits: PlanLimitService;
  readonly companies: CompanyRepository;
  readonly directory: CompanyDirectory;
  readonly accounts: AccountProvisioning;
  readonly seats: UserCounter;
  readonly files: FileStorageService;
  readonly audit: AuditLogService;
  readonly emails: EmailService;
  readonly reminders: ReminderService;

  constructor(readonly deps: BillingDependencies) {
    this.subscriptions = new SubscriptionService(deps.db, deps.clock);
    this.payments = new PaymentRepository(deps.db);
    this.limits = new PlanLimitService(this.subscriptions);
    this.companies = new CompanyRepository(deps.db);
    this.directory = new CompanyDirectory(
      this.companies,
      deps.cache,
      deps.config.tenancy.cacheTtlSeconds,
      deps.logger,
    );
    this.accounts = new AccountProvisioning(deps.db);
    this.seats = new UserCounter(deps.db);
    this.files = new FileStorageService(deps.db, deps.bucket, deps.clock);
    this.audit = new AuditLogService(deps.db, deps.meta, deps.clock);
    this.emails = new EmailService(deps.db, deps.clock);
    this.reminders = new ReminderService(deps.db, deps.queue, deps.logger, deps.clock);
  }

  get lifecycle(): LifecycleSettings {
    return this.deps.config.billing;
  }

  now(): number {
    return this.deps.clock();
  }

  access(companyId: string): Promise<SubscriptionAccess | undefined> {
    return this.subscriptions.access(companyId, this.lifecycle);
  }

  /** PLT-12 FR-3: each count comes from the module that owns the data. */
  async usage(companyId: string): Promise<UsageDto> {
    const [users, projects, storageBytes] = await Promise.all([
      this.seats.seats(companyId),
      new ProjectCounter(this.deps.db).projects(companyId),
      this.files.usedBytes(companyId),
    ]);
    return { users, projects, storageBytes };
  }

  publish(jobs: JobMessage[]): Promise<void> {
    return publishJobs(this.deps.queue, jobs, this.deps.logger);
  }
}
