import { generateId, type Language } from '@hse/shared';

import { PasswordHasher } from '../../src/core/auth/password-hasher';
import type { Bindings } from '../../src/core/context/app-context';
import { createDatabase } from '../../src/database/client';
import { company, type CompanyStatus } from '../../src/modules/company/company.schema';
import {
  type RoleCode,
  user,
  userRole,
  type UserStatus,
} from '../../src/modules/identity/identity.schema';
import { TEST_VARS } from '../helpers';

export const TEST_PASSWORD = 'Site-Safety-1';

const hasher = new PasswordHasher(Number(TEST_VARS.PASSWORD_HASH_ITERATIONS));
let passwordHash: Promise<string> | undefined;

function uniqueSuffix(): string {
  return generateId().slice(0, 8);
}

export interface SeededCompany {
  id: string;
  slug: string;
  host: string;
}

export async function seedCompany(
  env: Bindings,
  options: { status?: CompanyStatus; defaultLanguage?: Language; slug?: string } = {},
): Promise<SeededCompany> {
  const id = generateId();
  const slug = options.slug ?? `co-${uniqueSuffix()}`;
  await createDatabase(env.DB)
    .insert(company)
    .values({
      id,
      name: `Company ${slug}`,
      slug,
      status: options.status ?? 'active',
      defaultLanguage: options.defaultLanguage ?? 'en',
      timeZone: 'Asia/Riyadh',
    });
  return { id, slug, host: `${slug}.${TEST_VARS.BASE_DOMAIN}` };
}

export interface SeededUser {
  id: string;
  email: string;
  password: string;
}

export async function seedUser(
  env: Bindings,
  options: {
    companyId: string | null;
    status?: UserStatus;
    role?: RoleCode;
    password?: string;
    lockedUntil?: number;
    failedLoginCount?: number;
  },
): Promise<SeededUser> {
  const id = generateId();
  const email = `user-${uniqueSuffix()}@example.com`;
  const password = options.password ?? TEST_PASSWORD;
  passwordHash ??= hasher.hash(TEST_PASSWORD);
  const hash = password === TEST_PASSWORD ? await passwordHash : await hasher.hash(password);

  const db = createDatabase(env.DB);
  await db.insert(user).values({
    id,
    companyId: options.companyId,
    email,
    fullName: 'Test User',
    passwordHash: hash,
    status: options.status ?? 'active',
    failedLoginCount: options.failedLoginCount ?? 0,
    lockedUntil: options.lockedUntil ? new Date(options.lockedUntil) : null,
  });
  await db.insert(userRole).values({
    id: generateId(),
    userId: id,
    roleCode: options.role ?? (options.companyId ? 'safety_officer' : 'system_owner'),
    scopeLevel: options.companyId ? 'company' : 'platform',
    companyId: options.companyId,
  });
  return { id, email, password };
}

const DAY_MS = 24 * 60 * 60 * 1000;

export interface SeedSubscriptionOptions {
  planCode?: string;
  status?: 'trial' | 'active' | 'grace' | 'read_only';
  /** Defaults to 14 days from now (a running trial). */
  trialEndsAt?: number | null;
  currentPeriodStart?: number | null;
  currentPeriodEnd?: number | null;
  billingCycle?: 'monthly' | 'annual' | null;
}

/** A subscription row for a seeded company (PLT-06, PLT-10). Returns its id. */
export async function seedSubscription(
  env: Bindings,
  companyId: string,
  options: SeedSubscriptionOptions = {},
): Promise<string> {
  const id = generateId();
  const trialEndsAt =
    options.trialEndsAt === undefined ? Date.now() + 14 * DAY_MS : options.trialEndsAt;
  await env.DB.prepare(
    `INSERT INTO subscription (id, company_id, plan_id, status, trial_started_at, trial_ends_at,
       billing_cycle, current_period_start, current_period_end, created_at, updated_at)
     SELECT ?, ?, id, ?, ?, ?, ?, ?, ?, 0, 0 FROM plan WHERE code = ?`,
  )
    .bind(
      id,
      companyId,
      options.status ?? 'trial',
      trialEndsAt === null ? null : trialEndsAt - 14 * DAY_MS,
      trialEndsAt,
      options.billingCycle ?? null,
      options.currentPeriodStart ?? null,
      options.currentPeriodEnd ?? null,
      options.planCode ?? 'basic',
    )
    .run();
  return id;
}
