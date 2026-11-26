import { describe, expect, it } from 'vitest';

import { createApp } from '../src/app';
import { isAllowedInReadOnly } from '../src/modules/billing';
import {
  addMonths,
  calendarDaysUntil,
  DAY_MS,
  dueThreshold,
  effectiveState,
  isoDateIn,
  nextPeriodStart,
  periodEnd,
  stateAt,
} from '../src/modules/subscription';

const settings = { graceMs: 14 * DAY_MS, pendingProofHoldMs: 5 * DAY_MS };
const T0 = Date.UTC(2026, 10, 1, 9, 0); // 1 Nov 2026, 09:00 UTC

const trial = { trialEndsAt: T0, currentPeriodStart: null, currentPeriodEnd: null };
const paid = {
  trialEndsAt: T0 - 60 * DAY_MS,
  currentPeriodStart: T0 - 30 * DAY_MS,
  currentPeriodEnd: T0,
};

describe('PLT-10 lifecycle states', () => {
  it('a trial runs until its end, then goes straight to read-only (O-31)', () => {
    expect(stateAt(trial, T0 - 1, settings)).toBe('trial');
    expect(stateAt(trial, T0, settings)).toBe('read_only');
  });

  it('a paid period ends in 14 days of grace, then read-only (D-18)', () => {
    expect(stateAt(paid, T0 - 1, settings)).toBe('active');
    expect(stateAt(paid, T0, settings)).toBe('grace');
    expect(stateAt(paid, T0 + 14 * DAY_MS - 1, settings)).toBe('grace');
    expect(stateAt(paid, T0 + 14 * DAY_MS, settings)).toBe('read_only');
  });

  it('a period paid during the trial starts when the trial ends', () => {
    const start = nextPeriodStart('trial', trial, T0 - 3 * DAY_MS);
    expect(start).toBe(T0);
    const queued = {
      ...trial,
      currentPeriodStart: start,
      currentPeriodEnd: periodEnd(start, 'monthly'),
    };
    expect(stateAt(queued, T0 - 1, settings)).toBe('trial');
    expect(stateAt(queued, T0 + DAY_MS, settings)).toBe('active');
  });

  it('early renewal stacks on the current period; a late one starts now (O-33)', () => {
    expect(nextPeriodStart('active', paid, T0 - DAY_MS)).toBe(T0);
    expect(nextPeriodStart('grace', paid, T0 + 3 * DAY_MS)).toBe(T0 + 3 * DAY_MS);
    expect(nextPeriodStart('read_only', trial, T0 + 9 * DAY_MS)).toBe(T0 + 9 * DAY_MS);
  });

  it('a pending proof sent before the deadline holds the state for 5 days (O-32)', () => {
    const sent = T0 - DAY_MS;
    expect(effectiveState(trial, T0 + 4 * DAY_MS, settings, sent)).toBe('trial');
    expect(effectiveState(trial, T0 + 5 * DAY_MS, settings, sent)).toBe('read_only');
    expect(effectiveState(paid, T0 + 2 * DAY_MS, settings, sent)).toBe('active');
  });

  it('a proof sent after the deadline does not bring access back', () => {
    expect(effectiveState(trial, T0 + 2 * DAY_MS, settings, T0 + DAY_MS)).toBe('read_only');
    // In grace, a late proof keeps grace (no worse), but not active.
    expect(effectiveState(paid, T0 + 3 * DAY_MS, settings, T0 + DAY_MS)).toBe('grace');
  });
});

describe('PLT-10 calendar periods', () => {
  it('adds months and clamps the day at the month end', () => {
    expect(new Date(addMonths(Date.UTC(2026, 0, 31, 8), 1)).toISOString()).toBe(
      '2026-02-28T08:00:00.000Z',
    );
    expect(new Date(addMonths(Date.UTC(2028, 0, 31), 1)).toISOString()).toBe(
      '2028-02-29T00:00:00.000Z',
    );
    expect(new Date(addMonths(Date.UTC(2028, 1, 29), 12)).toISOString()).toBe(
      '2029-02-28T00:00:00.000Z',
    );
    expect(new Date(addMonths(Date.UTC(2026, 11, 15), 1)).toISOString()).toBe(
      '2027-01-15T00:00:00.000Z',
    );
  });

  it('monthly and annual periods', () => {
    expect(periodEnd(Date.UTC(2026, 4, 10), 'monthly')).toBe(Date.UTC(2026, 5, 10));
    expect(periodEnd(Date.UTC(2026, 4, 10), 'annual')).toBe(Date.UTC(2027, 4, 10));
  });
});

describe('PLT-15 reminder timing', () => {
  it('counts calendar days in the company time zone', () => {
    // 22:30 UTC on 9 Nov is already 10 Nov in Riyadh (UTC+3).
    const now = Date.UTC(2026, 10, 9, 22, 30);
    const deadline = Date.UTC(2026, 10, 11, 6, 0);
    expect(calendarDaysUntil(now, deadline, 'Asia/Riyadh')).toBe(1);
    expect(calendarDaysUntil(now, deadline, 'UTC')).toBe(2);
    expect(isoDateIn(now, 'Asia/Riyadh')).toBe('2026-11-10');
  });

  it('picks the most urgent reached threshold, so a missed one is replaced', () => {
    const thresholds = [7, 3, 1];
    expect(dueThreshold(8, thresholds)).toBeNull();
    expect(dueThreshold(7, thresholds)).toBe(7);
    expect(dueThreshold(5, thresholds)).toBe(7);
    expect(dueThreshold(3, thresholds)).toBe(3);
    expect(dueThreshold(1, thresholds)).toBe(1);
    expect(dueThreshold(0, thresholds)).toBe(1);
    expect(dueThreshold(-1, thresholds)).toBeNull();
  });
});

/** Company routes that may change data even in read-only mode, by design (PLT-11 FR-2). */
const REVIEWED_ALLOWED = [
  'POST /auth/login',
  'POST /auth/refresh',
  'POST /auth/logout',
  'POST /auth/change-password',
  'POST /auth/forgot-password',
  'POST /auth/reset-password',
  'PATCH /auth/me',
  'DELETE /auth/sessions/:sessionId',
  'POST /auth/sessions/revoke-others',
  'POST /invitations/accept',
  'POST /subscription/payments',
  'DELETE /subscription/payments/:id',
  // Sprint 6
  'POST /notifications/read-all',
  'POST /notifications/:id/read',
  'PUT /me/last-project',
];

/** Company write routes that read-only mode blocks (every other one). */
const REVIEWED_BLOCKED = [
  'POST /users/invitations',
  'POST /users/:id/invitation/resend',
  'DELETE /users/:id/invitation',
  'PATCH /company',
  'PUT /company/settings',
  'PUT /company/logo',
  'DELETE /company/logo',
  // Sprint 5
  'PUT /users/:id/company-role',
  'POST /users/:id/project-roles',
  'PATCH /users/:id/project-roles/:assignmentId',
  'DELETE /users/:id/project-roles/:assignmentId',
  'POST /projects',
  'PATCH /projects/:id',
  'POST /projects/:id/status',
  'POST /projects/:id/archive',
  'POST /projects/:id/restore',
  'PUT /roles/:roleCode/permissions',
  'POST /roles/:roleCode/permissions/reset',
  // Sprint 6
  'POST /projects/:id/places',
  'PATCH /projects/:id/places/:placeId',
  'POST /projects/:id/places/:placeId/move',
  'POST /projects/:id/places/:placeId/deactivate',
  'POST /projects/:id/places/:placeId/reactivate',
  'DELETE /projects/:id/places/:placeId',
  'POST /projects/:id/members',
  'PATCH /projects/:id/members/:assignmentId',
  'DELETE /projects/:id/members/:assignmentId',
  // Sprint 7 (T-24): every workforce write is blocked in read-only mode.
  'POST /projects/:id/workforce',
  'PATCH /projects/:id/workforce/:assignmentId',
  'POST /projects/:id/workforce/:assignmentId/end',
  'POST /projects/:id/workforce/:assignmentId/cancel',
  'POST /workforce/lists/:list',
  'PATCH /workforce/lists/:list/:itemId',
  'POST /workforce/lists/:list/:itemId/move',
  'POST /workforce/lists/:list/:itemId/deactivate',
  'POST /workforce/lists/:list/:itemId/reactivate',
  'DELETE /workforce/lists/:list/:itemId',
  'POST /workforce',
  'PATCH /workforce/:memberId',
  'POST /workforce/:memberId/status',
  'POST /workforce/:memberId/archive',
  'POST /workforce/:memberId/restore',
  'PUT /workforce/:memberId/photo',
  'DELETE /workforce/:memberId/photo',
  'PUT /workforce/:memberId/user-link',
  'DELETE /workforce/:memberId/user-link',
  'PUT /workforce/:memberId/emergency-contacts',
  'POST /workforce/:memberId/:kind',
  'PATCH /workforce/:memberId/:kind/:recordId',
  'POST /workforce/:memberId/:kind/:recordId/renew',
  'POST /workforce/:memberId/:kind/:recordId/void',
  // Sprint 8 (T-24): every action and comment write is blocked in read-only mode.
  'POST /projects/:id/actions',
  'PATCH /projects/:id/actions/:actionId',
  'POST /projects/:id/actions/:actionId/owner',
  'POST /projects/:id/actions/:actionId/collaborators',
  'DELETE /projects/:id/actions/:actionId/collaborators/:userId',
  'POST /projects/:id/actions/:actionId/updates',
  'POST /projects/:id/actions/:actionId/files',
  'POST /projects/:id/actions/:actionId/transitions',
  'POST /projects/:id/actions/:actionId/void',
  'POST /projects/:id/actions/:actionId/comments',
  'PATCH /projects/:id/actions/:actionId/comments/:commentId',
];

/** Base-domain only, never reached in a company context. */
const PLATFORM_ONLY = /^\/(registrations|platform)(\/|$)/;

describe('PLT-11 read-only allow-list', () => {
  it('every company write route is either blocked or reviewed as allowed', () => {
    const writes = createApp()
      .routes.filter((route) => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(route.method))
      .map((route) => ({ method: route.method, path: route.path.replace(/^\/api\/v1/, '') }))
      .filter((route) => !PLATFORM_ONLY.test(route.path));
    const seen = new Set(writes.map((route) => `${route.method} ${route.path}`));

    for (const route of writes) {
      const key = `${route.method} ${route.path}`;
      const allowed = isAllowedInReadOnly(route.path);
      if (allowed) expect(REVIEWED_ALLOWED, `${key} is allowed but not reviewed`).toContain(key);
      else expect(REVIEWED_BLOCKED, `${key} is blocked but not reviewed`).toContain(key);
    }
    for (const key of [...REVIEWED_ALLOWED, ...REVIEWED_BLOCKED]) {
      expect(seen, `${key} is listed but no longer exists`).toContain(key);
    }
  });
});
