import { z } from 'zod';

/**
 * Password policy approved by the Product Owner (D-03). Shared by the API (enforcement)
 * and the web app (live feedback), so the rules exist in one place only.
 */
export const PASSWORD_POLICY = {
  minLength: 8,
  maxLength: 128,
} as const;

export type PasswordRule = 'minLength' | 'uppercase' | 'lowercase' | 'number' | 'symbol';

const RULE_TESTS: Record<PasswordRule, (password: string) => boolean> = {
  minLength: (password) => password.length >= PASSWORD_POLICY.minLength,
  uppercase: (password) => /\p{Lu}/u.test(password),
  lowercase: (password) => /\p{Ll}/u.test(password),
  number: (password) => /\p{Nd}/u.test(password),
  symbol: (password) => /[^\p{L}\p{Nd}\s]/u.test(password),
};

export const PASSWORD_RULES = Object.keys(RULE_TESTS) as readonly PasswordRule[];

/** Every rule and whether the password meets it (for the live checklist in US-005). */
export function evaluatePassword(password: string): Record<PasswordRule, boolean> {
  return {
    minLength: RULE_TESTS.minLength(password),
    uppercase: RULE_TESTS.uppercase(password),
    lowercase: RULE_TESTS.lowercase(password),
    number: RULE_TESTS.number(password),
    symbol: RULE_TESTS.symbol(password),
  };
}

/** Schema for a *new* password. Issue messages are the rule names, so clients can translate them. */
export const newPasswordSchema = z
  .string()
  .max(PASSWORD_POLICY.maxLength, 'maxLength')
  .superRefine((password, context) => {
    for (const rule of PASSWORD_RULES) {
      if (!RULE_TESTS[rule](password)) context.addIssue({ code: 'custom', message: rule });
    }
  });
