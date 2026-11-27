'use client';

import {
  allItems,
  FINDING_SEVERITIES,
  INSPECTION_LIMITS,
  inspectionReadiness,
  type InspectionResult,
  type OfflinePackDto,
  scoreInspection,
  type TemplateItem,
} from '@hse/shared';
import { Camera, ChevronDown, ChevronUp } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useId, useState } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Select } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/modules/auth/auth-provider';
import { readReference } from '@/modules/offline/device-store';
import { compressPhoto } from '@/modules/offline/photo';
import { useSync } from '@/modules/offline/sync-provider';
import { FormDialog } from '@/modules/workforce/workforce-ui';

import {
  type InspectionCopy,
  type ItemCopy,
  keepFromServer,
  MY_INSPECTIONS_ROUTE,
  queueItem,
  queuePhoto,
  queueStartPlanned,
  queueSubmit,
  readCopy,
} from './inspection-offline';
import { InspectionStatusChip, NotSyncedChip, ResultButtons, ScoreBadge, useLocalized, useTemplateName } from './inspection-ui';
import { inspectionsService } from './inspections.service';

/** US-034 – US-036: capture section by section, online or offline (one page for every inspection). */
export function CaptureScreen() {
  const t = useTranslations('inspections.capture');
  const tc = useTranslations('common');
  const params = useSearchParams();
  const router = useRouter();
  const projectId = params.get('project') ?? '';
  const id = params.get('id') ?? '';
  const { user } = useAuth();
  const { online, refresh, items: outbox } = useSync();
  const name = useTemplateName();
  const pick = useLocalized();
  const [copy, setCopy] = useState<InspectionCopy | null | undefined>(undefined);
  const [members, setMembers] = useState<{ id: string; fullName: string }[]>([]);
  const [section, setSection] = useState(0);
  const [reviewing, setReviewing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user || !id) return;
    let current = await readCopy(user.id, id);
    if (online) {
      const dto = await inspectionsService.get(projectId, id).catch(() => null);
      if (dto) current = await keepFromServer(user.id, dto);
    }
    setCopy(current ?? null);
    const pack = await readReference<OfflinePackDto>(user.id, 'project-pack', projectId);
    setMembers(pack?.data.members ?? []);
  }, [user, id, projectId, online]);

  useEffect(() => {
    void load();
  }, [load]);

  // A sync updates the device copy (number, versions): show it without leaving the page.
  const syncedCount = outbox.filter((item) => item.entityId === id && item.state === 'synced').length;
  useEffect(() => {
    if (!user || !id || syncedCount === 0) return;
    void readCopy(user.id, id).then((latest) => {
      if (latest) setCopy(latest);
    });
  }, [user, id, syncedCount]);

  if (!user || copy === undefined) {
    return (
      <div className="flex items-center gap-3" role="status">
        <Spinner />
        {tc('loading')}
      </div>
    );
  }
  if (copy === null) {
    return (
      <div className="flex flex-col gap-3">
        <Alert tone="warning">{online ? t('notFound') : t('notOnDevice')}</Alert>
        <Link href={MY_INSPECTIONS_ROUTE} className="text-primary underline-offset-4 hover:underline">
          {t('backToMine')}
        </Link>
      </div>
    );
  }

  const content = copy.content;
  const items = allItems(content);
  const captureList = items.map((item) => ({
    itemKey: item.key,
    result: copy.items[item.key]?.result ?? null,
    comment: copy.items[item.key]?.comment ?? null,
    photoCount: copy.photos[item.key] ?? 0,
  }));
  const score = scoreInspection(content, captureList);
  const capturing = copy.status === 'in_progress' && !copy.submittedHere;
  const current = content.sections[section];

  const update = async (itemKey: string, changes: Partial<Omit<ItemCopy, 'version'>>) => {
    const next = await queueItem(user.id, copy, itemKey, changes);
    setCopy(next);
    void refresh();
  };

  const addPhoto = async (itemKey: string | null, file: File) => {
    try {
      const photo = await compressPhoto(file, file.name || 'photo.jpg');
      const next = await queuePhoto(user.id, copy, itemKey, photo);
      setCopy(next);
      void refresh();
    } catch {
      setMessage(t('photoFailed'));
    }
  };

  return (
    <div className="flex flex-col gap-4 pb-24">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {copy.reference ? <bdi dir="ltr" className="font-semibold">{copy.reference}</bdi> : <NotSyncedChip />}
          <InspectionStatusChip status={copy.submittedHere ? 'submitted' : copy.status} />
          <ScoreBadge percent={score.percent} outcome={score.outcome} />
        </div>
        <h1 className="text-xl font-semibold">{name(copy)}</h1>
        <p className="text-sm text-muted-foreground">
          <bdi dir="ltr">{copy.projectCode}</bdi>
          {copy.placeName ? ` · ${copy.placeName}` : ''}
        </p>
        <div aria-live="polite" className="flex flex-col gap-1">
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
            <div className="h-full bg-primary" style={{ width: `${String(items.length ? (score.answered / items.length) * 100 : 0)}%` }} />
          </div>
          <span className="text-sm">{t('progress', { answered: score.answered, total: items.length })}</span>
        </div>
      </div>
      {message ? <Alert tone="warning">{message}</Alert> : null}

      {copy.status === 'draft' ? (
        <div className="flex flex-col gap-3">
          <Alert tone="info">{t('planned')}</Alert>
          <Button
            onClick={() => {
              void queueStartPlanned(user.id, copy).then((next) => {
                setCopy(next);
                void refresh();
              });
            }}
          >
            {t('startNow')}
          </Button>
        </div>
      ) : null}
      {!capturing && copy.status !== 'draft' ? (
        <Alert tone="info">
          {copy.submittedHere ? t('submittedHere') : t('notCapturing')}{' '}
          {online ? (
            <Link href={`/projects/${copy.projectId}/inspections/${copy.id}`} className="underline">
              {t('openInspection')}
            </Link>
          ) : null}
        </Alert>
      ) : null}

      <nav aria-label={t('sections')} className="-mx-4 overflow-x-auto px-4">
        <ol className="flex min-w-max gap-2">
          {content.sections.map((s, index) => {
            const keys = s.items.map((i) => i.key);
            const done = keys.filter((k) => (copy.items[k]?.result ?? null) !== null).length;
            const fails = keys.filter((k) => copy.items[k]?.result === 'fail').length;
            return (
              <li key={s.key}>
                <button
                  type="button"
                  aria-current={index === section ? 'step' : undefined}
                  onClick={() => { setSection(index); }}
                  className={`min-h-10 rounded-full border px-3 text-sm ${index === section ? 'border-primary bg-primary text-white' : 'border-border'}`}
                >
                  {pick(s.title)} <span className="tabular-nums">{done}/{keys.length}</span>
                  {fails > 0 ? <span className="ms-1">{t('fails', { count: fails })}</span> : null}
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      {current ? (
        <section className="flex flex-col gap-3" aria-labelledby="section-title">
          <h2 id="section-title" className="text-lg font-semibold">{pick(current.title)}</h2>
          <ol className="flex flex-col gap-3">
            {current.items.map((item) => (
              <ItemCard
                key={item.key}
                item={item}
                allowed={content.results}
                value={copy.items[item.key] ?? null}
                photos={copy.photos[item.key] ?? 0}
                members={members}
                disabled={!capturing}
                onChange={(changes) => void update(item.key, changes)}
                onPhoto={(file) => void addPhoto(item.key, file)}
              />
            ))}
          </ol>
        </section>
      ) : (
        <p className="text-muted-foreground">{t('empty')}</p>
      )}

      <div className="fixed inset-x-0 bottom-0 z-10 flex gap-2 border-t border-border bg-background p-3">
        <Button variant="secondary" disabled={section === 0} onClick={() => { setSection((s) => s - 1); }}>
          <ChevronUp aria-hidden className="size-5" />
          <span className="sr-only sm:not-sr-only">{t('previous')}</span>
        </Button>
        {section < content.sections.length - 1 ? (
          <Button className="flex-1" onClick={() => { setSection((s) => s + 1); window.scrollTo({ top: 0 }); }}>
            {t('next')}
            <ChevronDown aria-hidden className="size-5" />
          </Button>
        ) : capturing ? (
          <Button className="flex-1" onClick={() => { setReviewing(true); }}>
            {t('review')}
          </Button>
        ) : (
          <span className="flex-1" />
        )}
      </div>

      {reviewing ? (
        <SubmitSheet
          copy={copy}
          onJump={(itemKey) => {
            const index = content.sections.findIndex((s) => s.items.some((i) => i.key === itemKey));
            if (index >= 0) setSection(index);
            setReviewing(false);
          }}
          onClose={() => { setReviewing(false); }}
          onSubmit={async (choices) => {
            const next = await queueSubmit(user.id, copy, choices);
            setCopy(next);
            setReviewing(false);
            await refresh();
            router.push(online ? `/projects/${copy.projectId}/inspections/${copy.id}` : MY_INSPECTIONS_ROUTE);
          }}
        />
      ) : null}
    </div>
  );
}

function ItemCard({
  item,
  allowed,
  value,
  photos,
  members,
  disabled,
  onChange,
  onPhoto,
}: {
  item: TemplateItem;
  allowed: readonly InspectionResult[];
  value: ItemCopy | null;
  photos: number;
  members: { id: string; fullName: string }[];
  disabled: boolean;
  onChange: (changes: Partial<Omit<ItemCopy, 'version'>>) => void;
  onPhoto: (file: File) => void;
}) {
  const t = useTranslations('inspections.capture');
  const tp = useTranslations('actions.priority');
  const pick = useLocalized();
  const questionId = useId();
  const commentId = useId();
  const priorityId = useId();
  const assignedId = useId();
  const photoId = useId();
  const [comment, setComment] = useState(value?.comment ?? '');
  const result = value?.result ?? null;
  const needsComment = (result === 'fail' || result === 'not_inspected') && !comment.trim();
  const needsPhoto = photos === 0 && (item.photoAlways || (result === 'fail' && item.photoOnFail));
  const expected = pick(item.expected);
  const guidance = pick(item.guidance);
  return (
    <li className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <p id={questionId} className="font-medium">
        {pick(item.question)}
        {item.critical ? <span className="ms-2 text-xs text-danger">{t('critical')}</span> : null}
      </p>
      {expected || guidance ? (
        <details className="text-sm text-muted-foreground">
          <summary className="cursor-pointer">{t('guidance')}</summary>
          {expected ? <p className="mt-1">{t('expected')}: {expected}</p> : null}
          {guidance ? <p className="mt-1">{guidance}</p> : null}
        </details>
      ) : null}
      <ResultButtons
        allowed={allowed}
        value={result}
        disabled={disabled}
        labelledBy={questionId}
        onChange={(next) => {
          onChange({ result: next, ...(next === 'fail' || next === 'observation' ? { priority: value?.priority ?? item.defaultPriority } : {}) });
        }}
      />
      {result !== null || comment ? (
        <div className="flex flex-col gap-1">
          <label htmlFor={commentId} className="text-sm font-medium">
            {t('comment')}
            {result === 'fail' || result === 'not_inspected' ? <span className="ms-1 text-danger" aria-hidden>*</span> : null}
          </label>
          <Textarea
            id={commentId}
            value={comment}
            disabled={disabled}
            maxLength={INSPECTION_LIMITS.commentMax}
            aria-invalid={needsComment}
            onChange={(e) => { setComment(e.target.value); }}
            onBlur={() => {
              if ((value?.comment ?? '') !== comment.trim()) onChange({ comment: comment.trim() || null });
            }}
          />
          {needsComment ? <p className="text-sm text-danger">{t('commentRequired')}</p> : null}
        </div>
      ) : null}
      {result === 'fail' || result === 'observation' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label htmlFor={priorityId} className="text-sm font-medium">{t('priority')}</label>
            <Select
              id={priorityId}
              value={value?.priority ?? item.defaultPriority}
              disabled={disabled}
              onChange={(e) => { onChange({ priority: e.target.value as ItemCopy['priority'] }); }}
            >
              {FINDING_SEVERITIES.map((p) => <option key={p} value={p}>{tp(p)}</option>)}
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={assignedId} className="text-sm font-medium">{t('assigned')}</label>
            <Select
              id={assignedId}
              value={value?.assignedTo ?? ''}
              disabled={disabled}
              onChange={(e) => {
                const member = members.find((m) => m.id === e.target.value);
                onChange({ assignedTo: member?.id ?? null, assignedName: member?.fullName ?? null });
              }}
            >
              <option value="">{t('nobody')}</option>
              {value?.assignedTo && !members.some((m) => m.id === value.assignedTo) ? (
                <option value={value.assignedTo}>{value.assignedName ?? ''}</option>
              ) : null}
              {members.map((m) => <option key={m.id} value={m.id}>{m.fullName}</option>)}
            </Select>
          </div>
          {result === 'observation' ? (
            <Checkbox
              id={`${item.key}-raise`}
              label={t('raiseFinding')}
              checked={value?.raiseFinding ?? false}
              disabled={disabled}
              onChange={(e) => { onChange({ raiseFinding: e.target.checked }); }}
            />
          ) : null}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <label
          htmlFor={photoId}
          className={`inline-flex min-h-12 cursor-pointer items-center gap-2 rounded-lg border border-border px-4 font-medium hover:bg-muted ${disabled || photos >= INSPECTION_LIMITS.photosPerItem ? 'pointer-events-none opacity-50' : ''}`}
        >
          <Camera aria-hidden className="size-5" />
          {t('addPhoto')}
        </label>
        <input
          id={photoId}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          disabled={disabled || photos >= INSPECTION_LIMITS.photosPerItem}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onPhoto(file);
            e.target.value = '';
          }}
        />
        <span className="text-sm text-muted-foreground">{t('photos', { count: photos, max: INSPECTION_LIMITS.photosPerItem })}</span>
        {needsPhoto ? <span className="text-sm text-danger">{t('photoRequired')}</span> : null}
      </div>
    </li>
  );
}

/** US-036: what still blocks submission, and the findings that will be created. */
function SubmitSheet({
  copy,
  onJump,
  onClose,
  onSubmit,
}: {
  copy: InspectionCopy;
  onJump: (itemKey: string) => void;
  onClose: () => void;
  onSubmit: (choices: { itemKey: string; decision: 'raise_action' | 'no_action'; reason?: string | null }[]) => Promise<void>;
}) {
  const t = useTranslations('inspections.submit');
  const tr = useTranslations('inspections.result');
  const tc = useTranslations('common');
  const pick = useLocalized();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [choices, setChoices] = useState<Record<string, { decision: 'raise_action' | 'no_action'; reason: string }>>({});
  const content = copy.content;
  const capture = allItems(content).map((item) => ({
    itemKey: item.key,
    result: copy.items[item.key]?.result ?? null,
    comment: copy.items[item.key]?.comment ?? null,
    photoCount: copy.photos[item.key] ?? 0,
  }));
  const issues = inspectionReadiness(content, capture, Boolean(copy.place.areaId));
  const score = scoreInspection(content, capture);
  const findings = allItems(content).filter((item) => {
    const entry = copy.items[item.key];
    return entry?.result === 'fail' || (entry?.result === 'observation' && entry.raiseFinding);
  });
  const counts = capture.reduce<Record<string, number>>((acc, c) => {
    if (c.result) acc[c.result] = (acc[c.result] ?? 0) + 1;
    return acc;
  }, {});
  const questionOf = (key: string | null) => pick(allItems(content).find((i) => i.key === key)?.question);
  return (
    <FormDialog
      open
      title={t('title')}
      error={error}
      saving={saving}
      submitLabel={t('submit')}
      cancelLabel={tc('cancel')}
      onClose={onClose}
      onSubmit={() => {
        if (issues.length > 0) {
          setError(t('blocked', { count: issues.length }));
          return;
        }
        if (!content.needsApproval) {
          const missing = findings.some((f) => choices[f.key]?.decision === 'no_action' && (choices[f.key]?.reason.trim().length ?? 0) < 5);
          if (missing) {
            setError(t('reasonRequired'));
            return;
          }
        }
        setSaving(true);
        void onSubmit(
          content.needsApproval
            ? []
            : findings.map((f) => ({
                itemKey: f.key,
                decision: choices[f.key]?.decision ?? 'raise_action',
                reason: choices[f.key]?.reason.trim() || null,
              })),
        ).catch((failure: unknown) => {
          setError(failure instanceof Error ? failure.message : String(failure));
          setSaving(false);
        });
      }}
    >
      {issues.length > 0 ? (
        <div className="flex flex-col gap-2">
          <p className="font-medium">{t('needsAttention', { count: issues.length })}</p>
          <ul className="flex flex-col gap-1">
            {issues.map((issue, index) => (
              <li key={`${issue.itemKey ?? 'place'}-${String(index)}`}>
                {issue.itemKey ? (
                  <button type="button" className="text-start text-primary underline-offset-4 hover:underline" onClick={() => { onJump(issue.itemKey ?? ''); }}>
                    {questionOf(issue.itemKey)} — {t(`reason.${issue.reason}`)}
                  </button>
                ) : (
                  <span>{t(`reason.${issue.reason}`)}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <p>
            {Object.entries(counts)
              .map(([result, n]) => `${String(n)} ${tr(result as 'pass')}`)
              .join(' · ')}
          </p>
          <ScoreBadge percent={score.percent} outcome={score.outcome} />
          <p>{t('findings', { count: findings.length })}</p>
          {!content.needsApproval && findings.length > 0 ? (
            <ul className="flex flex-col gap-3">
              {findings.map((f) => (
                <li key={f.key} className="flex flex-col gap-2 rounded-lg border border-border p-2">
                  <span className="text-sm font-medium">{pick(f.question)}</span>
                  <Select
                    value={choices[f.key]?.decision ?? 'raise_action'}
                    aria-label={t('decision')}
                    onChange={(e) => {
                      setChoices((c) => ({ ...c, [f.key]: { decision: e.target.value as 'raise_action' | 'no_action', reason: c[f.key]?.reason ?? '' } }));
                    }}
                  >
                    <option value="raise_action">{t('raiseAction')}</option>
                    <option value="no_action">{t('noAction')}</option>
                  </Select>
                  {choices[f.key]?.decision === 'no_action' ? (
                    <Textarea
                      aria-label={t('noActionReason')}
                      value={choices[f.key]?.reason ?? ''}
                      onChange={(e) => {
                        setChoices((c) => ({ ...c, [f.key]: { decision: 'no_action', reason: e.target.value } }));
                      }}
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </FormDialog>
  );
}
