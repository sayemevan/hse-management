'use client';

import type { ActionDto, ActionTransition, ActivityEntryDto } from '@hse/shared';
import { ArrowLeft, History, MapPin, MessageSquare, ListChecks, Info } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ReactNode, useCallback, useEffect, useState } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useLoad } from '@/modules/app/use-load';
import { useReadOnly } from '@/modules/billing/use-subscription-state';
import { useDateFormat } from '@/modules/i18n/use-date-format';
import { useErrorMessage } from '@/modules/i18n/use-error-message';
import { useCurrentProject } from '@/modules/projects/project-context';
import { useActivitySentence } from '@/modules/projects/timeline-screen';
import { cn } from '@/utils/cn';

import { StepDialog, type StepKind } from './action-dialogs';
import { ActionStatusChip, DueBadge, PriorityChip } from './action-ui';
import { actionsService } from './actions.service';
import { CommentThread } from './comment-thread';
import { EvidenceRow } from './evidence';
import { PeopleField } from './person-select';

const TABS = ['details', 'updates', 'comments', 'history'] as const;
type Tab = (typeof TABS)[number];
const TAB_ICONS = { details: Info, updates: ListChecks, comments: MessageSquare, history: History };

/** The step buttons, in the order of the workflow (T-58: only what the caller may do now). */
const STEP_ORDER: ActionTransition[] = [
  'start',
  'complete',
  'verify_and_close',
  'verify',
  'send_back',
  'close',
];

/** US-053 – US-058: one action. */
export function ActionScreen({ actionId }: { actionId: string }) {
  const t = useTranslations('actions');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const readOnly = useReadOnly();
  const params = useSearchParams();
  const { project } = useCurrentProject();
  const [tab, setTab] = useState<Tab>('details');
  const [override, setOverride] = useState<ActionDto | null>(null);
  const [step, setStep] = useState<StepKind | null>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; text: string } | null>(
    params.get('created') ? { tone: 'success', text: t('created') } : null,
  );
  const loaded = useLoad(
    useCallback(() => actionsService.get(project.id, actionId), [project.id, actionId]),
    `${project.id}:${actionId}`,
  );
  const action = override?.id === actionId ? override : loaded.status === 'ready' ? loaded.value : null;

  if (!action) {
    return loaded.status === 'error' ? (
      <Alert tone="danger">{errorMessage(loaded.error)}</Alert>
    ) : (
      <div className="flex items-center gap-3" role="status">
        <Spinner />
        {tc('loading')}
      </div>
    );
  }

  const run = (kind: StepKind) => {
    setNotice(null);
    setStep(kind);
  };
  const start = () => {
    actionsService.transition(project.id, action.id, { transition: 'start' }).then(
      (updated) => {
        setOverride(updated);
        setNotice({ tone: 'success', text: t('done.start') });
      },
      (failure: unknown) => {
        setNotice({ tone: 'danger', text: errorMessage(failure) });
      },
    );
  };
  const steps = readOnly
    ? []
    : STEP_ORDER.filter((name) => action.allowedTransitions.includes(name));

  return (
    <div className="flex flex-col gap-5">
      <Link
        href={`/projects/${project.id}/actions`}
        className="inline-flex w-fit items-center gap-2 text-sm font-medium text-primary underline-offset-4 hover:underline"
      >
        <ArrowLeft aria-hidden className="size-4 rtl:-scale-x-100" />
        {t('backToList')}
      </Link>

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <bdi dir="ltr" className="font-mono text-muted-foreground">
            {action.reference}
          </bdi>
          <ActionStatusChip status={action.status} voided={action.voided} />
          <PriorityChip priority={action.priority} />
          <DueBadge state={action.dueState} dueOn={action.dueOn} daysOverdue={action.daysOverdue} />
        </div>
        <h2 className={cn('text-xl font-semibold', action.voided ? 'line-through' : '')}>
          <bdi>{action.title}</bdi>
        </h2>
        <p className="text-sm text-muted-foreground">
          {t('ownerLine', { name: action.owner.name })}
          {action.owner.hasAccess ? null : (
            <span className="ms-2 text-danger">{t('ownerNoAccess')}</span>
          )}
        </p>
      </div>

      <Banners action={action} />
      {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}

      {steps.length > 0 || (action.can.addProgress && !readOnly) ? (
        <div className="flex flex-wrap gap-2">
          {steps.map((name) => (
            <Button
              key={name}
              variant={name === 'send_back' ? 'secondary' : 'primary'}
              onClick={() => {
                if (name === 'start') start();
                else run(name);
              }}
            >
              {t(`steps.${name}`)}
            </Button>
          ))}
          {action.can.addProgress && !readOnly ? (
            <Button
              variant="secondary"
              onClick={() => {
                run('progress');
              }}
            >
              {t('steps.progress')}
            </Button>
          ) : null}
        </div>
      ) : null}
      {action.can.verifyBlockedAsParticipant ? (
        <Alert tone="info">{t('cannotVerifyOwn')}</Alert>
      ) : null}

      <nav aria-label={t('sections')} className="-mx-4 overflow-x-auto px-4">
        <ul className="flex min-w-max border-b border-border">
          {TABS.map((value) => {
            const Icon = TAB_ICONS[value];
            return (
              <li key={value}>
                <button
                  type="button"
                  aria-current={tab === value ? 'page' : undefined}
                  onClick={() => {
                    setTab(value);
                  }}
                  className={cn(
                    'inline-flex min-h-12 items-center gap-2 border-b-2 px-4 font-medium',
                    tab === value ? 'border-primary text-primary' : 'border-transparent hover:bg-muted',
                  )}
                >
                  <Icon aria-hidden className="size-4" />
                  {t(`tabs.${value}`)}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      {tab === 'details' ? (
        <Details
          action={action}
          readOnly={readOnly}
          onStep={run}
          onChanged={(updated) => {
            setOverride(updated);
          }}
          onError={(text) => {
            setNotice({ tone: 'danger', text });
          }}
        />
      ) : null}
      {tab === 'updates' ? <Updates action={action} /> : null}
      {tab === 'comments' ? <CommentThread projectId={project.id} actionId={action.id} /> : null}
      {tab === 'history' ? <ActionHistory projectId={project.id} actionId={action.id} /> : null}

      <StepDialog
        kind={step}
        action={action}
        onClose={() => {
          setStep(null);
        }}
        onDone={(updated, message) => {
          setStep(null);
          setOverride(updated);
          setNotice({ tone: 'success', text: message });
        }}
      />
    </div>
  );
}

function Banners({ action }: { action: ActionDto }) {
  const t = useTranslations('actions');
  const { dateTime } = useDateFormat();
  return (
    <>
      {action.voided ? (
        <Alert tone="danger">{t('voidedBanner', { reason: action.voidReason ?? '' })}</Alert>
      ) : null}
      {action.status === 'closed' && action.closedBy ? (
        <Alert tone="success">
          {t('closedBanner', { name: action.closedBy.name, date: dateTime(action.closedAt) })}
        </Alert>
      ) : null}
      {action.status === 'completed' && !action.voided ? (
        <Alert tone="info">{t('waitingVerification')}</Alert>
      ) : null}
      {action.sentBackReason ? (
        <Alert tone="warning">{t('sentBackBanner', { reason: action.sentBackReason })}</Alert>
      ) : null}
    </>
  );
}

function Details({
  action,
  readOnly,
  onStep,
  onChanged,
  onError,
}: {
  action: ActionDto;
  readOnly: boolean;
  onStep: (kind: StepKind) => void;
  onChanged: (updated: ActionDto) => void;
  onError: (text: string) => void;
}) {
  const t = useTranslations('actions');
  const errorMessage = useErrorMessage();
  const { calendarDate, dateTime } = useDateFormat();
  const [historyOpen, setHistoryOpen] = useState(false);
  const can = readOnly
    ? { ...action.can, edit: false, reassign: false, manageCollaborators: false, void: false, followUp: false }
    : action.can;

  const row = (label: string, value: ReactNode) => (
    <div className="flex flex-col gap-1 sm:flex-row sm:gap-4">
      <dt className="text-sm text-muted-foreground sm:w-40">{label}</dt>
      <dd>{value}</dd>
    </div>
  );

  const setCollaborators = (people: { id: string; name: string }[]) => {
    const current = action.collaborators.map((c) => c.id);
    const next = people.map((p) => p.id);
    const added = next.filter((id) => !current.includes(id));
    const removed = current.filter((id) => !next.includes(id));
    const done = added.length
      ? actionsService.addCollaborators(action.projectId, action.id, { userIds: added })
      : Promise.all(
          removed.map((id) => actionsService.removeCollaborator(action.projectId, action.id, id)),
        ).then(() => actionsService.get(action.projectId, action.id));
    done.then(onChanged, (failure: unknown) => {
      onError(errorMessage(failure));
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <dl className="flex flex-col gap-3">
        {row(t('fields.type'), t(`type.${action.type}`))}
        {row(t('fields.dueOn'), calendarDate(action.dueOn))}
        {row(
          t('fields.source'),
          action.source.module === 'action' && action.source.recordId ? (
            <Link
              href={`/projects/${action.projectId}/actions/${action.source.recordId}`}
              className="text-primary underline-offset-4 hover:underline"
            >
              {t('followUpOfLabel')}{' '}
              <bdi dir="ltr" className="font-mono">
                {action.source.label}
              </bdi>
            </Link>
          ) : action.source.module === 'manual' ? (
            t('sourceManual')
          ) : (
            <bdi>{action.source.label}</bdi>
          ),
        )}
        {action.place
          ? row(
              t('fields.place'),
              <span className="inline-flex items-center gap-1">
                <MapPin aria-hidden className="size-4" />
                <bdi>{action.place.names.join(' › ')}</bdi>
              </span>,
            )
          : null}
        {row(
          t('fields.createdBy'),
          t('createdLine', { name: action.createdBy.name, date: dateTime(action.createdAt) }),
        )}
        {action.verifiedBy
          ? row(
              t('fields.verifiedBy'),
              t('verifiedLine', {
                name: action.verifiedBy.name,
                method: action.verificationMethod ? t(`method.${action.verificationMethod}`) : '',
              }),
            )
          : null}
        {action.description ? (
          row(
            t('fields.description'),
            <p dir="auto" className="whitespace-pre-wrap">
              {action.description}
            </p>,
          )
        ) : null}
      </dl>

      <section className="flex flex-col gap-3">
        <h3 className="font-semibold">{t('people')}</h3>
        <p>
          {t('ownerLine', { name: action.owner.name })}
          {can.reassign ? (
            <Button
              size="sm"
              variant="secondary"
              className="ms-3"
              onClick={() => {
                onStep('owner');
              }}
            >
              {t('changeOwner')}
            </Button>
          ) : null}
        </p>
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">{t('fields.collaborators')}</span>
          {can.manageCollaborators ? (
            <PeopleField
              id="detail-collaborators"
              projectId={action.projectId}
              people={action.collaborators.map((c) => ({ id: c.id, name: c.name }))}
              onChange={setCollaborators}
              exclude={[action.owner.id]}
              max={5}
            />
          ) : action.collaborators.length > 0 ? (
            <p>{action.collaborators.map((c) => c.name).join(', ')}</p>
          ) : (
            <p className="text-muted-foreground">{t('noCollaborators')}</p>
          )}
        </div>
        <button
          type="button"
          aria-expanded={historyOpen}
          className="min-h-10 w-fit text-sm font-medium text-primary"
          onClick={() => {
            setHistoryOpen(!historyOpen);
          }}
        >
          {t('ownerHistory')}
        </button>
        {historyOpen ? (
          <ul className="flex flex-col gap-1 text-sm">
            {action.ownerHistory.map((entry) => (
              <li key={`${entry.owner.id}-${String(entry.fromAt)}`}>
                {t('ownerHistoryLine', {
                  name: entry.owner.name,
                  from: dateTime(entry.fromAt),
                  to: entry.toAt ? dateTime(entry.toAt) : t('now'),
                })}
                {entry.reason ? <span className="text-muted-foreground"> — {entry.reason}</span> : null}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {action.followUps.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h3 className="font-semibold">{t('followUps')}</h3>
          <ul className="flex flex-col gap-1">
            {action.followUps.map((f) => (
              <li key={f.id}>
                <Link
                  href={`/projects/${action.projectId}/actions/${f.id}`}
                  className="text-primary underline-offset-4 hover:underline"
                >
                  <bdi dir="ltr" className="font-mono">
                    {f.reference}
                  </bdi>
                </Link>{' '}
                <ActionStatusChip status={f.status} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {can.edit ? (
          <Button
            variant="secondary"
            onClick={() => {
              onStep('edit');
            }}
          >
            {t('edit')}
          </Button>
        ) : null}
        {can.followUp ? (
          <Link
            href={`/projects/${action.projectId}/actions/new?followUpOf=${action.id}`}
            className="inline-flex min-h-12 items-center rounded-lg border border-border px-5 font-medium hover:bg-muted"
          >
            {t('createFollowUp')}
          </Link>
        ) : null}
        {can.void ? (
          <Button
            variant="danger"
            onClick={() => {
              onStep('void');
            }}
          >
            {t('void')}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function Updates({ action }: { action: ActionDto }) {
  const t = useTranslations('actions');
  const { dateTime } = useDateFormat();
  const byId = new Map(action.files.map((f) => [f.id, f]));
  const unused = action.files.filter(
    (f) => !action.updates.some((u) => u.fileIds.includes(f.id)),
  );
  if (action.updates.length === 0 && action.files.length === 0) {
    return <p className="text-muted-foreground">{t('noUpdates')}</p>;
  }
  return (
    <div className="flex flex-col gap-4">
      {action.progressPercent !== null ? (
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium">{t('percent', { value: action.progressPercent })}</span>
          <div
            className="h-2 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuenow={action.progressPercent}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div className="h-full bg-primary" style={{ width: `${String(action.progressPercent)}%` }} />
          </div>
        </div>
      ) : null}
      <ol className="flex flex-col gap-3">
        {action.updates.map((update) => (
          <li
            key={update.id}
            className={cn(
              'flex flex-col gap-2 rounded-xl border p-3',
              update.kind === 'completion' || update.kind === 'verification'
                ? 'border-primary'
                : 'border-border',
            )}
          >
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="font-medium">
                {t(`updateKind.${update.kind}`)} · {update.by.name}
              </span>
              <span className="text-muted-foreground">{dateTime(update.at)}</span>
            </div>
            {update.method ? <p className="text-sm">{t(`method.${update.method}`)}</p> : null}
            {update.percent !== null && update.kind === 'progress' ? (
              <p className="text-sm">{t('percent', { value: update.percent })}</p>
            ) : null}
            {update.note ? (
              <p dir="auto" className="whitespace-pre-wrap">
                {update.note}
              </p>
            ) : null}
            <EvidenceRow
              projectId={action.projectId}
              actionId={action.id}
              files={update.fileIds.flatMap((id) => {
                const file = byId.get(id);
                return file ? [file] : [];
              })}
            />
          </li>
        ))}
      </ol>
      {unused.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">{t('otherFiles')}</h3>
          <EvidenceRow projectId={action.projectId} actionId={action.id} files={unused} />
        </section>
      ) : null}
    </div>
  );
}

function ActionHistory({ projectId, actionId }: { projectId: string; actionId: string }) {
  const t = useTranslations('actions');
  const tc = useTranslations('common');
  const sentence = useActivitySentence();
  const { dateTime } = useDateFormat();
  const errorMessage = useErrorMessage();
  const [items, setItems] = useState<ActivityEntryDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    actionsService.history(projectId, actionId, null).then(
      (page) => {
        setItems(page.items);
      },
      (failure: unknown) => {
        setError(errorMessage(failure));
      },
    );
  }, [projectId, actionId, errorMessage]);
  if (error) return <Alert tone="danger">{error}</Alert>;
  if (!items) {
    return (
      <div className="flex items-center gap-3" role="status">
        <Spinner />
        {tc('loading')}
      </div>
    );
  }
  if (items.length === 0) return <p className="text-muted-foreground">{t('noHistory')}</p>;
  return (
    <ol className="flex flex-col gap-2">
      {items.map((entry) => (
        <li key={entry.id} className="flex flex-col gap-0.5 border-s-2 border-border ps-3">
          <span>{sentence(entry)}</span>
          <span className="text-sm text-muted-foreground">{dateTime(entry.occurredAt)}</span>
        </li>
      ))}
    </ol>
  );
}
