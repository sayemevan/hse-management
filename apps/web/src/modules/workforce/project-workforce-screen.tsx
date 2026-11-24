'use client';

import {
  type ProjectWorkforcePageDto,
  type ProjectWorkforceRowDto,
  WORKFORCE_LIMITS,
  type WorkforceCandidateDto,
  type WorkforceListItemDto,
} from '@hse/shared';
import { UserPlus, X } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';

import { FormField } from '@/components/form/form-field';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { useLoad } from '@/modules/app/use-load';
import { useReadOnly } from '@/modules/billing/use-subscription-state';
import { useDateFormat } from '@/modules/i18n/use-date-format';
import { useErrorMessage } from '@/modules/i18n/use-error-message';
import { useCurrentProject } from '@/modules/projects/project-context';
import { ApiClientError } from '@/services/api-client';
import { cn } from '@/utils/cn';

import { projectWorkforceService, workforceService } from './workforce.service';
import {
  ComplianceBadge,
  FormDialog,
  PersonPhoto,
  RowMenu,
  todayIso,
  usePersonName,
  usePositionName,
} from './workforce-ui';

const STATES = ['current', 'upcoming', 'ended', 'all'] as const;

/** US-025: the project's Workforce tab. */
export function ProjectWorkforceScreen() {
  const t = useTranslations('workforce.project');
  const tw = useTranslations('workforce');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const readOnly = useReadOnly();
  const params = useSearchParams();
  const { project } = useCurrentProject();
  const [state, setState] = useState<(typeof STATES)[number]>('current');
  const [attention, setAttention] = useState(params.get('attention') === 'true');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [assigning, setAssigning] = useState(false);
  const [ending, setEnding] = useState<ProjectWorkforceRowDto | null>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const positionName = usePositionName();
  const personName = usePersonName();
  const { calendarDate } = useDateFormat();

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 300);
    return () => {
      window.clearTimeout(timer);
    };
  }, [search]);

  const loaded = useLoad<ProjectWorkforcePageDto>(
    useCallback(
      () => projectWorkforceService.list(project.id, { search: query, state, attention, page }),
      [project.id, query, state, attention, page],
    ),
    `${project.id}:${query}:${state}:${String(attention)}:${String(page)}`,
  );
  const data = loaded.status === 'ready' ? loaded.value : null;
  const canManage = !readOnly && Boolean(data?.canManage);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  const cancel = (row: ProjectWorkforceRowDto) => {
    projectWorkforceService.cancel(project.id, row.assignmentId).then(
      () => {
        setNotice({ tone: 'success', text: t('cancelled') });
        loaded.reload();
      },
      (failure: unknown) => {
        setNotice({ tone: 'danger', text: errorMessage(failure) });
      },
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-1 flex-col gap-2 sm:max-w-sm">
          <label htmlFor="project-workforce-search" className="text-sm font-medium">
            {tw('search')}
          </label>
          <Input
            id="project-workforce-search"
            type="search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
            }}
          />
        </div>
        {!readOnly && data?.canAssign ? (
          <Button
            onClick={() => {
              setAssigning(true);
            }}
          >
            <UserPlus aria-hidden className="size-5" />
            {t('assign')}
          </Button>
        ) : null}
      </div>
      {data && data.canManage && !data.canAssign && !readOnly ? (
        <Alert tone="info">{t('closedHint')}</Alert>
      ) : null}
      <div className="flex flex-wrap gap-2" role="group" aria-label={t('show')}>
        {STATES.map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={state === value}
            onClick={() => {
              setState(value);
              setPage(1);
            }}
            className={cn(
              'min-h-10 rounded-full border px-4 text-sm font-medium',
              state === value
                ? 'border-primary bg-primary text-white'
                : 'border-border hover:bg-muted',
            )}
          >
            {t(`states.${value}`)}
          </button>
        ))}
      </div>
      <Checkbox
        id="project-workforce-attention"
        label={tw('needsAttention')}
        checked={attention}
        onChange={(event) => {
          setAttention(event.target.checked);
          setPage(1);
        }}
      />
      {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}
      {loaded.status === 'error' ? (
        <Alert tone="danger">{errorMessage(loaded.error)}</Alert>
      ) : !data ? (
        <div className="flex items-center gap-3" role="status">
          <Spinner />
          {tc('loading')}
        </div>
      ) : data.items.length === 0 ? (
        <p className="text-muted-foreground">{t('empty')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {data.items.map((row) => {
            const name = personName(row.member);
            const menu = canManage
              ? [
                  ...(row.state === 'current'
                    ? [
                        {
                          label: t('end'),
                          onSelect: () => {
                            setEnding(row);
                          },
                        },
                      ]
                    : []),
                  ...(row.state === 'upcoming'
                    ? [
                        {
                          label: t('cancel'),
                          danger: true,
                          onSelect: () => {
                            cancel(row);
                          },
                        },
                      ]
                    : []),
                ]
              : [];
            return (
              <li
                key={row.assignmentId}
                className="flex items-start gap-3 rounded-xl border border-border p-4"
              >
                <PersonPhoto url={row.member.photoUrl} name={name} />
                <div className="flex flex-1 flex-col gap-1">
                  {data.canOpenProfiles ? (
                    <Link
                      href={`/workforce/${row.member.id}`}
                      className="font-medium hover:underline"
                    >
                      <bdi>{name}</bdi>
                    </Link>
                  ) : (
                    <bdi className="font-medium">{name}</bdi>
                  )}
                  <span className="text-sm text-muted-foreground">
                    {positionName(row.position)} ·{' '}
                    {tw('assignments.range', {
                      from: calendarDate(row.startDate),
                      to: row.endDate ? calendarDate(row.endDate) : tw('assignments.open'),
                    })}
                  </span>
                  <span className="w-fit rounded-full bg-muted px-2 text-xs font-medium">
                    {tw(`assignments.state.${row.state}`)}
                  </span>
                  <ComplianceBadge compliance={row.member.compliance} />
                </div>
                <RowMenu label={t('actionsFor', { name })} items={menu} />
              </li>
            );
          })}
        </ul>
      )}
      {pages > 1 ? (
        <div className="flex items-center justify-between gap-2">
          <Button
            variant="secondary"
            disabled={page <= 1}
            onClick={() => {
              setPage(page - 1);
            }}
          >
            {tw('previous')}
          </Button>
          <span className="text-sm text-muted-foreground">{tw('pageOf', { page, pages })}</span>
          <Button
            variant="secondary"
            disabled={page >= pages}
            onClick={() => {
              setPage(page + 1);
            }}
          >
            {tw('next')}
          </Button>
        </div>
      ) : null}
      <AssignDialog
        open={assigning}
        projectId={project.id}
        onClose={() => {
          setAssigning(false);
        }}
        onSaved={(count) => {
          setAssigning(false);
          setNotice({ tone: 'success', text: t('assigned', { count }) });
          loaded.reload();
        }}
      />
      <EndDialog
        projectId={project.id}
        row={ending}
        onClose={() => {
          setEnding(null);
        }}
        onSaved={() => {
          setEnding(null);
          setNotice({ tone: 'success', text: t('ended') });
          loaded.reload();
        }}
      />
    </div>
  );
}

function AssignDialog({
  open,
  projectId,
  onClose,
  onSaved,
}: {
  open: boolean;
  projectId: string;
  onClose: () => void;
  onSaved: (count: number) => void;
}) {
  const t = useTranslations('workforce.project');
  const tw = useTranslations('workforce');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const positionName = usePositionName();
  const personName = usePersonName();
  const [search, setSearch] = useState('');
  const [candidates, setCandidates] = useState<WorkforceCandidateDto[]>([]);
  const [selected, setSelected] = useState<WorkforceCandidateDto[]>([]);
  const [positionId, setPositionId] = useState('own');
  const [startDate, setStartDate] = useState(todayIso);
  const [endDate, setEndDate] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [wasOpen, setWasOpen] = useState(false);
  const positions = useLoad<WorkforceListItemDto[]>(
    useCallback(() => workforceService.listItems('job_position'), []),
    'positions',
  );
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setSearch('');
      setSelected([]);
      setPositionId('own');
      setStartDate(todayIso());
      setEndDate('');
      setNote('');
      setError(null);
    }
  }
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      projectWorkforceService.candidates(projectId, search).then(
        (result) => {
          setCandidates(result.items);
        },
        (failure: unknown) => {
          setError(errorMessage(failure));
        },
      );
    }, 250);
    return () => {
      window.clearTimeout(timer);
    };
  }, [open, projectId, search, errorMessage]);

  const toggle = (candidate: WorkforceCandidateDto) => {
    setSelected((current) =>
      current.some((item) => item.id === candidate.id)
        ? current.filter((item) => item.id !== candidate.id)
        : current.length >= WORKFORCE_LIMITS.bulkAssignMax
          ? current
          : [...current, candidate],
    );
  };

  return (
    <FormDialog
      open={open}
      title={t('assignTitle')}
      error={error}
      saving={saving}
      submitLabel={t('assign')}
      cancelLabel={tc('cancel')}
      onClose={onClose}
      onSubmit={() => {
        if (selected.length === 0) {
          setError(t('chooseSomeone'));
          return;
        }
        if (endDate && endDate < startDate) {
          setError(t('endBeforeStart'));
          return;
        }
        setSaving(true);
        setError(null);
        projectWorkforceService
          .assign(projectId, {
            memberIds: selected.map((item) => item.id),
            positionId,
            startDate,
            endDate: endDate || null,
            note,
          })
          .then(onSaved, (failure: unknown) => {
            if (failure instanceof ApiClientError && failure.code === 'BULK_ASSIGN_REFUSED') {
              const names = new Map(selected.map((item) => [item.id, item.fullName]));
              setError(
                [
                  t('bulkRefused'),
                  ...failure.details.map((issue) =>
                    t(`refused.${issue.message}` as 'refused.overlap', {
                      name: names.get(issue.path) ?? '',
                    }),
                  ),
                ].join(' '),
              );
            } else setError(errorMessage(failure));
          })
          .finally(() => {
            setSaving(false);
          });
      }}
    >
      <FormField id="assign-search" label={t('people')} required requiredLabel={tc('required')}>
        <Input
          id="assign-search"
          type="search"
          value={search}
          placeholder={t('searchPeople')}
          onChange={(event) => {
            setSearch(event.target.value);
          }}
        />
      </FormField>
      {selected.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label={t('selected', { count: selected.length })}>
          {selected.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => {
                  toggle(item);
                }}
                className="inline-flex min-h-10 items-center gap-1 rounded-full bg-primary px-3 text-sm text-white"
                aria-label={t('unselect', { name: item.fullName })}
              >
                <bdi>{personName(item)}</bdi>
                <X aria-hidden className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto">
        {candidates.map((item) => {
          const checked = selected.some((row) => row.id === item.id);
          return (
            <li key={item.id}>
              <label className="flex min-h-12 cursor-pointer items-start gap-3 rounded-lg px-2 py-1 hover:bg-muted">
                <input
                  type="checkbox"
                  className="mt-1 size-5 accent-primary"
                  checked={checked}
                  disabled={item.onProject && !checked}
                  onChange={() => {
                    toggle(item);
                  }}
                />
                <span className="flex flex-col">
                  <bdi className="font-medium">{personName(item)}</bdi>
                  <span className="text-sm text-muted-foreground">
                    {positionName(item.position)} · <bdi>{item.employer}</bdi>
                    {item.onProject ? ` · ${t('onProject')}` : ''}
                  </span>
                  <ComplianceBadge compliance={item.compliance} />
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      <FormField id="assign-position" label={t('position')}>
        <Select
          id="assign-position"
          value={positionId}
          onChange={(event) => {
            setPositionId(event.target.value);
          }}
        >
          <option value="own">{t('ownPosition')}</option>
          {(positions.status === 'ready' ? positions.value : []).map((item) => (
            <option key={item.id} value={item.id}>
              {positionName(item)}
            </option>
          ))}
        </Select>
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="assign-start" label={t('startDate')} required requiredLabel={tc('required')}>
          <Input
            id="assign-start"
            type="date"
            value={startDate}
            onChange={(event) => {
              setStartDate(event.target.value);
            }}
          />
        </FormField>
        <FormField id="assign-end" label={t('endDate')}>
          <Input
            id="assign-end"
            type="date"
            value={endDate}
            onChange={(event) => {
              setEndDate(event.target.value);
            }}
          />
        </FormField>
      </div>
      <FormField id="assign-note" label={tw('records.note')}>
        <Input
          id="assign-note"
          value={note}
          onChange={(event) => {
            setNote(event.target.value);
          }}
        />
      </FormField>
    </FormDialog>
  );
}

function EndDialog({
  projectId,
  row,
  onClose,
  onSaved,
}: {
  projectId: string;
  row: ProjectWorkforceRowDto | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations('workforce.project');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const [endDate, setEndDate] = useState(todayIso);
  const [error, setError] = useState<string | null>(null);
  return (
    <FormDialog
      open={row !== null}
      title={t('endTitle')}
      error={error}
      submitLabel={t('end')}
      cancelLabel={tc('cancel')}
      onClose={() => {
        setError(null);
        onClose();
      }}
      onSubmit={() => {
        if (!row) return;
        projectWorkforceService
          .end(projectId, row.assignmentId, endDate)
          .then(onSaved, (failure: unknown) => {
            setError(errorMessage(failure));
          });
      }}
    >
      <FormField id="end-date" label={t('endDate')} required requiredLabel={tc('required')}>
        <Input
          id="end-date"
          type="date"
          value={endDate}
          max={todayIso()}
          onChange={(event) => {
            setEndDate(event.target.value);
          }}
        />
      </FormField>
    </FormDialog>
  );
}
