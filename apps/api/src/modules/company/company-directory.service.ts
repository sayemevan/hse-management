import type { TenantCompany } from '../../core/context/tenant';
import type { Logger } from '../../core/logging/logger';
import type { CompanyRepository } from './company.repository';
import type { CompanyRow, CompanyStatus } from './company.schema';

/** Statuses whose subdomain resolves. `read_only` still signs in (D-18). */
const ACCESSIBLE_STATUSES: readonly CompanyStatus[] = ['active', 'read_only'];

const cacheKey = (slug: string) => `tenant:slug:${slug}`;

interface CachedCompany {
  id: string;
  name: string;
  slug: string;
  status: CompanyStatus;
  defaultLanguage: TenantCompany['defaultLanguage'];
  timeZone: string;
  logoFileId: string | null;
}

/**
 * Looks up companies by subdomain slug, with a short KV cache (PLT-02: at most 5 minutes,
 * configurable). Callers that change a company's status must call `invalidate()`.
 */
export class CompanyDirectory {
  constructor(
    private readonly companies: CompanyRepository,
    private readonly cache: KVNamespace,
    private readonly cacheTtlSeconds: number,
    private readonly logger: Logger,
  ) {}

  /** Returns the company if its subdomain may be used, otherwise null. */
  async findAccessibleBySlug(slug: string): Promise<TenantCompany | null> {
    const record = await this.load(slug);
    if (!record || !ACCESSIBLE_STATUSES.includes(record.status)) return null;
    return {
      id: record.id,
      name: record.name,
      slug: record.slug,
      defaultLanguage: record.defaultLanguage,
      timeZone: record.timeZone,
      logoFileId: record.logoFileId,
      readOnly: record.status === 'read_only',
    };
  }

  async invalidate(slug: string): Promise<void> {
    await this.cache.delete(cacheKey(slug));
  }

  private async load(slug: string): Promise<CachedCompany | null> {
    try {
      const cached = await this.cache.get<CachedCompany>(cacheKey(slug), 'json');
      if (cached) return cached;
    } catch (error) {
      // The cache is an optimisation only: fall back to the database.
      this.logger.warn('tenant cache read failed', { error });
    }

    const row = await this.companies.findBySlug(slug);
    if (!row) return null;

    const record = toCached(row);
    try {
      await this.cache.put(cacheKey(slug), JSON.stringify(record), {
        expirationTtl: this.cacheTtlSeconds,
      });
    } catch (error) {
      this.logger.warn('tenant cache write failed', { error });
    }
    return record;
  }
}

function toCached(row: CompanyRow): CachedCompany {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    status: row.status,
    defaultLanguage: row.defaultLanguage,
    timeZone: row.timeZone,
    logoFileId: row.logoFileId,
  };
}
