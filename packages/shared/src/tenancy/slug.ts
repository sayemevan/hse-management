import { z } from 'zod';

/** Company subdomain rules (D-16). */
export const SLUG_RULES = {
  minLength: 3,
  maxLength: 30,
} as const;

export const RESERVED_SLUGS: readonly string[] = ['www', 'admin', 'api', 'app', 'mail'];

const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export function isValidSlug(value: string): boolean {
  return (
    value.length >= SLUG_RULES.minLength &&
    value.length <= SLUG_RULES.maxLength &&
    SLUG_PATTERN.test(value) &&
    !RESERVED_SLUGS.includes(value)
  );
}

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .refine(isValidSlug, { message: 'invalidSlug' });
