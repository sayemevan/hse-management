import {
  ACTION_STATUSES,
  actionDueState,
  actionReference,
  allowedTransitions,
  type ActionActorFacts,
  type ActionTransition,
  addIsoDays,
  parseActionNumber,
  zonedIsoDate,
} from '@hse/shared';
import { describe, expect, it } from 'vitest';

describe('T-59 action due state', () => {
  const today = '2026-11-26';
  it.each([
    [addIsoDays(today, -1), 'overdue'],
    [today, 'due_today'],
    [addIsoDays(today, 1), 'due_soon'],
    [addIsoDays(today, 3), 'due_soon'],
    [addIsoDays(today, 4), 'on_track'],
  ])('due %s is %s while open', (dueOn, state) => {
    expect(actionDueState(dueOn, 'open', today)).toBe(state);
    expect(actionDueState(dueOn, 'in_progress', today)).toBe(state);
  });

  it('is done once completed, verified or closed', () => {
    for (const status of ['completed', 'verified', 'closed'] as const) {
      expect(actionDueState(addIsoDays(today, -9), status, today)).toBe('done');
    }
  });

  it('uses the company calendar day, not UTC', () => {
    // 22:30 UTC on 25 Nov is already 26 Nov in Riyadh (UTC+3), still 25 Nov in São Paulo.
    const at = Date.UTC(2026, 10, 25, 22, 30);
    expect(actionDueState('2026-11-25', 'open', zonedIsoDate(at, 'Asia/Riyadh'))).toBe('overdue');
    expect(actionDueState('2026-11-25', 'open', zonedIsoDate(at, 'America/Sao_Paulo'))).toBe(
      'due_today',
    );
  });
});

describe('T-58 workflow table', () => {
  const actors: Record<string, ActionActorFacts> = {
    owner: { owner: true, participant: true, verify: false, close: false },
    ownerWithVerify: { owner: true, participant: true, verify: true, close: true },
    collaborator: { owner: false, participant: true, verify: false, close: false },
    collaboratorWithVerify: { owner: false, participant: true, verify: true, close: true },
    verifier: { owner: false, participant: false, verify: true, close: false },
    closer: { owner: false, participant: false, verify: false, close: true },
    verifierCloser: { owner: false, participant: false, verify: true, close: true },
    viewer: { owner: false, participant: false, verify: false, close: false },
  };
  const expected: Record<string, Record<string, ActionTransition[]>> = {
    open: { owner: ['start', 'complete'], ownerWithVerify: ['start', 'complete'] },
    in_progress: { owner: ['complete'], ownerWithVerify: ['complete'] },
    completed: {
      verifier: ['verify', 'send_back'],
      verifierCloser: ['verify', 'send_back', 'verify_and_close'],
    },
    verified: {
      ownerWithVerify: ['close'],
      collaboratorWithVerify: ['close'],
      closer: ['close'],
      verifierCloser: ['close'],
    },
    closed: {},
  };

  for (const status of ACTION_STATUSES) {
    for (const [name, facts] of Object.entries(actors)) {
      it(`${status} × ${name}`, () => {
        expect(allowedTransitions(status, facts)).toEqual(expected[status]?.[name] ?? []);
      });
    }
  }
});

describe('O-98 action numbers', () => {
  it('formats and parses references', () => {
    expect(actionReference('RMX-02', 7)).toBe('RMX-02-ACT-0007');
    expect(actionReference('RMX-02', 12345)).toBe('RMX-02-ACT-12345');
    for (const input of ['7', 'ACT-7', 'act-0007', 'RMX-02-ACT-0007', ' ACT7 ']) {
      expect(parseActionNumber(input)).toBe(7);
    }
    expect(parseActionNumber('guardrail')).toBeNull();
    expect(parseActionNumber('ACT-0')).toBeNull();
  });
});
