'use client';

import {
  allItems,
  FINDING_SEVERITIES,
  type FindingDto,
  type InspectionDto,
  type TimelinePageDto,
} from '@hse/shared';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useId, useMemo, useState } from 'react';

import { FormField } from '@/components/form/form-field';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { PriorityChip } from '@/modules/actions/action-ui';
import { type CommentApi, CommentThread } from '@/modules/actions/comment-thread';
import { PersonSelect } from '@/modules/actions/person-select';
import { useReadOnly } from '@/modules/billing/use-subscription-state';
import { useDateFormat } from '@/modules/i18n/use-date-format';
import { useErrorMessage } from '@/modules/i18n/use-error-message';
import { useCurrentProject } from '@/modules/projects/project-context';
import { useActivitySentence } from '@/modules/projects/timeline-screen';
import { FormDialog } from '@/modules/workforce/workforce-ui';

import { captureHref } from './inspection-offline';
import {
  InspectionStatusChip,
  RESULT_ICONS,
  ScoreBadge,
  SmallChip,
  useLocalized,
  useTemplateName,
} from './inspection-ui';
import { inspectionsService } from './inspections.service';

type Dialog = 'return' | 'approve' | 'cancel' | 'reassign' | null;

/** US-037 – US-039: the inspection page — results, evidence, findings, review bar, comments, history. */
export function InspectionScreen() {
  const t = useTranslations('inspections.page');
  const tc = useTranslations('common');
  const tr = useTranslations('inspections.result');
  const ts = useTranslations('inspections');
  const errorMessage = useErrorMessage();
  const readOnly = useReadOnly();
  const { project } = useCurrentProject();
  const params = useParams<{ inspectionId: string }>();
  const id = params.inspectionId;
  const name = useTemplateName();
  const pick = useLocalized();
  const { calendarDate, dateTime } = useDateFormat();
  const [dto, setDto] = useState<InspectionDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [showAll, setShowAll] = useState(false);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});

  const load = useCallback(() => {
    inspectionsService.get(project.id, id).then(
      (loaded) => {
        setDto(loaded);
        if (loaded.status === 'submitted' && loaded.canEditFindings && !loaded.underReview && !readOnly) {
          void inspectionsService.reviewStart(project.id, id).catch(() => undefined);
        }
      },
      (failure: unknown) => { setError(errorMessage(failure)); },
    );
  }, [project.id, id, errorMessage, readOnly]);
  useEffect(load, [load]);

  // Photo thumbnails through the API (files are never public, T-83).
  useEffect(() => {
    if (!dto) return;
    let cancelled = false;
    const urls: string[] = [];
    void (async () => {
      const next: Record<string, string> = {};
      for (const file of dto.files.filter((f) => f.contentType.startsWith('image/')).slice(0, 60)) {
        const blob = await inspectionsService.file(project.id, dto.id, file.id).catch(() => null);
        if (!blob || cancelled) continue;
        const url = URL.createObjectURL(blob);
        urls.push(url);
        next[file.id] = url;
      }
      if (!cancelled) setPhotoUrls(next);
    })();
    return () => {
      cancelled = true;
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [dto, project.id]);

  const comments: CommentApi = useMemo(
    () => ({
      comments: (before) => inspectionsService.comments(project.id, id, before),
      add: (body) => inspectionsService.addComment(project.id, id, body),
      edit: (commentId, body) => inspectionsService.editComment(project.id, id, commentId, body),
    }),
    [project.id, id],
  );

  if (error && !dto) return <Alert tone="danger">{error}</Alert>;
  if (!dto) {
    return (
      <div className="flex items-center gap-3" role="status">
        <Spinner />
        {tc('loading')}
      </div>
    );
  }

  const items = allItems(dto.content);
  const results = new Map(dto.items.map((i) => [i.itemKey, i]));
  const allowed = readOnly ? [] : dto.allowedTransitions;
  const move = (body: Parameters<typeof inspectionsService.transition>[2], message: string) => {
    setError(null);
    inspectionsService.transition(project.id, dto.id, body).then(
      (next) => {
        setDto(next);
        setNotice(message);
        setDialog(null);
      },
      (failure: unknown) => { setError(errorMessage(failure)); },
    );
  };

  return (
    <div className="flex flex-col gap-6 pb-24">
      <div className="flex flex-col gap-2">
        <Link href={`/projects/${project.id}/inspections`} className="text-sm text-primary underline-offset-4 hover:underline">
          {t('back')}
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          {dto.reference ? <bdi dir="ltr" className="text-lg font-semibold">{dto.reference}</bdi> : null}
          <InspectionStatusChip status={dto.status} cancelled={dto.cancelled} />
          {dto.underReview ? <SmallChip icon={RESULT_ICONS.observation}>{ts('underReview')}</SmallChip> : null}
          {dto.overdueDays > 0 ? <SmallChip icon={RESULT_ICONS.not_inspected} tone="danger">{ts('overdue', { days: dto.overdueDays })}</SmallChip> : null}
          <ScoreBadge percent={dto.scorePercent} outcome={dto.scoreOutcome} />
        </div>
        <h1 className="text-2xl font-semibold">{name(dto)}</h1>
        <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          <div><dt className="inline text-muted-foreground">{t('inspector')}: </dt><dd className="inline">{dto.inspector.name}</dd></div>
          {dto.planner ? <div><dt className="inline text-muted-foreground">{t('planner')}: </dt><dd className="inline">{dto.planner.name}</dd></div> : null}
          {dto.plannedOn ? <div><dt className="inline text-muted-foreground">{t('plannedOn')}: </dt><dd className="inline">{calendarDate(dto.plannedOn)}</dd></div> : null}
          {dto.inspectedOn ? <div><dt className="inline text-muted-foreground">{t('inspectedOn')}: </dt><dd className="inline">{calendarDate(dto.inspectedOn)}</dd></div> : null}
          {dto.placeName ? <div><dt className="inline text-muted-foreground">{t('place')}: </dt><dd className="inline">{dto.placeName}</dd></div> : null}
          {dto.weather ? <div><dt className="inline text-muted-foreground">{t('weather')}: </dt><dd className="inline">{ts(`weather.${dto.weather}`)}</dd></div> : null}
          <div><dt className="inline text-muted-foreground">{t('version')}: </dt><dd className="inline">{t('versionValue', { version: dto.versionNo })}</dd></div>
          {dto.location ? (
            <div><dt className="inline text-muted-foreground">{t('location')}: </dt><dd className="inline"><bdi dir="ltr">{dto.location.latitude.toFixed(5)}, {dto.location.longitude.toFixed(5)}</bdi></dd></div>
          ) : null}
          {dto.offline && dto.capturedAt && dto.receivedAt - dto.capturedAt > 15 * 60 * 1000 ? (
            <div><dt className="inline text-muted-foreground">{t('syncedLater')}: </dt><dd className="inline">{dateTime(dto.receivedAt)}</dd></div>
          ) : null}
          {dto.followUpOf ? (
            <div><dt className="inline text-muted-foreground">{t('followUpOf')}: </dt><dd className="inline"><Link className="underline" href={`/projects/${project.id}/inspections/${dto.followUpOf.id}`}><bdi dir="ltr">{dto.followUpOf.reference}</bdi></Link></dd></div>
          ) : null}
        </dl>
        {dto.note ? <p className="text-sm">{t('note')}: {dto.note}</p> : null}
        {dto.cancelReason ? <Alert tone="info">{t('cancelledBecause', { reason: dto.cancelReason })}</Alert> : null}
      </div>

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      {dto.canCapture || (dto.status === 'draft' && allowed.includes('start')) ? (
        <Link
          href={captureHref(project.id, dto.id)}
          className="inline-flex min-h-12 items-center justify-center rounded-lg bg-primary px-5 font-medium text-white hover:bg-primary/90"
        >
          {dto.status === 'draft' ? t('startCapture') : t('continueCapture')}
        </Link>
      ) : null}

      {dto.status !== 'draft' ? (
        <section className="flex flex-col gap-3" aria-labelledby="results-title">
          <div className="flex items-center justify-between">
            <h2 id="results-title" className="text-lg font-semibold">{t('results')}</h2>
            <Button size="sm" variant="ghost" onClick={() => { setShowAll((v) => !v); }}>
              {showAll ? t('showProblems') : t('showAll')}
            </Button>
          </div>
          {dto.content.sections.map((section) => {
            const shown = section.items.filter((item) => {
              const r = results.get(item.key)?.result;
              return showAll || r === 'fail' || r === 'observation' || r === 'not_inspected';
            });
            if (shown.length === 0) return null;
            return (
              <div key={section.key} className="flex flex-col gap-2">
                <h3 className="font-medium">{pick(section.title)}</h3>
                <ul className="flex flex-col gap-2">
                  {shown.map((item) => {
                    const r = results.get(item.key);
                    const Icon = r?.result ? RESULT_ICONS[r.result] : RESULT_ICONS.not_inspected;
                    const photos = dto.files.filter((f) => f.itemKey === item.key);
                    return (
                      <li key={item.key} className="flex flex-col gap-1 rounded-lg border border-border p-3">
                        <div className="flex items-start gap-2">
                          <Icon aria-hidden className={`mt-0.5 size-5 shrink-0 ${r?.result === 'fail' ? 'text-danger' : ''}`} />
                          <div className="flex flex-1 flex-col gap-1">
                            <span>{pick(item.question)}</span>
                            <span className="text-sm font-medium">{r?.result ? tr(r.result) : t('unanswered')}</span>
                            {r?.comment ? <p className="text-sm text-muted-foreground">{r.comment}</p> : null}
                          </div>
                        </div>
                        {photos.length > 0 ? (
                          <div className="flex flex-wrap gap-2">
                            {photos.map((photo) =>
                              photoUrls[photo.id] ? (
                                <a key={photo.id} href={photoUrls[photo.id]} target="_blank" rel="noreferrer">
                                  {/* eslint-disable-next-line @next/next/no-img-element -- blob URLs */}
                                  <img src={photoUrls[photo.id]} alt={t('photoOf', { item: pick(item.question) })} className="size-20 rounded-md object-cover" />
                                </a>
                              ) : (
                                <span key={photo.id} className="flex size-20 items-center justify-center rounded-md bg-muted text-xs">{photo.name}</span>
                              ),
                            )}
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
          {items.length > 0 && !showAll && !dto.items.some((i) => i.result === 'fail' || i.result === 'observation' || i.result === 'not_inspected') ? (
            <p className="text-muted-foreground">{t('noProblems')}</p>
          ) : null}
        </section>
      ) : null}

      {dto.findings.length > 0 ? (
        <FindingsPanel dto={dto} projectId={project.id} onChanged={load} readOnly={readOnly} />
      ) : null}

      <section className="flex flex-col gap-3" aria-labelledby="comments-title">
        <h2 id="comments-title" className="text-lg font-semibold">{t('comments')}</h2>
        <CommentThread projectId={project.id} actionId={dto.id} api={comments} />
      </section>

      <History projectId={project.id} id={dto.id} />

      {allowed.some((a) => ['return', 'approve', 'cancel', 'reassign', 'withdraw'].includes(a)) ? (
        <div className="fixed inset-x-0 bottom-0 z-10 flex flex-wrap gap-2 border-t border-border bg-background p-3">
          {allowed.includes('approve') ? <Button className="flex-1" onClick={() => { setDialog('approve'); }}>{t('approve')}</Button> : null}
          {allowed.includes('return') ? <Button variant="secondary" onClick={() => { setDialog('return'); }}>{t('return')}</Button> : null}
          {allowed.includes('withdraw') ? <Button variant="secondary" onClick={() => { move({ to: 'withdraw' }, t('withdrawn')); }}>{t('withdraw')}</Button> : null}
          {allowed.includes('reassign') ? <Button variant="secondary" onClick={() => { setDialog('reassign'); }}>{t('reassign')}</Button> : null}
          {allowed.includes('cancel') ? <Button variant="secondary" onClick={() => { setDialog('cancel'); }}>{t('cancel')}</Button> : null}
        </div>
      ) : null}

      {dialog === 'return' || dialog === 'cancel' ? (
        <ReasonDialog
          title={dialog === 'return' ? t('returnTitle') : t('cancelTitle')}
          label={dialog === 'return' ? t('returnReason') : t('cancelReason')}
          submitLabel={dialog === 'return' ? t('return') : t('cancel')}
          onClose={() => { setDialog(null); }}
          onSubmit={(reason) => {
            move(dialog === 'return' ? { to: 'return', reason } : { to: 'cancel', reason }, dialog === 'return' ? t('returned') : t('cancelled'));
          }}
        />
      ) : null}
      {dialog === 'reassign' ? (
        <ReassignDialog
          projectId={project.id}
          current={dto.inspector.id}
          onClose={() => { setDialog(null); }}
          onSubmit={(inspectorId) => { move({ to: 'reassign', inspectorId }, t('reassigned')); }}
        />
      ) : null}
      {dialog === 'approve' ? (
        <FormDialog
          open
          title={t('approveTitle', { ref: dto.reference ?? '' })}
          submitLabel={t('approve')}
          cancelLabel={tc('cancel')}
          error={error}
          onClose={() => { setDialog(null); }}
          onSubmit={() => { move({ to: 'approve' }, t('approved')); }}
        >
          {dto.findings.length === 0 ? (
            <p>{t('approveNoFindings')}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {dto.findings.map((f) => (
                <li key={f.id} className="flex flex-col gap-1 rounded-lg border border-border p-2 text-sm">
                  <span className="font-medium">{t('findingNumber', { number: f.seq })} · {f.description}</span>
                  <span>
                    {(f.decision ?? 'raise_action') === 'raise_action'
                      ? f.responsible
                        ? t('willRaise', { owner: f.responsible.name, date: calendarDate(f.dueOn) })
                        : t('ownerMissing')
                      : t('willNotRaise', { reason: f.noActionReason ?? '' })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </FormDialog>
      ) : null}
    </div>
  );
}

function FindingsPanel({ dto, projectId, onChanged, readOnly }: { dto: InspectionDto; projectId: string; onChanged: () => void; readOnly: boolean }) {
  const t = useTranslations('inspections.findings');
  const tf = useTranslations('inspections.findingStatus');
  const { calendarDate } = useDateFormat();
  const [editing, setEditing] = useState<{ finding: FindingDto; mode: 'edit' | 'raise' | 'no_action' } | null>(null);
  return (
    <section className="flex flex-col gap-3" aria-labelledby="findings-title">
      <h2 id="findings-title" className="text-lg font-semibold">{t('title', { count: dto.findings.length })}</h2>
      <ul className="flex flex-col gap-2">
        {dto.findings.map((f) => (
          <li key={f.id} id={`finding-${f.id}`} className="flex flex-col gap-2 rounded-xl border border-border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{t('number', { number: f.seq })}</span>
              <PriorityChip priority={f.severity} />
              <span className="rounded-full border border-border px-2 py-0.5 text-xs">{tf(f.status)}</span>
              {f.edited ? <span className="text-xs text-muted-foreground">{t('edited')}</span> : null}
            </div>
            <p className="text-sm">{f.description}</p>
            <p className="text-sm text-muted-foreground">
              {f.responsible ? t('responsible', { name: f.responsible.name }) : t('noResponsible')} · {t('due', { date: calendarDate(f.dueOn) })}
            </p>
            {f.decision === 'no_action' || f.status === 'no_action' ? <p className="text-sm">{t('noActionBecause', { reason: f.noActionReason ?? '' })}</p> : null}
            {f.actions.length > 0 ? (
              <ul className="flex flex-col gap-1 text-sm">
                {f.actions.map((a) => (
                  <li key={a.id}>
                    <Link href={`/projects/${projectId}/actions/${a.id}`} className="text-primary underline-offset-4 hover:underline">
                      <bdi dir="ltr">{a.reference}</bdi>
                    </Link>{' '}
                    · {a.ownerName} · {a.voided ? t('voided') : t(`actionStatus.${a.status}`)}
                  </li>
                ))}
              </ul>
            ) : null}
            {!readOnly ? (
              <div className="flex flex-wrap gap-2">
                {dto.canEditFindings ? <Button size="sm" variant="secondary" onClick={() => { setEditing({ finding: f, mode: 'edit' }); }}>{t('edit')}</Button> : null}
                {dto.canRaiseActions && (f.status === 'open' || f.status === 'action_raised') ? (
                  <Button size="sm" variant="secondary" onClick={() => { setEditing({ finding: f, mode: 'raise' }); }}>
                    {f.status === 'open' ? t('raise') : t('raiseAnother')}
                  </Button>
                ) : null}
                {dto.canRaiseActions && f.status === 'open' ? (
                  <Button size="sm" variant="ghost" onClick={() => { setEditing({ finding: f, mode: 'no_action' }); }}>{t('noAction')}</Button>
                ) : null}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {editing ? (
        <FindingDialog
          projectId={projectId}
          inspectionId={dto.id}
          finding={editing.finding}
          mode={editing.mode}
          onClose={() => { setEditing(null); }}
          onDone={() => {
            setEditing(null);
            onChanged();
          }}
        />
      ) : null}
    </section>
  );
}

function FindingDialog({
  projectId,
  inspectionId,
  finding,
  mode,
  onClose,
  onDone,
}: {
  projectId: string;
  inspectionId: string;
  finding: FindingDto;
  mode: 'edit' | 'raise' | 'no_action';
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations('inspections.findings');
  const tp = useTranslations('actions.priority');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const descriptionId = useId();
  const severityId = useId();
  const ownerId = useId();
  const dueId = useId();
  const decisionId = useId();
  const reasonId = useId();
  const [description, setDescription] = useState(finding.description);
  const [severity, setSeverity] = useState(finding.severity);
  const [owner, setOwner] = useState(finding.responsible?.id ?? '');
  const [dueOn, setDueOn] = useState(finding.dueOn);
  const [decision, setDecision] = useState(finding.decision ?? 'raise_action');
  const [reason, setReason] = useState(finding.noActionReason ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const submit = () => {
    setSaving(true);
    setError(null);
    const task =
      mode === 'edit'
        ? inspectionsService.updateFinding(projectId, inspectionId, finding.id, {
            description,
            severity,
            responsibleId: owner || null,
            dueOn,
            decision,
            reason: decision === 'no_action' ? reason : null,
          })
        : mode === 'raise'
          ? inspectionsService.raiseAction(projectId, inspectionId, finding.id, { ownerId: owner, dueOn, priority: severity })
          : inspectionsService.noAction(projectId, inspectionId, finding.id, reason);
    task.then(onDone, (failure: unknown) => { setError(errorMessage(failure)); }).finally(() => { setSaving(false); });
  };
  return (
    <FormDialog
      open
      title={mode === 'edit' ? t('editTitle', { number: finding.seq }) : mode === 'raise' ? t('raiseTitle', { number: finding.seq }) : t('noActionTitle', { number: finding.seq })}
      error={error}
      saving={saving}
      submitLabel={mode === 'raise' ? t('raise') : tc('save')}
      cancelLabel={tc('cancel')}
      onClose={onClose}
      onSubmit={submit}
    >
      {mode === 'edit' ? (
        <FormField id={descriptionId} label={t('description')}>
          <Textarea id={descriptionId} value={description} maxLength={2000} onChange={(e) => { setDescription(e.target.value); }} />
        </FormField>
      ) : null}
      {mode !== 'no_action' ? (
        <>
          <FormField id={severityId} label={t('severity')}>
            <Select id={severityId} value={severity} onChange={(e) => { setSeverity(e.target.value as FindingDto['severity']); }}>
              {FINDING_SEVERITIES.map((s) => <option key={s} value={s}>{tp(s)}</option>)}
            </Select>
          </FormField>
          <FormField id={ownerId} label={t('responsibleLabel')}>
            <PersonSelect id={ownerId} projectId={projectId} value={owner} currentName={finding.responsible?.name ?? ''} onChange={(id) => { setOwner(id); }} />
          </FormField>
          <FormField id={dueId} label={t('dueLabel')}>
            <Input id={dueId} type="date" value={dueOn} onChange={(e) => { setDueOn(e.target.value); }} />
          </FormField>
        </>
      ) : null}
      {mode === 'edit' ? (
        <FormField id={decisionId} label={t('decision')}>
          <Select id={decisionId} value={decision} onChange={(e) => { setDecision(e.target.value as 'raise_action' | 'no_action'); }}>
            <option value="raise_action">{t('raise')}</option>
            <option value="no_action">{t('noAction')}</option>
          </Select>
        </FormField>
      ) : null}
      {mode === 'no_action' || decision === 'no_action' ? (
        <FormField id={reasonId} label={t('reason')}>
          <Textarea id={reasonId} value={reason} maxLength={500} onChange={(e) => { setReason(e.target.value); }} />
        </FormField>
      ) : null}
    </FormDialog>
  );
}

function ReasonDialog({ title, label, submitLabel, onClose, onSubmit }: { title: string; label: string; submitLabel: string; onClose: () => void; onSubmit: (reason: string) => void }) {
  const tc = useTranslations('common');
  const t = useTranslations('inspections.page');
  const id = useId();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <FormDialog
      open
      title={title}
      error={error}
      submitLabel={submitLabel}
      cancelLabel={tc('cancel')}
      tone="danger"
      onClose={onClose}
      onSubmit={() => {
        if (reason.trim().length < 5) {
          setError(t('reasonTooShort'));
          return;
        }
        onSubmit(reason.trim());
      }}
    >
      <FormField id={id} label={label}>
        <Textarea id={id} value={reason} maxLength={1000} onChange={(e) => { setReason(e.target.value); }} />
      </FormField>
    </FormDialog>
  );
}

function ReassignDialog({ projectId, current, onClose, onSubmit }: { projectId: string; current: string; onClose: () => void; onSubmit: (inspectorId: string) => void }) {
  const t = useTranslations('inspections.page');
  const tc = useTranslations('common');
  const id = useId();
  const [inspector, setInspector] = useState('');
  return (
    <FormDialog
      open
      title={t('reassignTitle')}
      submitLabel={t('reassign')}
      cancelLabel={tc('cancel')}
      onClose={onClose}
      onSubmit={() => { if (inspector) onSubmit(inspector); }}
    >
      <FormField id={id} label={t('newInspector')}>
        <PersonSelect id={id} projectId={projectId} value={inspector} exclude={[current]} onChange={(userId) => { setInspector(userId); }} />
      </FormField>
    </FormDialog>
  );
}

function History({ projectId, id }: { projectId: string; id: string }) {
  const t = useTranslations('inspections.page');
  const sentence = useActivitySentence();
  const { dateTime } = useDateFormat();
  const [page, setPage] = useState<TimelinePageDto | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    inspectionsService.history(projectId, id).then(setPage, () => undefined);
  }, [open, projectId, id]);
  return (
    <details className="rounded-xl border border-border p-4" onToggle={(e) => { setOpen((e.target as HTMLDetailsElement).open); }}>
      <summary className="cursor-pointer font-medium">{t('history')}</summary>
      {page ? (
        <ul className="mt-3 flex flex-col gap-2 text-sm">
          {page.items.map((entry) => (
            <li key={entry.id}>
              <span>{sentence(entry)}</span> <span className="text-muted-foreground">{dateTime(entry.occurredAt)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </details>
  );
}
