/**
 * PLT-04 — creates the first System Owner.
 *
 *   npm run bootstrap:system-owner --workspace @hse/api -- --env local
 *   npm run bootstrap:system-owner --workspace @hse/api -- --env staging [--add]
 *
 * The password is typed (hidden) or piped on stdin — never passed as an argument or read
 * from a file. Only the hash leaves this process.
 */
import { generateId, loginRequestSchema, newPasswordSchema } from '@hse/shared';
import { parseArgs } from 'node:util';
import { z } from 'zod';

import { PasswordHasher } from '../src/core/auth/password-hasher';
import {
  type D1Target,
  executeStatements,
  queryRows,
  readWranglerVar,
  sqlString,
} from './lib/d1-cli';
import { Prompt } from './lib/prompt';
import { buildSystemOwnerStatements } from './lib/system-owner';

const { values } = parseArgs({
  options: { env: { type: 'string', default: 'local' }, add: { type: 'boolean', default: false } },
});
const target: D1Target = { environment: values.env };

async function main(): Promise<void> {
  const existing =
    queryRows<{ n: number }>(
      target,
      "SELECT count(*) AS n FROM user_role WHERE role_code = 'system_owner'",
    )[0]?.n ?? 0;
  if (existing > 0 && !values.add) {
    throw new Error(
      `A System Owner already exists in "${target.environment}". Pass --add to create another.`,
    );
  }

  const prompt = new Prompt();
  try {
    const email = loginRequestSchema.shape.email.parse(await prompt.ask('Email: '));
    const fullName = z
      .string()
      .trim()
      .min(1, 'Full name is required.')
      .max(200)
      .parse(await prompt.ask('Full name: '));

    const password = await prompt.askSecret('Password: ');
    const policy = newPasswordSchema.safeParse(password);
    if (!policy.success) {
      throw new Error(
        `Password does not meet the policy: ${policy.error.issues.map((issue) => issue.message).join(', ')}`,
      );
    }
    if ((await prompt.askSecret('Confirm password: ')) !== password) {
      throw new Error('The passwords do not match.');
    }

    const taken =
      queryRows<{ n: number }>(
        target,
        `SELECT count(*) AS n FROM user WHERE email = ${sqlString(email)}`,
      )[0]?.n ?? 0;
    if (taken > 0) throw new Error('A user with this email already exists.');

    const passwordHash = await new PasswordHasher(
      Number(readWranglerVar(target, 'PASSWORD_HASH_ITERATIONS')),
    ).hash(password);
    executeStatements(
      target,
      buildSystemOwnerStatements({
        userId: generateId(),
        roleId: generateId(),
        auditId: generateId(),
        email,
        fullName,
        passwordHash,
        now: Date.now(),
      }),
    );
    console.log(
      `System Owner ${email} created in "${target.environment}". Sign in on the base domain.`,
    );
  } finally {
    prompt.close();
  }
}

main().catch((error: unknown) => {
  console.error(
    error instanceof z.ZodError
      ? error.issues.map((issue) => issue.message).join('\n')
      : error instanceof Error
        ? error.message
        : error,
  );
  process.exitCode = 1;
});
