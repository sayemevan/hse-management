'use client';

import {
  WORKFORCE_CATEGORIES,
  WORKFORCE_STATUSES,
  type WorkforcePageDto,
  type WorkforceRowDto,
} from '@hse/shared';
import { UserPlus } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { useLoad } from '@/modules/app/use-load';
import { useAuth } from '@/modules/auth/auth-provider';
import { hasPermission } from '@/modules/auth/require-permission';
import { useReadOnly } from '@/modules/billing/use-subscription-state';
import { useErrorMessage } from '@/modules/i18n/use-error-message';
import { cn } from '@/utils/cn';

import { workforceService } from './workforce.service';
import {
  ComplianceBadge,
  PersonPhoto,
  StatusChip,
  usePersonName,
  usePositionName,
} from './workforce-ui';

/** US-024 FR-1 and PLT-20: the workforce directory. */
export function DirectoryScreen() {
  const t = useTranslations('workforce');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const { user } = useAuth();
  const readOnly = useReadOnly();
  const params = useSearchParams();
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [category, setCategory] = useState('');
  const [position, setPosition] = useState('');
  const [attention, setAttention] = useState(params.get('attention') === 'true');
  const [archived, setArchived] = useState(false);
  const [page, setPage] = useState(1);
  const positionName = usePositionName();

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 300);
    return () => {
      window.clearTimeout(timer);
    };
  }, [search]);

  const key = JSON.stringify({ query, status, category, position, attention, archived, page });
  const loaded = useLoad<WorkforcePageDto>(
    useCallback(
      () =>
        workforceService.list({
          search: query,
          status,
          category,
          position,
          attention,
          archived,
          page,
        }),
      [query, status, category, position, attention, archived, page],
    ),
    key,
  );
  const summary = useLoad(
    useCallback(() => workforceService.summary(), []),
    'summary',
  );
  const positions = useLoad(
    useCallback(() => workforceService.listItems('job_position', true), []),
    'positions',
  );
  const canManage = !readOnly && hasPermission(user, 'workforce.manage');
  const data = loaded.status === 'ready' ? loaded.value : null;
  const counts = summary.status === 'ready' ? summary.value : null;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  const tile = (
    label: string,
    value: number | undefined,
    active?: boolean,
    toggle?: () => void,
  ) => {
    const body = (
      <>
        <span className="text-2xl font-semibold">{value ?? '—'}</span>
        <span className="text-sm text-muted-foreground">{label}</span>
      </>
    );
    return toggle ? (
      <button
        type="button"
        aria-pressed={active}
        onClick={toggle}
        className={cn(
          'flex min-h-20 flex-col items-start justify-center rounded-xl border px-4 text-start',
          active ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted',
        )}
      >
        {body}
      </button>
    ) : (
      <div className="flex min-h-20 flex-col justify-center rounded-xl border border-border px-4">
        {body}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        {canManage ? (
          <Link href="/workforce/new" className={buttonVariants()}>
            <UserPlus aria-hidden className="size-5" />
            {t('addPerson')}
          </Link>
        ) : null}
      </div>

      <div className="grid grid-cols-3 gap-2">
        {tile(t('total'), counts?.total)}
        {tile(t('active'), counts?.active)}
        {tile(t('needsAttention'), counts?.needsAttention, attention, () => {
          setAttention(!attention);
          setPage(1);
        })}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col gap-2 sm:col-span-2 lg:col-span-1">
          <label htmlFor="workforce-search" className="text-sm font-medium">
            {t('search')}
          </label>
          <Input
            id="workforce-search"
            type="search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
            }}
          />
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="workforce-status" className="text-sm font-medium">
            {t('fields.status')}
          </label>
          <Select
            id="workforce-status"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
          >
            <option value="">{t('any')}</option>
            {WORKFORCE_STATUSES.map((value) => (
              <option key={value} value={value}>
                {t(`status.${value}`)}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="workforce-category" className="text-sm font-medium">
            {t('fields.category')}
          </label>
          <Select
            id="workforce-category"
            value={category}
            onChange={(event) => {
              setCategory(event.target.value);
              setPage(1);
            }}
          >
            <option value="">{t('any')}</option>
            {WORKFORCE_CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {t(`category.${value}`)}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="workforce-position" className="text-sm font-medium">
            {t('fields.jobPosition')}
          </label>
          <Select
            id="workforce-position"
            value={position}
            onChange={(event) => {
              setPosition(event.target.value);
              setPage(1);
            }}
          >
            <option value="">{t('any')}</option>
            {(positions.status === 'ready' ? positions.value : []).map((item) => (
              <option key={item.id} value={item.id}>
                {positionName(item)}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <Checkbox
        id="workforce-archived"
        label={t('showArchived')}
        checked={archived}
        onChange={(event) => {
          setArchived(event.target.checked);
          setPage(1);
        }}
      />

      {loaded.status === 'error' ? (
        <Alert tone="danger">{errorMessage(loaded.error)}</Alert>
      ) : !data ? (
        <div className="flex items-center gap-3" role="status">
          <Spinner />
          {tc('loading')}
        </div>
      ) : data.items.length === 0 ? (
        <p className="text-muted-foreground">{query || attention ? t('noMatch') : t('empty')}</p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {t('resultCount', { count: data.total })}
          </p>
          <ul className="flex flex-col gap-2">
            {data.items.map((row) => (
              <PersonCard key={row.id} row={row} />
            ))}
          </ul>
          {pages > 1 ? (
            <div className="flex items-center justify-between gap-2">
              <Button
                variant="secondary"
                disabled={page <= 1}
                onClick={() => {
                  setPage(page - 1);
                }}
              >
                {t('previous')}
              </Button>
              <span className="text-sm text-muted-foreground">{t('pageOf', { page, pages })}</span>
              <Button
                variant="secondary"
                disabled={page >= pages}
                onClick={() => {
                  setPage(page + 1);
                }}
              >
                {t('next')}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function PersonCard({ row }: { row: WorkforceRowDto }) {
  const t = useTranslations('workforce');
  const positionName = usePositionName();
  const personName = usePersonName();
  const name = personName(row);
  return (
    <li>
      <Link
        href={`/workforce/${row.id}`}
        className="flex items-start gap-3 rounded-xl border border-border p-4 hover:bg-muted"
      >
        <PersonPhoto url={row.photoUrl} name={name} />
        <div className="flex flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <bdi className="font-medium">{name}</bdi>
            {row.employeeId ? (
              <bdi dir="ltr" className="font-mono text-sm text-muted-foreground">
                {row.employeeId}
              </bdi>
            ) : null}
            <StatusChip status={row.status} />
            {row.archived ? (
              <span className="rounded-full bg-muted px-2 text-xs font-medium">
                {t('archivedChip')}
              </span>
            ) : null}
          </div>
          <span className="text-sm text-muted-foreground">
            {positionName(row.position)} · <bdi>{row.employer}</bdi> ·{' '}
            {t(`category.${row.category}`)}
          </span>
          {row.currentProjects.length > 0 ? (
            <span className="text-sm text-muted-foreground">
              {t('onProjects')}{' '}
              {row.currentProjects.map((project, index) => (
                <bdi key={project.id} dir="ltr" className="font-mono">
                  {index > 0 ? ', ' : ''}
                  {project.code}
                </bdi>
              ))}
            </span>
          ) : null}
          <ComplianceBadge compliance={row.compliance} />
        </div>
      </Link>
    </li>
  );
}
