import type {
  CompanyAccountDto,
  CompanyInformationDto,
  CompanyProfileDto,
  CompanySettingsDto,
  companySettingsRequestSchema,
  Language,
  LogoDto,
  updateCompanyRequestSchema,
} from '@hse/shared';
import type { z } from 'zod';

import type { Principal } from '../../core/auth/principal';
import type { TenantCompany } from '../../core/context/tenant';
import { NotFoundError } from '../../core/errors/app-error';
import type { RequestMeta } from '../../core/http/request-meta';
import type { Logger } from '../../core/logging/logger';
import type { Database } from '../../database/client';
import { UnitOfWork } from '../../database/unit-of-work';
import { AuditLogService } from '../../platform/audit-log';
import {
  type FileCategory,
  FileStorageService,
  MODULE_SERVED_CATEGORIES,
  type OpenedFile,
} from '../../platform/file-storage';
import {
  CompanyChangedError,
  type CompanyDirectory,
  type CompanyProfileUpdate,
  CompanyReadOnlyError,
  CompanyRepository,
  type CompanyRow,
  CompanySettingsRepository,
  logoUrlFor,
  toSettingsDto,
} from '../company';
import { UserCounter } from '../identity';
import { ProjectCounter } from '../project';
import {
  type LifecycleSettings,
  PlanLimitService,
  planName,
  SubscriptionService,
  toPlanDto,
} from '../subscription';

export interface CompanyAdminDependencies {
  db: Database;
  bucket: R2Bucket;
  directory: CompanyDirectory;
  meta: RequestMeta;
  logger: Logger;
  clock: () => number;
  /** Subscription lifecycle lengths (PLT-10), for the state shown on the information page. */
  lifecycle: LifecycleSettings;
}

type SettingsInput = z.output<typeof companySettingsRequestSchema>;
type CompanyInput = z.output<typeof updateCompanyRequestSchema>;

const PROFILE_FIELDS = [
  'name',
  'registrationNumber',
  'countryCode',
  'city',
  'address',
  'timeZone',
  'contactEmail',
  'contactPhone',
] as const satisfies readonly (keyof CompanyProfileUpdate & keyof CompanyRow)[];

/**
 * The Company Administrator's side of the company (US-012 – US-015): profile, settings and
 * logo, plus the read-only information page for every user.
 */
export class CompanyAdminService {
  private readonly companies: CompanyRepository;
  private readonly settings: CompanySettingsRepository;
  private readonly files: FileStorageService;
  private readonly audit: AuditLogService;

  constructor(private readonly deps: CompanyAdminDependencies) {
    this.companies = new CompanyRepository(deps.db);
    this.settings = new CompanySettingsRepository(deps.db);
    this.files = new FileStorageService(deps.db, deps.bucket, deps.clock);
    this.audit = new AuditLogService(deps.db, deps.meta, deps.clock);
  }

  /** US-015: profile for everyone; account summary for administrators only (FR-2). */
  async information(
    tenant: TenantCompany,
    options: { includeAccount: boolean; language: Language },
  ): Promise<CompanyInformationDto> {
    const row = await this.load(tenant);
    const profile = toProfileDto(row);
    // PLT-13 FR-10: plan, state and end date for every user; amounts and usage for admins only.
    const access = await new SubscriptionService(this.deps.db, this.deps.clock).access(
      row.id,
      this.deps.lifecycle,
    );
    const subscription = access
      ? {
          planName: planName(access.plan, options.language),
          state: access.state,
          endsAt: access.deadline,
        }
      : null;
    if (!options.includeAccount) return { profile, subscription };
    return { profile, subscription, account: await this.account(row, options.language) };
  }

  /** US-012: changed fields only; slug and status are out of reach (O-29). */
  async updateProfile(
    tenant: TenantCompany,
    principal: Principal,
    input: CompanyInput,
  ): Promise<CompanyProfileDto> {
    this.requireWritable(tenant);
    const row = await this.load(tenant);
    if (row.updatedAt.getTime() !== input.updatedAt) throw new CompanyChangedError();

    const changes: CompanyProfileUpdate = {};
    const oldValue: Record<string, unknown> = {};
    for (const field of PROFILE_FIELDS) {
      const value = input[field];
      if (value === undefined || value === row[field]) continue;
      (changes as Record<string, unknown>)[field] = value;
      oldValue[field] = row[field];
    }
    if (Object.keys(changes).length === 0) return toProfileDto(row);

    const now = this.deps.clock();
    await new UnitOfWork(this.deps.db)
      .add(
        this.companies.update(row.id, changes, principal.userId, now),
        this.audit.entry({
          action: 'company.updated',
          actorUserId: principal.userId,
          companyId: row.id,
          entityType: 'company',
          entityId: row.id,
          oldValue,
          newValue: { ...changes },
        }),
      )
      .commit();
    await this.deps.directory.invalidate(row.slug);
    return toProfileDto({ ...row, ...changes, updatedAt: new Date(now) });
  }

  async getSettings(tenant: TenantCompany): Promise<CompanySettingsDto> {
    const row = await this.load(tenant);
    return this.settings.settingsFor(row.id, row.defaultLanguage, row.updatedAt.getTime());
  }

  /** US-013. The default language lives on `company`; the rest in `company_settings`. */
  async updateSettings(
    tenant: TenantCompany,
    principal: Principal,
    input: SettingsInput,
  ): Promise<CompanySettingsDto> {
    this.requireWritable(tenant);
    const row = await this.load(tenant);
    const current = toSettingsDto(
      await this.settings.find(row.id),
      row.defaultLanguage,
      row.updatedAt.getTime(),
    );
    if (current.updatedAt !== input.updatedAt) throw new CompanyChangedError();

    const next = input;
    const now = this.deps.clock();
    const work = new UnitOfWork(this.deps.db).add(
      this.settings.upsert(row.id, next, principal.userId, now),
      this.audit.entry({
        action: 'company.settings.updated',
        actorUserId: principal.userId,
        companyId: row.id,
        entityType: 'company',
        entityId: row.id,
        oldValue: withoutStamp(current),
        newValue: {
          defaultLanguage: next.defaultLanguage,
          dateFormat: next.dateFormat,
          timeFormat: next.timeFormat,
          weekStart: next.weekStart,
          workingDays: next.workingDays,
        },
      }),
    );
    const languageChanged = next.defaultLanguage !== row.defaultLanguage;
    if (languageChanged) {
      work.add(
        this.companies.update(
          row.id,
          { defaultLanguage: next.defaultLanguage },
          principal.userId,
          now,
        ),
      );
    }
    await work.commit();
    if (languageChanged) await this.deps.directory.invalidate(row.slug);

    return {
      defaultLanguage: next.defaultLanguage,
      dateFormat: next.dateFormat,
      timeFormat: next.timeFormat,
      weekStart: next.weekStart,
      workingDays: [...next.workingDays],
      updatedAt: now,
    };
  }

  /** US-014 FR-1, FR-2: store the new logo and retire the old one in one batch. */
  async setLogo(tenant: TenantCompany, principal: Principal, upload: File): Promise<LogoDto> {
    this.requireWritable(tenant);
    const row = await this.load(tenant);
    const stored = await this.files.store({
      companyId: row.id,
      category: 'company_logo',
      uploadedBy: principal.userId,
      file: upload,
      // PLT-12 FR-5: the plan's storage quota, checked before anything is written.
      beforeWrite: async (sizeBytes) =>
        new PlanLimitService(new SubscriptionService(this.deps.db, this.deps.clock)).assertCanAdd(
          row.id,
          'storage',
          await this.files.usedBytes(row.id),
          sizeBytes,
        ),
    });
    const now = this.deps.clock();
    const work = new UnitOfWork(this.deps.db).add(
      stored.statement,
      this.audit.entry({
        action: 'file.uploaded',
        actorUserId: principal.userId,
        companyId: row.id,
        entityType: 'file',
        entityId: stored.row.id,
        newValue: {
          category: stored.row.category,
          sizeBytes: stored.row.sizeBytes,
          contentType: stored.row.contentType,
        },
      }),
      this.companies.setLogo(row.id, stored.row.id, principal.userId, now),
      this.audit.entry({
        action: 'company.logo.updated',
        actorUserId: principal.userId,
        companyId: row.id,
        entityType: 'company',
        entityId: row.id,
        oldValue: { logoFileId: row.logoFileId },
        newValue: { logoFileId: stored.row.id },
      }),
    );
    if (row.logoFileId) work.add(...this.retireFile(row, principal.userId));
    await work.commit();
    await this.deps.directory.invalidate(row.slug);
    return { logoUrl: logoUrlFor(stored.row.id) };
  }

  /** US-014 FR-4 (removal): the platform mark comes back. */
  async removeLogo(tenant: TenantCompany, principal: Principal): Promise<void> {
    this.requireWritable(tenant);
    const row = await this.load(tenant);
    if (!row.logoFileId) return;
    const now = this.deps.clock();
    await new UnitOfWork(this.deps.db)
      .add(
        this.companies.setLogo(row.id, null, principal.userId, now),
        this.audit.entry({
          action: 'company.logo.removed',
          actorUserId: principal.userId,
          companyId: row.id,
          entityType: 'company',
          entityId: row.id,
          oldValue: { logoFileId: row.logoFileId },
        }),
        ...this.retireFile(row, principal.userId),
      )
      .commit();
    await this.deps.directory.invalidate(row.slug);
  }

  /** The current logo (public on the company's subdomain, FR-3). */
  async openLogo(tenant: TenantCompany): Promise<OpenedFile | null> {
    if (!tenant.logoFileId) return null;
    return this.files.open(tenant.logoFileId, tenant.id);
  }

  /** PLT-07: any file of this company, or null (the route answers 404, never 403). */
  async openFile(tenant: TenantCompany, fileId: string): Promise<OpenedFile | null> {
    const row = await this.files.find(fileId, tenant.id);
    // T-49: workforce files are served only by the workforce routes, which check access.
    if (!row || MODULE_SERVED_CATEGORIES.includes(row.category as FileCategory)) return null;
    return this.files.open(fileId, tenant.id);
  }

  private retireFile(row: CompanyRow, actorId: string) {
    if (!row.logoFileId) return [];
    return [
      this.files.remove(row.logoFileId, actorId),
      this.audit.entry({
        action: 'file.deleted',
        actorUserId: actorId,
        companyId: row.id,
        entityType: 'file',
        entityId: row.logoFileId,
        newValue: { category: 'company_logo' },
      }),
    ];
  }

  private async account(row: CompanyRow, language: Language): Promise<CompanyAccountDto> {
    const [subscription, seats, projects, usedBytes] = await Promise.all([
      new SubscriptionService(this.deps.db, this.deps.clock).forCompany(row.id),
      new UserCounter(this.deps.db).seats(row.id),
      new ProjectCounter(this.deps.db).projects(row.id),
      this.files.usedBytes(row.id),
    ]);
    const plan = subscription ? toPlanDto(subscription.plan, language) : null;
    return {
      planCode: plan?.code ?? '',
      planName: plan?.name ?? '',
      subscriptionStatus: subscription?.subscription.status ?? 'none',
      trialEndsAt: subscription?.subscription.trialEndsAt?.getTime() ?? null,
      currentPeriodEnd: subscription?.subscription.currentPeriodEnd?.getTime() ?? null,
      users: { used: seats, limit: plan?.maxUsers ?? null },
      projects: { used: projects, limit: plan?.maxProjects ?? null },
      storage: { usedBytes, limitBytes: plan?.maxStorageBytes ?? 0 },
    };
  }

  private async load(tenant: TenantCompany): Promise<CompanyRow> {
    const row = await this.companies.findById(tenant.id);
    if (!row) throw new NotFoundError();
    return row;
  }

  /** D-30: read-only companies view but don't change. */
  private requireWritable(tenant: TenantCompany): void {
    if (tenant.readOnly) throw new CompanyReadOnlyError();
  }
}

export function toProfileDto(row: CompanyRow): CompanyProfileDto {
  return {
    name: row.name,
    slug: row.slug,
    registrationNumber: row.registrationNumber,
    countryCode: row.countryCode,
    city: row.city,
    address: row.address,
    timeZone: row.timeZone,
    defaultLanguage: row.defaultLanguage,
    contactEmail: row.contactEmail,
    contactPhone: row.contactPhone,
    logoUrl: logoUrlFor(row.logoFileId),
    updatedAt: row.updatedAt.getTime(),
  };
}

function withoutStamp(settings: CompanySettingsDto): Record<string, unknown> {
  const { updatedAt: _updatedAt, ...rest } = settings;
  return rest;
}
