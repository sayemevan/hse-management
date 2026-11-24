import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase } from '../../src/database/client';
import { UnitOfWork } from '../../src/database/unit-of-work';
import { company } from '../../src/modules/company/company.schema';
import { AuditLogService, auditLog, serializeValue } from '../../src/platform/audit-log';
import type { AuditAction } from '../../src/platform/audit-log';
import { type IntegrationEnv, startIntegrationEnv } from '../support/test-env';

let harness: IntegrationEnv;
beforeAll(async () => {
  harness = await startIntegrationEnv();
});
afterAll(async () => {
  await harness.dispose();
});

const request = { requestId: 'req-1', ipAddress: '10.0.0.1', userAgent: 'vitest' };

describe('AuditLogService (PLT-01)', () => {
  it('records every required field', async () => {
    const db = createDatabase(harness.env.DB);
    const audit = new AuditLogService(db, request, () => 1_700_000_000_000);
    await audit.record({
      action: 'auth.logout',
      actorUserId: 'user-1',
      companyId: 'company-1',
      entityType: 'user_session',
      entityId: 'session-1',
      newValue: { reason: 'logout' },
    });

    const rows = await db.select().from(auditLog).all();
    const row = rows.find((candidate) => candidate.entityId === 'session-1');
    expect(row).toMatchObject({
      action: 'auth.logout',
      actorUserId: 'user-1',
      companyId: 'company-1',
      outcome: 'success',
      requestId: 'req-1',
      ipAddress: '10.0.0.1',
      userAgent: 'vitest',
      newValue: '{"reason":"logout"}',
    });
    expect(row?.occurredAt.getTime()).toBe(1_700_000_000_000);
  });

  it('rejects UPDATE and DELETE at the database level', async () => {
    await expect(harness.env.DB.prepare("UPDATE audit_log SET action = 'x'").run()).rejects.toThrow(
      /append-only/,
    );
    await expect(harness.env.DB.prepare('DELETE FROM audit_log').run()).rejects.toThrow(
      /append-only/,
    );
  });

  it('rejects unknown action names', () => {
    const audit = new AuditLogService(createDatabase(harness.env.DB), request);
    expect(() =>
      audit.entry({ action: 'not.registered' as AuditAction, actorUserId: null }),
    ).toThrow(/Unknown audit action/);
  });

  it('redacts secrets and truncates oversized values', () => {
    expect(serializeValue({ password: 'p', passwordHash: 'h', note: 'ok' })).toBe(
      '{"password":"[REDACTED]","passwordHash":"[REDACTED]","note":"ok"}',
    );
    const truncated = JSON.parse(serializeValue({ blob: 'x'.repeat(40 * 1024) }) ?? '{}') as {
      _truncated?: boolean;
    };
    expect(truncated._truncated).toBe(true);
  });

  it('rolls back the audit entry when the business write in the same batch fails', async () => {
    const db = createDatabase(harness.env.DB);
    const audit = new AuditLogService(db, request);
    const before = (await db.select().from(auditLog).all()).length;

    const duplicate = {
      id: 'dup-company',
      name: 'Dup',
      slug: 'dup-company',
      status: 'active' as const,
      defaultLanguage: 'en' as const,
      timeZone: 'Asia/Riyadh',
    };
    await db.insert(company).values(duplicate);

    await expect(
      new UnitOfWork(db)
        .add(
          audit.entry({ action: 'auth.logout', actorUserId: 'user-x' }),
          db.insert(company).values(duplicate),
        )
        .commit(),
    ).rejects.toThrow();

    expect((await db.select().from(auditLog).all()).length).toBe(before);
  });
});
