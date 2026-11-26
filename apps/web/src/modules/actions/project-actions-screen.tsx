'use client';

import {
  ACTION_PRIORITIES,
  ACTION_TYPES,
  type ActionPageDto,
  type ActionSummaryDto,
} from '@hse/shared';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { useLoad } from '@/modules/app/use-load';
import { useReadOnly } from '@/modules/billing/use-subscription-state';
import { useErrorMessage } from '@/modules/i18n/use-error-message';
import { useCurrentProject } from '@/modules/projects/project-context';
import { cn } from '@/utils/cn';

import { ActionCard } from './action-ui';
import { type ActionListFilters, actionsService } from './actions.service';

/** Count chips that are also quick filters (PLT-24). */
const CHIPS = {
  open: { status: ['open', 'in_progress'] },
  overdue: { due: ['overdue'] },
  dueToday: { due: ['due_today'] },
  toVerify: { status: ['completed'] },
  closed: { status: ['closed'] },
} as const satisfies Record<keyof ActionSummaryDto, ActionListFilters>;
type Chip = keyof typeof CHIPS;

function csv(value: string | null): string[] {
  return value ? value.split(',').filter(Boolean) : [];
}

/** PLT-24: the project's Actions tab. Filters live in the URL, so a link keeps them. */
export function ProjectActionsScreen() {
  const t = useTranslations('actions');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const readOnly = useReadOnly();
  const { project } = useCurrentProject();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [search, setSearch] = useState(params.get('search') ?? '');
  const [pages, setPages] = useState<ActionPageDto[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);

  const filters: ActionListFilters = {
    status: csv(params.get('status')),
    due: csv(params.get('due')),
    priority: csv(params.get('priority')),
    type: csv(params.get('type')),
    noAccess: params.get('noAccess') === 'true',
    voided: params.get('voided') === 'true',
    search: params.get('search') ?? '',
  };
  const key = params.toString();

  const setParams = useCallback(
    (changes: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [name, value] of Object.entries(changes)) {
        if (value) next.set(name, value);
        else next.delete(name);
      }
      setPages([]);
      router.replace(`${pathname}${next.size > 0 ? `?${next.toString()}` : ''}`);
    },
    [params, pathname, router],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if ((params.get('search') ?? '') !== search.trim()) setParams({ search: search.trim() || null });
    }, 300);
    return () => {
      window.clearTimeout(timer);
    };
  }, [search, params, setParams]);

  const loaded = useLoad(
    useCallback(
      () =>
        Promise.all([
          actionsService.list(project.id, filters),
          actionsService.summary(project.id),
        ]),
      // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` covers the filters
      [project.id, key],
    ),
    `${project.id}?${key}`,
  );
  const first = loaded.status === 'ready' ? loaded.value[0] : null;
  const summary = loaded.status === 'ready' ? loaded.value[1] : null;
  const items = first ? [first, ...pages].flatMap((page) => page.items) : [];
  const nextCursor = (pages.at(-1) ?? first)?.nextCursor ?? null;

  const loadMore = () => {
    if (nextCursor === null) return;
    setLoadingMore(true);
    actionsService
      .list(project.id, { ...filters, cursor: nextCursor })
      .then((page) => {
        setPages((current) => [...current, page]);
      }, () => undefined)
      .finally(() => {
        setLoadingMore(false);
      });
  };

  const activeChip = (Object.keys(CHIPS) as Chip[]).find((chip) => {
    const chipFilter: ActionListFilters = CHIPS[chip];
    return (
      (chipFilter.status ?? []).join(',') === (filters.status ?? []).join(',') &&
      (chipFilter.due ?? []).join(',') === (filters.due ?? []).join(',')
    );
  });
  const canCreate =
    !readOnly &&
    project.acceptsRecords &&
    project.myPermissions.includes('projects.actions.create');

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-1 flex-col gap-2 sm:max-w-sm">
          <label htmlFor="action-search" className="text-sm font-medium">
            {t('search')}
          </label>
          <Input
            id="action-search"
            type="search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
            }}
          />
        </div>
        {canCreate ? (
          <Link
            href={`/projects/${project.id}/actions/new`}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-primary px-5 font-medium text-white hover:bg-primary/90"
          >
            <Plus aria-hidden className="size-5" />
            {t('new')}
          </Link>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label={t('show')}>
        {(Object.keys(CHIPS) as Chip[]).map((chip) => {
          const pressed = activeChip === chip;
          return (
            <button
              key={chip}
              type="button"
              aria-pressed={pressed}
              onClick={() => {
                const chipFilter: ActionListFilters = CHIPS[chip];
                setParams(
                  pressed
                    ? { status: null, due: null }
                    : {
                        status: chipFilter.status?.join(',') ?? null,
                        due: chipFilter.due?.join(',') ?? null,
                      },
                );
              }}
              className={cn(
                'inline-flex min-h-10 items-center gap-2 rounded-full border px-4 text-sm font-medium',
                pressed ? 'border-primary bg-primary text-white' : 'border-border hover:bg-muted',
              )}
            >
              {t(`chips.${chip}`)}
              {summary ? (
                <span className="rounded-full bg-background/20 px-1.5 tabular-nums">
                  {summary[chip]}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <details className="rounded-xl border border-border p-4">
        <summary className="cursor-pointer font-medium">{t('filters')}</summary>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <label htmlFor="action-priority" className="text-sm font-medium">
              {t('fields.priority')}
            </label>
            <Select
              id="action-priority"
              value={filters.priority?.[0] ?? ''}
              onChange={(event) => {
                setParams({ priority: event.target.value || null });
              }}
            >
              <option value="">{t('any')}</option>
              {ACTION_PRIORITIES.map((value) => (
                <option key={value} value={value}>
                  {t(`priority.${value}`)}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <label htmlFor="action-type" className="text-sm font-medium">
              {t('fields.type')}
            </label>
            <Select
              id="action-type"
              value={filters.type?.[0] ?? ''}
              onChange={(event) => {
                setParams({ type: event.target.value || null });
              }}
            >
              <option value="">{t('any')}</option>
              {ACTION_TYPES.map((value) => (
                <option key={value} value={value}>
                  {t(`type.${value}`)}
                </option>
              ))}
            </Select>
          </div>
          <Checkbox
            id="action-no-access"
            label={t('filterNoAccess')}
            checked={filters.noAccess ?? false}
            onChange={(event) => {
              setParams({ noAccess: event.target.checked ? 'true' : null });
            }}
          />
          <Checkbox
            id="action-voided"
            label={t('filterVoided')}
            checked={filters.voided ?? false}
            onChange={(event) => {
              setParams({ voided: event.target.checked ? 'true' : null });
            }}
          />
        </div>
      </details>

      {!project.acceptsRecords && project.myPermissions.includes('projects.actions.create') ? (
        <Alert tone="info">{t('notAccepting')}</Alert>
      ) : null}

      {loaded.status === 'error' ? (
        <Alert tone="danger">{errorMessage(loaded.error)}</Alert>
      ) : !first ? (
        <div className="flex items-center gap-3" role="status">
          <Spinner />
          {tc('loading')}
        </div>
      ) : items.length === 0 ? (
        <p className="text-muted-foreground">{t('empty')}</p>
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {items.map((item) => (
              <ActionCard key={item.id} item={item} />
            ))}
          </ul>
          {nextCursor !== null ? (
            <Button variant="secondary" onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? <Spinner /> : null}
              {t('loadMore')}
            </Button>
          ) : null}
        </>
      )}
    </div>
  );
}
