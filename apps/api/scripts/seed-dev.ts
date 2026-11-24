/**
 * Local development data only (never runs against a remote environment):
 *   npm run db:seed:dev --workspace @hse/api
 *
 * Creates two companies (each on a 14-day Basic trial), sample users and a System Owner so sign-in can be tried on
 *   http://demo.localhost:3000  (English)  and  http://arabic-demo.localhost:3000  (Arabic)
 * Every sample account uses DEV_PASSWORD below. Safe to run repeatedly.
 */
import { PasswordHasher } from '../src/core/auth/password-hasher';
import { type D1Target, executeStatements, readWranglerVar, sqlString } from './lib/d1-cli';

const DEV_PASSWORD = 'Demo-Safety-2026!';
const TRIAL_MS = 14 * 24 * 60 * 60 * 1000;

const target: D1Target = { environment: 'local' };

const companies = [
  {
    id: '00000000-0000-4000-8000-000000000001',
    slug: 'demo',
    name: 'Demo Construction Co.',
    language: 'en',
  },
  {
    id: '00000000-0000-4000-8000-000000000002',
    slug: 'arabic-demo',
    name: 'شركة الإنشاءات التجريبية',
    language: 'ar',
  },
] as const;

const users = [
  {
    id: '00000000-0000-4000-8000-000000000100',
    companyId: null,
    email: 'system-owner@dev.test',
    name: 'Dev System Owner',
    role: 'system_owner',
  },
  {
    id: '00000000-0000-4000-8000-000000000101',
    companyId: companies[0].id,
    email: 'admin@demo.test',
    name: 'Demo Admin',
    role: 'company_administrator',
  },
  {
    id: '00000000-0000-4000-8000-000000000102',
    companyId: companies[0].id,
    email: 'officer@demo.test',
    name: 'Demo Safety Officer',
    role: 'safety_officer',
  },
  {
    id: '00000000-0000-4000-8000-000000000103',
    companyId: companies[1].id,
    email: 'admin@arabic-demo.test',
    name: 'مدير تجريبي',
    role: 'company_administrator',
  },
] as const;

async function main(): Promise<void> {
  const hash = await new PasswordHasher(
    Number(readWranglerVar(target, 'PASSWORD_HASH_ITERATIONS')),
  ).hash(DEV_PASSWORD);
  const now = String(Date.now());

  const statements = [
    ...companies.map(
      (company) =>
        `INSERT OR IGNORE INTO company (id, name, slug, status, default_language, time_zone, created_at, updated_at) VALUES (${sqlString(company.id)}, ${sqlString(company.name)}, ${sqlString(company.slug)}, 'active', ${sqlString(company.language)}, 'Asia/Riyadh', ${now}, ${now})`,
    ),
    // Sprint 4: a 14-day Basic trial from the first seed, so the lifecycle can be tried.
    ...companies.map(
      (company, index) =>
        `INSERT OR IGNORE INTO subscription (id, company_id, plan_id, status, trial_started_at, trial_ends_at, created_at, updated_at) SELECT ${sqlString(`00000000-0000-4000-8000-00000000030${String(index + 1)}`)}, ${sqlString(company.id)}, id, 'trial', ${now}, ${String(Date.now() + TRIAL_MS)}, ${now}, ${now} FROM plan WHERE code = 'basic'`,
    ),
    ...users.flatMap((account) => [
      `INSERT OR IGNORE INTO user (id, company_id, email, full_name, password_hash, status, failed_login_count, created_at, updated_at) VALUES (${sqlString(account.id)}, ${sqlString(account.companyId)}, ${sqlString(account.email)}, ${sqlString(account.name)}, ${sqlString(hash)}, 'active', 0, ${now}, ${now})`,
      `INSERT OR IGNORE INTO user_role (id, user_id, role_code, scope_level, company_id, created_at, updated_at) VALUES (${sqlString(account.id.replace(/01(\d\d)$/, '02$1'))}, ${sqlString(account.id)}, ${sqlString(account.role)}, ${sqlString(account.companyId ? 'company' : 'platform')}, ${sqlString(account.companyId)}, ${now}, ${now})`,
    ]),
  ];

  executeStatements(target, statements);
  console.log('Local development data is ready:');
  for (const account of users) {
    const company = companies.find((candidate) => candidate.id === account.companyId);
    const host = company ? `${company.slug}.localhost` : 'localhost';
    console.log(`  http://${host}:3000  ${account.email}`);
  }
  console.log(
    'Password for every sample account: see DEV_PASSWORD in apps/api/scripts/seed-dev.ts',
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
