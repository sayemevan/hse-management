import { zValidator } from '@hono/zod-validator';
import type { ValidationIssue } from '@hse/shared';
import type { ValidationTargets } from 'hono';
import type { z } from 'zod';

import { ValidationError } from '../errors/app-error';

/**
 * Validates a request part against a Zod schema before the handler runs
 * (API Rules: "Validate every request before processing").
 * Failures become a 422 with field-level `details` in the standard error envelope.
 *
 * @example
 * router.post('/', validate('json', createInspectionSchema), (c) => { const body = c.req.valid('json'); ... })
 */
export const validate = <TTarget extends keyof ValidationTargets, TSchema extends z.ZodType>(
  target: TTarget,
  schema: TSchema,
) =>
  zValidator(target, schema, (result) => {
    if (!result.success) {
      throw new ValidationError(toIssues(result.error.issues));
    }
  });

export function toIssues(issues: readonly z.core.$ZodIssue[]): ValidationIssue[] {
  return issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    message: issue.message,
  }));
}
