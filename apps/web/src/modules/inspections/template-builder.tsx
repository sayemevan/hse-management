'use client';

import {
  FINDING_SEVERITIES,
  INSPECTION_LIMITS,
  INSPECTION_RESULTS,
  REQUIRED_RESULTS,
  SCORING_METHODS,
  scoreInspection,
  type TemplateContent,
  type TemplateDetailDto,
  type TemplateItem,
  type TemplateSection,
  type TemplateVersionListItemDto,
  validateTemplateForPublish,
} from '@hse/shared';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { FormField } from '@/components/form/form-field';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { useReadOnly } from '@/modules/billing/use-subscription-state';
import { useDateFormat } from '@/modules/i18n/use-date-format';
import { useErrorMessage } from '@/modules/i18n/use-error-message';

import { ResultButtons, ScoreBadge, useLocalized } from './inspection-ui';
import { templatesService } from './inspections.service';

type Local = { en?: string | null; ar?: string | null };

function newItem(): TemplateItem {
  return {
    key: crypto.randomUUID(),
    question: { en: '', ar: null },
    expected: null,
    guidance: null,
    weight: 1,
    critical: false,
    defaultPriority: 'medium',
    photoOnFail: true,
    photoAlways: false,
  };
}

function move<T>(list: readonly T[], index: number, direction: -1 | 1): T[] {
  const next = [...list];
  const target = index + direction;
  if (target < 0 || target >= next.length) return next;
  const [entry] = next.splice(index, 1);
  if (entry !== undefined) next.splice(target, 0, entry);
  return next;
}

/** US-031, US-032: the template builder — details, results, scoring, sections, preview, publish. */
export function TemplateBuilder({ id }: { id: string }) {
  const t = useTranslations('inspections.builder');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const readOnly = useReadOnly();
  const router = useRouter();
  const pick = useLocalized();
  const [detail, setDetail] = useState<TemplateDetailDto | null>(null);
  const [content, setContent] = useState<TemplateContent | null>(null);
  const [names, setNames] = useState<{ en: string; ar: string }>({ en: '', ar: '' });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [confirm, setConfirm] = useState<'publish' | 'discard' | 'retire' | null>(null);
  const [preview, setPreview] = useState(false);
  const [versions, setVersions] = useState<TemplateVersionListItemDto[] | null>(null);
  const updatedAt = useRef<number | null>(null);

  const apply = useCallback((next: TemplateDetailDto) => {
    setDetail(next);
    setNames({ en: next.nameEn ?? '', ar: next.nameAr ?? '' });
    const source = next.draft ?? next.current;
    setContent(source?.content ?? null);
    updatedAt.current = next.draft?.updatedAt ?? null;
    setDirty(false);
  }, []);

  useEffect(() => {
    templatesService.get(id).then(apply, (failure: unknown) => {
      setError(errorMessage(failure));
    });
  }, [id, apply, errorMessage]);

  const editable = Boolean(detail?.canManage && detail.draft && !readOnly);

  const save = useCallback(async (): Promise<TemplateDetailDto | null> => {
    if (!detail?.draft || !content || updatedAt.current === null) return detail;
    setSaving(true);
    try {
      const saved = await templatesService.saveDraft(detail.id, {
        nameEn: names.en.trim() || null,
        nameAr: names.ar.trim() || null,
        content,
        expectedUpdatedAt: updatedAt.current,
      });
      updatedAt.current = saved.draft?.updatedAt ?? null;
      setDetail(saved);
      setDirty(false);
      return saved;
    } catch (failure) {
      setError(errorMessage(failure));
      return null;
    } finally {
      setSaving(false);
    }
  }, [detail, content, names, errorMessage]);

  // Autosave a few seconds after the last change (US-031).
  useEffect(() => {
    if (!dirty || !editable) return;
    const timer = window.setTimeout(() => {
      void save();
    }, 2500);
    return () => {
      window.clearTimeout(timer);
    };
  }, [dirty, editable, save]);

  if (error && !detail) return <Alert tone="danger">{error}</Alert>;
  if (!detail || !content) {
    return (
      <div className="flex items-center gap-3" role="status">
        <Spinner />
        {tc('loading')}
      </div>
    );
  }

  const change = (next: TemplateContent) => {
    setContent(next);
    setDirty(true);
    setNotice(null);
  };
  const setSection = (index: number, section: TemplateSection) => {
    change({ ...content, sections: content.sections.map((s, i) => (i === index ? section : s)) });
  };
  const issues = validateTemplateForPublish(content);
  const itemTotal = content.sections.reduce((n, s) => n + s.items.length, 0);

  const run = (task: () => Promise<TemplateDetailDto | void>, message?: string) => {
    setError(null);
    task().then(
      (result) => {
        if (result) apply(result);
        if (message) setNotice(message);
      },
      (failure: unknown) => {
        setError(errorMessage(failure));
      },
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link href="/settings/inspection-templates" className="text-sm text-primary underline-offset-4 hover:underline">
          {t('back')}
        </Link>
        <h1 className="text-2xl font-semibold">{pick({ en: detail.nameEn, ar: detail.nameAr })}</h1>
        <p className="text-sm text-muted-foreground">
          {detail.current ? t('currentVersion', { version: detail.current.versionNo }) : t('neverPublished')}
          {detail.draft ? ` · ${t('editingDraft', { version: detail.draft.versionNo })}` : ''}
          {saving ? ` · ${t('saving')}` : dirty ? ` · ${t('unsaved')}` : ''}
        </p>
      </div>

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      {detail.draft && detail.current ? (
        <Alert tone="info">{t('draftBanner', { next: detail.draft.versionNo, current: detail.current.versionNo })}</Alert>
      ) : null}
      {detail.changes && (detail.changes.added.length + detail.changes.changed.length + detail.changes.removed.length > 0) ? (
        <p className="text-sm">
          {t('changes', {
            added: detail.changes.added.length,
            changed: detail.changes.changed.length,
            removed: detail.changes.removed.length,
          })}
        </p>
      ) : null}

      {detail.canManage && !readOnly ? (
        <div className="flex flex-wrap gap-2">
          {detail.draft ? (
            <>
              <Button
                onClick={() => {
                  setConfirm('publish');
                }}
              >
                {t('publish', { version: detail.draft.versionNo })}
              </Button>
              <Button variant="secondary" disabled={saving || !dirty} onClick={() => void save()}>
                {t('saveDraft')}
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setConfirm('discard');
                }}
              >
                {detail.current ? t('discardDraft') : t('deleteTemplate')}
              </Button>
            </>
          ) : detail.status === 'active' ? (
            <Button onClick={() => { run(() => templatesService.createDraft(detail.id)); }}>{t('edit')}</Button>
          ) : null}
          <Button variant="secondary" onClick={() => { setPreview((p) => !p); }}>
            {preview ? t('closePreview') : t('preview')}
          </Button>
          {detail.current ? (
            <>
              <Button
                variant="secondary"
                onClick={() => {
                  templatesService.duplicate(detail.id).then(
                    (copy) => {
                      router.push(`/settings/inspection-templates/${copy.id}`);
                    },
                    (failure: unknown) => {
                      setError(errorMessage(failure));
                    },
                  );
                }}
              >
                {t('duplicate')}
              </Button>
              {detail.status === 'active' ? (
                <Button variant="secondary" onClick={() => { setConfirm('retire'); }}>
                  {t('retire')}
                </Button>
              ) : (
                <Button variant="secondary" onClick={() => { run(() => templatesService.setRetired(detail.id, false), t('reactivated')); }}>
                  {t('reactivate')}
                </Button>
              )}
              <Button
                variant="ghost"
                onClick={() => {
                  templatesService.versions(detail.id).then(setVersions, (failure: unknown) => {
                    setError(errorMessage(failure));
                  });
                }}
              >
                {t('versions')}
              </Button>
            </>
          ) : null}
        </div>
      ) : null}

      {versions ? <VersionList templateId={detail.id} versions={versions} /> : null}

      {preview ? <Preview content={content} /> : null}

      <section className="flex flex-col gap-4 rounded-xl border border-border p-4" aria-labelledby="details-title">
        <h2 id="details-title" className="text-lg font-semibold">{t('details')}</h2>
        <LocalField
          label={t('name')}
          value={{ en: names.en, ar: names.ar }}
          disabled={!editable}
          max={INSPECTION_LIMITS.templateNameMax}
          onChange={(value) => {
            setNames({ en: value.en ?? '', ar: value.ar ?? '' });
            setDirty(true);
          }}
        />
        <LocalField
          label={t('description')}
          multiline
          value={content.description ?? {}}
          disabled={!editable}
          max={INSPECTION_LIMITS.descriptionMax}
          onChange={(value) => { change({ ...content, description: value }); }}
        />
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">{t('results')}</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {INSPECTION_RESULTS.map((result) => (
              <Checkbox
                key={result}
                id={`result-${result}`}
                label={t(`resultLabel.${result}`)}
                checked={content.results.includes(result)}
                disabled={!editable || REQUIRED_RESULTS.includes(result)}
                onChange={(event) => {
                  const set = new Set(content.results);
                  if (event.target.checked) set.add(result);
                  else set.delete(result);
                  change({ ...content, results: INSPECTION_RESULTS.filter((r) => set.has(r)) });
                }}
              />
            ))}
          </div>
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="scoring-method" label={t('scoring')}>
            <Select
              id="scoring-method"
              value={content.scoring.method}
              disabled={!editable}
              onChange={(event) => {
                const method = event.target.value as TemplateContent['scoring']['method'];
                change({ ...content, scoring: { method, passMark: method === 'none' ? null : content.scoring.passMark } });
              }}
            >
              {SCORING_METHODS.map((method) => (
                <option key={method} value={method}>
                  {t(`scoringMethod.${method}`)}
                </option>
              ))}
            </Select>
          </FormField>
          {content.scoring.method !== 'none' ? (
            <FormField id="pass-mark" label={t('passMark')} hint={<p className="text-sm text-muted-foreground">{t('passMarkHint')}</p>}>
              <Input
                id="pass-mark"
                type="number"
                inputMode="numeric"
                min={1}
                max={100}
                disabled={!editable}
                value={content.scoring.passMark ?? ''}
                onChange={(event) => {
                  const value = event.target.value === '' ? null : Math.min(100, Math.max(1, Number(event.target.value)));
                  change({ ...content, scoring: { ...content.scoring, passMark: value } });
                }}
              />
            </FormField>
          ) : null}
        </div>
        <Checkbox
          id="needs-approval"
          label={t('needsApproval')}
          checked={content.needsApproval}
          disabled={!editable}
          onChange={(event) => { change({ ...content, needsApproval: event.target.checked }); }}
        />
        <Checkbox
          id="area-required"
          label={t('areaRequired')}
          checked={content.areaRequired}
          disabled={!editable}
          onChange={(event) => { change({ ...content, areaRequired: event.target.checked }); }}
        />
      </section>

      <section className="flex flex-col gap-4" aria-labelledby="sections-title">
        <div className="flex items-center justify-between">
          <h2 id="sections-title" className="text-lg font-semibold">
            {t('sections', { sections: content.sections.length, items: itemTotal })}
          </h2>
        </div>
        {content.sections.length === 0 ? <p className="text-muted-foreground">{t('noSections')}</p> : null}
        {content.sections.map((section, index) => (
          <SectionEditor
            key={section.key}
            section={section}
            index={index}
            count={content.sections.length}
            editable={editable}
            invalid={issues.some((issue) => issue.path === `sections.${String(index)}.items`)}
            onChange={(next) => { setSection(index, next); }}
            onMove={(direction) => { change({ ...content, sections: move(content.sections, index, direction) }); }}
            onRemove={() => { change({ ...content, sections: content.sections.filter((_, i) => i !== index) }); }}
          />
        ))}
        {editable && content.sections.length < INSPECTION_LIMITS.sectionsMax ? (
          <div>
            <Button
              variant="secondary"
              onClick={() => {
                change({
                  ...content,
                  sections: [...content.sections, { key: crypto.randomUUID(), title: { en: '', ar: null }, items: [newItem()] }],
                });
              }}
            >
              <Plus aria-hidden className="size-5" />
              {t('addSection')}
            </Button>
          </div>
        ) : null}
      </section>

      <ConfirmDialog
        open={confirm === 'publish'}
        title={t('publishTitle', { version: detail.draft?.versionNo ?? 1 })}
        body={issues.length > 0 ? t('publishIssues', { count: issues.length }) : t('publishBody')}
        confirmLabel={t('publishConfirm')}
        cancelLabel={tc('cancel')}
        confirmDisabled={issues.length > 0}
        onCancel={() => { setConfirm(null); }}
        onConfirm={() => {
          setConfirm(null);
          run(async () => {
            if (dirty) {
              const saved = await save();
              if (!saved) return;
            }
            return templatesService.publish(detail.id);
          }, t('published'));
        }}
      >
        {issues.length > 0 ? (
          <ul className="list-disc ps-5 text-sm">
            {issues.map((issue, index) => (
              <li key={`${issue.path}-${String(index)}`}>{t(`issue.${issue.message}`, { path: issue.path })}</li>
            ))}
          </ul>
        ) : null}
      </ConfirmDialog>
      <ConfirmDialog
        open={confirm === 'discard'}
        title={detail.current ? t('discardTitle') : t('deleteTitle')}
        body={detail.current ? t('discardBody') : t('deleteBody')}
        confirmLabel={detail.current ? t('discardDraft') : t('deleteTemplate')}
        cancelLabel={tc('cancel')}
        tone="danger"
        onCancel={() => { setConfirm(null); }}
        onConfirm={() => {
          setConfirm(null);
          templatesService.discardDraft(detail.id).then(
            () => {
              if (detail.current) run(() => templatesService.get(detail.id));
              else router.push('/settings/inspection-templates');
            },
            (failure: unknown) => { setError(errorMessage(failure)); },
          );
        }}
      />
      <ConfirmDialog
        open={confirm === 'retire'}
        title={t('retireTitle')}
        body={t('retireBody')}
        confirmLabel={t('retire')}
        cancelLabel={tc('cancel')}
        tone="danger"
        onCancel={() => { setConfirm(null); }}
        onConfirm={() => {
          setConfirm(null);
          run(() => templatesService.setRetired(detail.id, true), t('retired'));
        }}
      />
    </div>
  );
}

function LocalField({
  label,
  value,
  onChange,
  disabled,
  max,
  multiline,
}: {
  label: string;
  value: Local;
  onChange: (value: Local) => void;
  disabled?: boolean;
  max: number;
  multiline?: boolean;
}) {
  const t = useTranslations('inspections.builder');
  const enId = useId();
  const arId = useId();
  const Field = multiline ? Textarea : Input;
  return (
    <fieldset className="grid gap-3 sm:grid-cols-2">
      <legend className="mb-2 text-sm font-medium">{label}</legend>
      <div className="flex flex-col gap-1">
        <label htmlFor={enId} className="text-xs text-muted-foreground">{t('english')}</label>
        <Field
          id={enId}
          value={value.en ?? ''}
          maxLength={max}
          disabled={disabled}
          onChange={(event: React.ChangeEvent<HTMLInputElement & HTMLTextAreaElement>) => {
            onChange({ ...value, en: event.target.value || null });
          }}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={arId} className="text-xs text-muted-foreground">{t('arabic')}</label>
        <Field
          id={arId}
          dir="rtl"
          value={value.ar ?? ''}
          maxLength={max}
          disabled={disabled}
          onChange={(event: React.ChangeEvent<HTMLInputElement & HTMLTextAreaElement>) => {
            onChange({ ...value, ar: event.target.value || null });
          }}
        />
      </div>
    </fieldset>
  );
}

function SectionEditor({
  section,
  index,
  count,
  editable,
  invalid,
  onChange,
  onMove,
  onRemove,
}: {
  section: TemplateSection;
  index: number;
  count: number;
  editable: boolean;
  invalid: boolean;
  onChange: (section: TemplateSection) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}) {
  const t = useTranslations('inspections.builder');
  const pick = useLocalized();
  const setItem = (i: number, item: TemplateItem) => {
    onChange({ ...section, items: section.items.map((it, n) => (n === i ? item : it)) });
  };
  return (
    <details open className="rounded-xl border border-border p-4">
      <summary className="cursor-pointer font-medium">
        {t('sectionNumber', { number: index + 1 })} · {pick(section.title) || t('untitled')} ({section.items.length})
      </summary>
      <div className="mt-4 flex flex-col gap-4">
        {invalid ? <Alert tone="warning">{t('issue.emptySection')}</Alert> : null}
        <LocalField
          label={t('sectionTitle')}
          value={section.title}
          disabled={!editable}
          max={INSPECTION_LIMITS.sectionTitleMax}
          onChange={(title) => { onChange({ ...section, title }); }}
        />
        {editable ? (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" disabled={index === 0} onClick={() => { onMove(-1); }}>
              <ArrowUp aria-hidden className="size-4" />
              {t('moveUp')}
            </Button>
            <Button size="sm" variant="secondary" disabled={index === count - 1} onClick={() => { onMove(1); }}>
              <ArrowDown aria-hidden className="size-4" />
              {t('moveDown')}
            </Button>
            <Button size="sm" variant="secondary" onClick={onRemove}>
              <Trash2 aria-hidden className="size-4" />
              {t('removeSection')}
            </Button>
          </div>
        ) : null}
        <ol className="flex flex-col gap-3">
          {section.items.map((item, i) => (
            <ItemEditor
              key={item.key}
              item={item}
              number={i + 1}
              editable={editable}
              first={i === 0}
              last={i === section.items.length - 1}
              onChange={(next) => { setItem(i, next); }}
              onMove={(direction) => { onChange({ ...section, items: move(section.items, i, direction) }); }}
              onRemove={() => { onChange({ ...section, items: section.items.filter((_, n) => n !== i) }); }}
            />
          ))}
        </ol>
        {editable ? (
          <div>
            <Button size="sm" variant="secondary" onClick={() => { onChange({ ...section, items: [...section.items, newItem()] }); }}>
              <Plus aria-hidden className="size-4" />
              {t('addItem')}
            </Button>
          </div>
        ) : null}
      </div>
    </details>
  );
}

function ItemEditor({
  item,
  number,
  editable,
  first,
  last,
  onChange,
  onMove,
  onRemove,
}: {
  item: TemplateItem;
  number: number;
  editable: boolean;
  first: boolean;
  last: boolean;
  onChange: (item: TemplateItem) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}) {
  const t = useTranslations('inspections.builder');
  const tp = useTranslations('actions.priority');
  const pick = useLocalized();
  const weightId = useId();
  const priorityId = useId();
  return (
    <li className="rounded-lg border border-border p-3">
      <details>
        <summary className="cursor-pointer">
          <span className="font-medium">{number}. {pick(item.question) || t('untitled')}</span>
          {item.critical ? <span className="ms-2 text-xs text-danger">{t('criticalChip')}</span> : null}
        </summary>
        <div className="mt-3 flex flex-col gap-3">
          <LocalField
            label={t('question')}
            value={item.question}
            disabled={!editable}
            max={INSPECTION_LIMITS.questionMax}
            onChange={(question) => { onChange({ ...item, question }); }}
          />
          <LocalField
            label={t('expected')}
            multiline
            value={item.expected ?? {}}
            disabled={!editable}
            max={INSPECTION_LIMITS.guidanceMax}
            onChange={(expected) => { onChange({ ...item, expected }); }}
          />
          <LocalField
            label={t('guidance')}
            multiline
            value={item.guidance ?? {}}
            disabled={!editable}
            max={INSPECTION_LIMITS.guidanceMax}
            onChange={(guidance) => { onChange({ ...item, guidance }); }}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField id={weightId} label={t('weight')}>
              <Input
                id={weightId}
                type="number"
                inputMode="numeric"
                min={1}
                max={10}
                disabled={!editable}
                value={item.weight}
                onChange={(event) => {
                  onChange({ ...item, weight: Math.min(10, Math.max(1, Number(event.target.value) || 1)) });
                }}
              />
            </FormField>
            <FormField id={priorityId} label={t('defaultPriority')}>
              <Select
                id={priorityId}
                value={item.defaultPriority}
                disabled={!editable}
                onChange={(event) => { onChange({ ...item, defaultPriority: event.target.value as TemplateItem['defaultPriority'] }); }}
              >
                {FINDING_SEVERITIES.map((value) => (
                  <option key={value} value={value}>{tp(value)}</option>
                ))}
              </Select>
            </FormField>
          </div>
          <Checkbox id={`${item.key}-critical`} label={t('critical')} checked={item.critical} disabled={!editable} onChange={(e) => { onChange({ ...item, critical: e.target.checked }); }} />
          <Checkbox id={`${item.key}-photo-fail`} label={t('photoOnFail')} checked={item.photoOnFail} disabled={!editable} onChange={(e) => { onChange({ ...item, photoOnFail: e.target.checked }); }} />
          <Checkbox id={`${item.key}-photo-always`} label={t('photoAlways')} checked={item.photoAlways} disabled={!editable} onChange={(e) => { onChange({ ...item, photoAlways: e.target.checked }); }} />
          {editable ? (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" disabled={first} onClick={() => { onMove(-1); }}>
                <ArrowUp aria-hidden className="size-4" />
                {t('moveUp')}
              </Button>
              <Button size="sm" variant="secondary" disabled={last} onClick={() => { onMove(1); }}>
                <ArrowDown aria-hidden className="size-4" />
                {t('moveDown')}
              </Button>
              <Button size="sm" variant="secondary" onClick={onRemove}>
                <Trash2 aria-hidden className="size-4" />
                {t('removeItem')}
              </Button>
            </div>
          ) : null}
        </div>
      </details>
    </li>
  );
}

/** US-031: the capture screen as an inspector will see it, with a live score. */
function Preview({ content }: { content: TemplateContent }) {
  const t = useTranslations('inspections.builder');
  const pick = useLocalized();
  const [results, setResults] = useState<Record<string, (typeof INSPECTION_RESULTS)[number] | null>>({});
  const score = scoreInspection(
    content,
    Object.entries(results).map(([itemKey, result]) => ({ itemKey, result })),
  );
  return (
    <section className="mx-auto flex w-full max-w-sm flex-col gap-3 rounded-2xl border-4 border-border p-3" aria-label={t('preview')}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{t('preview')}</span>
        <ScoreBadge percent={score.percent} outcome={score.outcome} />
      </div>
      {content.sections.map((section) => (
        <div key={section.key} className="flex flex-col gap-2">
          <h3 className="font-semibold">{pick(section.title)}</h3>
          {section.items.map((item) => (
            <div key={item.key} className="flex flex-col gap-2 rounded-lg border border-border p-2">
              <p id={`preview-${item.key}`} className="text-sm font-medium">{pick(item.question)}</p>
              <ResultButtons
                allowed={content.results}
                value={results[item.key] ?? null}
                labelledBy={`preview-${item.key}`}
                onChange={(value) => { setResults((r) => ({ ...r, [item.key]: value })); }}
              />
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}

function VersionList({ templateId, versions }: { templateId: string; versions: TemplateVersionListItemDto[] }) {
  const t = useTranslations('inspections.builder');
  const { dateTime } = useDateFormat();
  const pick = useLocalized();
  const [open, setOpen] = useState<{ versionNo: number; content: TemplateContent } | null>(null);
  return (
    <section className="flex flex-col gap-2 rounded-xl border border-border p-4">
      <h2 className="text-lg font-semibold">{t('versions')}</h2>
      <ul className="flex flex-col gap-2">
        {versions.map((v) => (
          <li key={v.id} className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{t('versionLabel', { version: v.versionNo })}</span>
            <span className="text-sm text-muted-foreground">
              {t(`state.${v.state}`)} · {dateTime(v.publishedAt)} · {v.publishedBy?.name ?? t('system')} ·{' '}
              {t('inspectionCount', { count: v.inspectionCount })}
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                templatesService.version(templateId, v.versionNo).then(
                  (dto) => { setOpen({ versionNo: dto.versionNo, content: dto.content }); },
                  () => undefined,
                );
              }}
            >
              {t('view')}
            </Button>
          </li>
        ))}
      </ul>
      {open ? (
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <h3 className="font-semibold">{t('versionLabel', { version: open.versionNo })}</h3>
          {open.content.sections.map((section) => (
            <div key={section.key}>
              <p className="font-medium">{pick(section.title)}</p>
              <ol className="list-decimal ps-5 text-sm">
                {section.items.map((item) => <li key={item.key}>{pick(item.question)}</li>)}
              </ol>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
