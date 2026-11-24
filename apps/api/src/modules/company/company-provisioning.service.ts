import type { Database } from '../../database/client';
import type { Statement } from '../../database/unit-of-work';
import { CompanyRepository, type NewCompany } from './company.repository';
import { CompanySettingsRepository } from './company-settings.repository';

/**
 * What other modules may ask of the company module when a company is created (US-011.3).
 * Returns statements so the caller can commit them atomically with its own changes.
 */
export class CompanyProvisioning {
  private readonly companies: CompanyRepository;
  private readonly settings: CompanySettingsRepository;

  constructor(db: Database) {
    this.companies = new CompanyRepository(db);
    this.settings = new CompanySettingsRepository(db);
  }

  async isSlugTaken(slug: string): Promise<boolean> {
    return (await this.companies.findBySlug(slug)) !== undefined;
  }

  /** The company and its default settings (US-013). */
  createCompany(input: NewCompany): Statement[] {
    return [this.companies.create(input), this.settings.createDefaults(input.id, input.createdBy)];
  }
}
