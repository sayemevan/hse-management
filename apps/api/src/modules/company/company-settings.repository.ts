import {
  type CompanySettingsDto,
  DEFAULT_COMPANY_SETTINGS,
  type Language,
  type WeekDay,
  WEEK_DAYS,
  type WeekStart,
} from '@hse/shared';
import { eq } from 'drizzle-orm';

import type { Database } from '../../database/client';
import type { Statement } from '../../database/unit-of-work';
import { companySettings, type CompanySettingsRow } from './company.schema';

export interface CompanySettingsValues {
  dateFormat: CompanySettingsDto['dateFormat'];
  timeFormat: CompanySettingsDto['timeFormat'];
  weekStart: WeekStart;
  workingDays: readonly WeekDay[];
}

export function toWorkingDaysMask(days: readonly WeekDay[]): number {
  return days.reduce<number>((mask, day) => mask | (1 << day), 0);
}

export function fromWorkingDaysMask(mask: number): WeekDay[] {
  return WEEK_DAYS.filter((day) => (mask & (1 << day)) !== 0);
}

/** The only code that reads or writes `company_settings` (US-013). */
export class CompanySettingsRepository {
  constructor(private readonly db: Database) {}

  async find(companyId: string): Promise<CompanySettingsRow | undefined> {
    return this.db
      .select()
      .from(companySettings)
      .where(eq(companySettings.companyId, companyId))
      .get();
  }

  /** Settings with defaults when the row doesn't exist yet. */
  async settingsFor(
    companyId: string,
    defaultLanguage: Language,
    companyUpdatedAt: number,
  ): Promise<CompanySettingsDto> {
    const row = await this.find(companyId);
    return toSettingsDto(row, defaultLanguage, companyUpdatedAt);
  }

  /** Insert or update (the migration back-fills rows, but a missing row must not break saving). */
  upsert(
    companyId: string,
    values: CompanySettingsValues,
    actorId: string,
    now: number,
  ): Statement {
    const at = new Date(now);
    const columns = {
      dateFormat: values.dateFormat,
      timeFormat: values.timeFormat,
      weekStart: values.weekStart,
      workingDaysMask: toWorkingDaysMask(values.workingDays),
      updatedAt: at,
      updatedBy: actorId,
    };
    return this.db
      .insert(companySettings)
      .values({ companyId, ...columns, createdAt: at, createdBy: actorId })
      .onConflictDoUpdate({ target: companySettings.companyId, set: columns });
  }

  /** Default settings for a newly approved company (US-011.3). */
  createDefaults(companyId: string, actorId: string): Statement {
    return this.db.insert(companySettings).values({
      companyId,
      createdBy: actorId,
      updatedBy: actorId,
    });
  }
}

/**
 * `updatedAt` is the later of the settings row and the company row, because the default
 * language lives on `company` (optimistic concurrency covers both).
 */
export function toSettingsDto(
  row: CompanySettingsRow | undefined,
  defaultLanguage: Language,
  companyUpdatedAt: number,
): CompanySettingsDto {
  return {
    defaultLanguage,
    dateFormat: row?.dateFormat ?? DEFAULT_COMPANY_SETTINGS.dateFormat,
    timeFormat: row?.timeFormat ?? DEFAULT_COMPANY_SETTINGS.timeFormat,
    weekStart: (row?.weekStart ?? DEFAULT_COMPANY_SETTINGS.weekStart) as WeekStart,
    workingDays: row
      ? fromWorkingDaysMask(row.workingDaysMask)
      : [...DEFAULT_COMPANY_SETTINGS.workingDays],
    updatedAt: Math.max(row?.updatedAt.getTime() ?? 0, companyUpdatedAt),
  };
}
