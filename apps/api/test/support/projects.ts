import { generateId, type ProjectDto } from '@hse/shared';

import type { RoleCode } from '../../src/modules/identity';
import { TestClient } from './http';
import { seedCompany, type SeededCompany, seedSubscription, seedUser } from './seed';
import type { IntegrationEnv } from './test-env';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Project helpers shared by the Sprint 6 tests. */
export function projectHelpers(harness: () => IntegrationEnv) {
  let counter = 0;

  async function company(planCode = 'enterprise'): Promise<SeededCompany> {
    const seeded = await seedCompany(harness().env);
    await seedSubscription(harness().env, seeded.id, { planCode });
    return seeded;
  }

  async function signedIn(target: SeededCompany, role: RoleCode) {
    const account = await seedUser(harness().env, { companyId: target.id, role });
    const client = new TestClient(harness().env, target.host);
    await client.login(account.email, account.password);
    return { account, client };
  }

  async function createProject(
    client: TestClient,
    overrides: Record<string, unknown> = {},
  ): Promise<ProjectDto> {
    counter += 1;
    const result = await client.call<ProjectDto>('POST', '/projects', {
      body: {
        name: 'Riyadh Metro Extension',
        code: `RMX-${String(counter)}`,
        clientName: 'Riyadh Development Authority',
        countryCode: 'SA',
        startDate: '2026-12-01',
        status: 'active',
        ...overrides,
      },
    });
    if (result.status !== 201) throw new Error(`project not created: ${String(result.status)}`);
    return result.body.data;
  }

  /** A project role row, as US-008 would write it. */
  async function giveProjectRole(
    userId: string,
    target: SeededCompany,
    projectId: string,
    role: RoleCode,
    dates: { from?: number; until?: number } = {},
  ): Promise<string> {
    const id = generateId();
    await harness()
      .env.DB.prepare(
        `INSERT INTO user_role (id, user_id, role_code, scope_level, company_id, project_id,
           valid_from, valid_until, created_at, updated_at)
         VALUES (?, ?, ?, 'project', ?, ?, ?, ?, 0, 0)`,
      )
      .bind(id, userId, role, target.id, projectId, dates.from ?? null, dates.until ?? null)
      .run();
    return id;
  }

  /** Puts the company's subscription into read-only mode (PLT-11). */
  async function makeReadOnly(target: SeededCompany): Promise<void> {
    await harness()
      .env.DB.prepare(
        `UPDATE subscription SET status = 'read_only', trial_ends_at = ?, current_period_end = NULL
         WHERE company_id = ?`,
      )
      .bind(Date.now() - DAY_MS, target.id)
      .run();
  }

  return { company, signedIn, createProject, giveProjectRole, makeReadOnly };
}
