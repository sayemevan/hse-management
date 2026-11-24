import type { Language } from '@hse/shared';
import type { z } from 'zod';

import type { EmailContent } from './email-layout';

/**
 * Building blocks shared by the template files (PLT-05, T-12). Each template validates its
 * data and, if it carries a secret link, its secrets. Secrets travel only in the queue
 * message, never in the outbox.
 */
export interface TemplateDefinition<TData extends z.ZodType, TSecrets extends z.ZodType | null> {
  data: TData;
  secrets: TSecrets;
  content: (
    language: Language,
    data: z.output<TData>,
    secrets: TSecrets extends z.ZodType ? z.output<TSecrets> : null,
  ) => EmailContent;
}

export const define = <TData extends z.ZodType, TSecrets extends z.ZodType | null>(
  definition: TemplateDefinition<TData, TSecrets>,
) => definition;

export const footer = {
  en: 'This email was sent by the HSE Management Platform. If you did not expect it, you can ignore it.',
  ar: 'أُرسلت هذه الرسالة من منصة إدارة الصحة والسلامة والبيئة. إذا لم تكن تتوقعها، يمكنك تجاهلها.',
};

export function formatDate(language: Language, epochMs: number, timeZone: string): string {
  return new Intl.DateTimeFormat(language === 'ar' ? 'ar-u-nu-latn' : 'en', {
    dateStyle: 'long',
    timeZone,
  }).format(epochMs);
}

/** SAR with two decimals and Western digits in both languages (O-10). */
export function formatAmount(language: Language, riyals: number): string {
  const value = new Intl.NumberFormat('en', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(riyals);
  return language === 'ar' ? `${value} ريال` : `SAR ${value}`;
}
