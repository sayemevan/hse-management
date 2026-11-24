'use client';

import {
  ACTIVITY_GROUPS,
  ACTIVITY_LONG_VALUE,
  type ActivityEntryDto,
  type ActivityGroup,
} from '@hse/shared';
import { FolderKanban, HardHat, MapPin, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useDateFormat } from '@/modules/i18n/use-date-format';
import { useErrorMessage } from '@/modules/i18n/use-error-message';
import { cn } from '@/utils/cn';

import { usePositionName, useRecordLabel } from '@/modules/workforce/workforce-ui';

import { useCurrentProject } from './project-context';
import { projectContextService } from './structure.service';

const ltr = (text: string) => `${String.fromCharCode(0x2066)}${text}${String.fromCharCode(0x2069)}`;

const GROUP_ICONS = {
  project: FolderKanban,
  members: Users,
  structure: MapPin,
  workforce: HardHat,
} as const;

/** The sentence of a timeline entry in the reader's language (PLT-18 FR-6). */
function useActivitySentence() {
  const t = useTranslations('timeline.actions');
  const roles = useTranslations('roles');
  const statuses = useTranslations('projectStatus');
  const levels = useTranslations('structure.level');
  const workforceStatus = useTranslations('workforce.status');
  const positionName = usePositionName();
  const recordLabel = useRecordLabel();
  return useCallback(
    (entry: ActivityEntryDto) => {
      const s = entry.snapshot;
      const actor = entry.actorName ?? t('system');
      const values = {
        actor,
        member: s.memberName ?? '',
        role: s.roleCode ? roles(s.roleCode as 'worker') : '',
        place: s.placeName ?? '',
        level: s.placeLevel ? levels(s.placeLevel as 'area') : '',
        count: s.count ?? 0,
        from: '',
        to: '',
        project: s.projectCode ? ltr(s.projectCode) : '',
        position: s.positionName
          ? positionName({ id: '', name: s.positionName, seedKey: s.positionKey ?? null })
          : '',
        status: s.status ? workforceStatus(s.status as 'active') : '',
        record: s.recordKind
          ? recordLabel({
              kind: s.recordKind as 'training',
              type: s.recordType ?? null,
              name: s.recordName ?? null,
            })
          : '',
      };
      if (entry.action === 'project.status.changed' || entry.action === 'project.restored') {
        const before = entry.changes?.before.status;
        const after = entry.changes?.after.status;
        values.from = typeof before === 'string' ? statuses(before as 'active') : '';
        values.to = typeof after === 'string' ? statuses(after as 'active') : '';
      }
      const key = entry.action.replace(/\./g, '_') as 'project_created';
      return t(key, values);
    },
    [t, roles, statuses, levels, workforceStatus, positionName, recordLabel],
  );
}

/** Timeline tab (PLT-18): newest first, grouped by day, filter chips, "Show changes". */
export function TimelineScreen() {
  const t = useTranslations('timeline');
  const errorMessage = useErrorMessage();
  const { project } = useCurrentProject();
  const [group, setGroup] = useState<ActivityGroup | null>(null);
  const [items, setItems] = useState<ActivityEntryDto[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(
    (before: string | null) => {
      setError(null);
      if (before) setLoadingMore(true);
      projectContextService
        .timeline(project.id, group, before)
        .then(
          (page) => {
            setItems((current) => (before && current ? [...current, ...page.items] : page.items));
            setNext(page.nextBefore);
          },
          (failure: unknown) => {
            setError(errorMessage(failure));
            setItems((current) => current ?? []);
          },
        )
        .finally(() => {
          setLoadingMore(false);
        });
    },
    [project.id, group, errorMessage],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      load(null);
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [load]);

  const chip = (value: ActivityGroup | null, label: string) => (
    <button
      key={label}
      type="button"
      aria-pressed={group === value}
      onClick={() => {
        setItems(null);
        setGroup(value);
      }}
      className={cn(
        'min-h-10 rounded-full border px-4 text-sm font-medium',
        group === value ? 'border-primary bg-primary text-white' : 'border-border hover:bg-muted',
      )}
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2" role="group" aria-label={t('filter')}>
        {chip(null, t('all'))}
        {ACTIVITY_GROUPS.filter(
          (value) =>
            (value !== 'members' || project.myPermissions.includes('projects.members.view')) &&
            (value !== 'workforce' || project.myPermissions.includes('projects.workforce.view')),
        ).map((value) => chip(value, t(`group.${value}`)))}
      </div>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {items === null ? (
        <div className="flex justify-center p-6" role="status">
          <Spinner />
        </div>
      ) : items.length === 0 ? (
        <p className="text-muted-foreground">{t('empty')}</p>
      ) : (
        <TimelineDays items={items} />
      )}
      {next ? (
        <Button
          variant="secondary"
          disabled={loadingMore}
          onClick={() => {
            load(next);
          }}
        >
          {loadingMore ? <Spinner /> : null}
          {t('loadMore')}
        </Button>
      ) : null}
    </div>
  );
}

/** Entries grouped by day (also the workforce profile History tab, T-56). */
export function TimelineDays({ items }: { items: ActivityEntryDto[] }) {
  const t = useTranslations('timeline');
  const { date, dateTime } = useDateFormat();
  const sentence = useActivitySentence();
  const [now] = useState(() => Date.now());
  const today = date(now);
  const yesterday = date(now - 24 * 60 * 60 * 1000);
  const days: { label: string; entries: ActivityEntryDto[] }[] = [];
  for (const item of items) {
    const day = date(item.occurredAt);
    const label = day === today ? t('today') : day === yesterday ? t('yesterday') : day;
    const last = days.at(-1);
    if (last?.label === label) last.entries.push(item);
    else days.push({ label, entries: [item] });
  }
  return (
    <div className="flex flex-col gap-6">
      {days.map((day) => (
        <section key={day.label} className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-muted-foreground">{day.label}</h2>
          <ol className="flex flex-col gap-2">
            {day.entries.map((entry) => {
              const Icon = GROUP_ICONS[entry.group];
              return (
                <li key={entry.id} className="flex gap-3 rounded-xl border border-border p-4">
                  <Icon aria-hidden className="mt-1 size-5 shrink-0 text-muted-foreground" />
                  <div className="flex flex-1 flex-col gap-1">
                    <span>
                      <span className="sr-only">
                        {t('groupLabel', { group: t(`group.${entry.group}`) })}
                      </span>
                      {sentence(entry)}
                      {entry.actorFormer ? ` ${t('formerUser')}` : ''}
                    </span>
                    <time
                      className="text-sm text-muted-foreground"
                      dateTime={new Date(entry.occurredAt).toISOString()}
                    >
                      {dateTime(entry.occurredAt)}
                    </time>
                    <Changes entry={entry} />
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}

function Changes({ entry }: { entry: ActivityEntryDto }) {
  const t = useTranslations('timeline');
  const fields = useTranslations('timeline.fields');
  if (!entry.changes || entry.action === 'project.created') return null;
  const keys = Object.keys(entry.changes.after).filter(
    (key) => key !== 'note' || entry.changes?.after.note,
  );
  if (keys.length === 0) return null;
  const show = (value: unknown) =>
    value === null || value === undefined || value === ''
      ? '—'
      : value === ACTIVITY_LONG_VALUE
        ? t('longValue')
        : ltr(
            typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
              ? String(value)
              : JSON.stringify(value),
          );
  return (
    <details className="text-sm">
      <summary className="min-h-10 cursor-pointer font-medium text-primary">
        {t('showChanges')}
      </summary>
      <dl className="mt-2 flex flex-col gap-1">
        {keys.map((key) => (
          <div key={key} className="flex flex-wrap gap-1">
            <dt className="text-muted-foreground">
              {t('fieldLabel', { field: fields.has(key) ? fields(key as 'name') : key })}
            </dt>
            <dd>
              {t('change', {
                before: show(entry.changes?.before[key]),
                after: show(entry.changes?.after[key]),
              })}
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
