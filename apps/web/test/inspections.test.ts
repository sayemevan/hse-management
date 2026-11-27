import {
  inspectionReadiness,
  scoreInspection,
  type TemplateContent,
  templateChanges,
  templateContentSchema,
  validateTemplateForPublish,
} from '@hse/shared';
import { describe, expect, it } from 'vitest';

import { displayLabel } from '../src/modules/offline/registry';
import { outboxLabel } from '../src/modules/inspections/inspection-offline';

const key = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function template(overrides: Partial<TemplateContent> = {}): TemplateContent {
  return templateContentSchema.parse({
    results: ['pass', 'fail', 'observation', 'not_applicable', 'not_inspected'],
    scoring: { method: 'percentage', passMark: 80 },
    sections: [
      {
        key: key(100),
        title: { en: 'Scaffold' },
        items: [
          { key: key(1), question: { en: 'Base plates' }, weight: 2 },
          { key: key(2), question: { en: 'Guardrails' }, critical: true },
          { key: key(3), question: { en: 'Tag' }, photoOnFail: false },
        ],
      },
    ],
    ...overrides,
  });
}

describe('T-81 scoreInspection', () => {
  it('weights passes and fails and leaves N/A, Not inspected and unanswered out', () => {
    const content = template();
    const score = scoreInspection(content, [
      { itemKey: key(1), result: 'pass' },
      { itemKey: key(2), result: 'fail' },
      { itemKey: key(3), result: 'not_applicable' },
    ]);
    expect(score.percent).toBe(66.7);
    expect(score.outcome).toBe('fail');
    expect(score.answered).toBe(3);
    expect(score.failed).toBe(1);
  });

  it('counts an observation as a pass', () => {
    const score = scoreInspection(template(), [
      { itemKey: key(1), result: 'observation' },
      { itemKey: key(2), result: 'pass' },
    ]);
    expect(score.percent).toBe(100);
    expect(score.outcome).toBe('pass');
  });

  it('Pass / Fail fails on a critical item even above the pass mark', () => {
    const content = template({ scoring: { method: 'pass_fail', passMark: 10 } });
    const score = scoreInspection(content, [
      { itemKey: key(1), result: 'pass' },
      { itemKey: key(2), result: 'fail' },
      { itemKey: key(3), result: 'pass' },
    ]);
    expect(score.outcome).toBe('fail');
  });

  it('scores nothing without a method', () => {
    const score = scoreInspection(template({ scoring: { method: 'none', passMark: null } }), [
      { itemKey: key(1), result: 'fail' },
    ]);
    expect(score.percent).toBeNull();
    expect(score.outcome).toBeNull();
  });
});

describe('US-031 template rules', () => {
  it('always allows Pass and Fail and refuses empty sections on publish', () => {
    const parsed = templateContentSchema.parse({
      results: ['not_applicable'],
      sections: [{ key: key(100), title: { en: 'Empty' }, items: [] }],
    });
    expect(parsed.results).toEqual(['pass', 'fail', 'not_applicable']);
    expect(validateTemplateForPublish(parsed).map((i) => i.message)).toContain('emptySection');
    expect(validateTemplateForPublish(template())).toEqual([]);
  });

  it('needs a pass mark or a critical item for Pass / Fail', () => {
    const content = template({ scoring: { method: 'pass_fail', passMark: null } });
    const noCritical = {
      ...content,
      sections: content.sections.map((s) => ({ ...s, items: s.items.map((i) => ({ ...i, critical: false })) })),
    };
    expect(validateTemplateForPublish(noCritical).map((i) => i.message)).toContain('passFailNeedsRule');
  });

  it('reports changes by item key', () => {
    const before = template();
    const after = {
      ...before,
      sections: [
        {
          ...before.sections[0]!,
          items: [
            { ...before.sections[0]!.items[0]!, weight: 3 },
            before.sections[0]!.items[1]!,
            { ...before.sections[0]!.items[2]!, key: key(9) },
          ],
        },
      ],
    };
    expect(templateChanges(before, after)).toEqual({ added: [key(9)], removed: [key(3)], changed: [key(1)] });
  });
});

describe('US-036 readiness', () => {
  it('names unanswered items, missing comments and missing photos', () => {
    const issues = inspectionReadiness(
      template(),
      [
        { itemKey: key(1), result: 'fail', comment: null, photoCount: 0 },
        { itemKey: key(3), result: 'fail', comment: 'Tag missing', photoCount: 0 },
      ],
      false,
    );
    expect(issues).toEqual([
      { itemKey: key(1), reason: 'commentRequired' },
      { itemKey: key(1), reason: 'photoRequired' },
      { itemKey: key(2), reason: 'unanswered' },
    ]);
  });
});

describe('T-80 language-neutral outbox labels', () => {
  it('renders the template name in the reader language with the reference', () => {
    const label = outboxLabel({ templateNameEn: 'Daily check', templateNameAr: 'فحص يومي', reference: null });
    expect(displayLabel(label, 'en')).toBe('Daily check');
    expect(displayLabel(label, 'ar')).toBe('فحص يومي');
    // The app's locale is a formatting locale such as ar-SA.
    expect(displayLabel(label, 'ar-SA')).toBe('فحص يومي');
    const numbered = outboxLabel({ templateNameEn: 'Daily check', templateNameAr: null, reference: 'RMX-02-INS-0001' });
    expect(displayLabel(numbered, 'ar')).toBe('RMX-02-INS-0001 · Daily check');
    expect(displayLabel('Sync probe Pump', 'ar')).toBe('Sync probe Pump');
  });
});
