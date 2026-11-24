'use client';

import { PROJECT_STATUSES, type ProjectStatus } from '@hse/shared';
import { ChevronRight, FolderPlus, Search } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { useLoad } from '@/modules/app/use-load';
import { useAuth } from '@/modules/auth/auth-provider';
import { hasPermission } from '@/modules/auth/require-permission';
import { useReadOnly } from '@/modules/billing/use-subscription-state';
import { companyService } from '@/modules/company-admin/company.service';
import { useDateFormat } from '@/modules/i18n/use-date-format';
import { useErrorMessage } from '@/modules/i18n/use-error-message';

import { ProjectFormDialog } from './project-form-dialog';
import { ProjectStatusBadge } from './project-status-badge';
import { projectsService } from './projects.service';

type Filter = 'current' | ProjectStatus;

/** Project usage and limit from the account summary (PLT-12, O-52), administrators only. */
const loadUsage = async () => {
  const info = await companyService.information();
  return info.account ? info.account.projects : null;
};

/** Projects (US-016): the projects the user can see, search, status filter, New project. */
export function ProjectsScreen() {
  const t = useTranslations('projects');
  const ts = useTranslations('projectStatus');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const router = useRouter();
  const { user } = useAuth();
  const { calendarDate } = useDateFormat();
  const readOnly = useReadOnly();
  const canCreate = hasPermission(user, 'projects.create');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('current');
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);

  const usage = useLoad(
    useCallback(() => (canCreate ? loadUsage() : Promise.resolve(null)), [canCreate]),
    `usage:${String(canCreate)}`,
  );
  const usageInfo = usage.status === 'ready' ? usage.value : null;
  const atLimit =
    usageInfo !== null && usageInfo.limit !== null && usageInfo.used >= usageInfo.limit;

  const fetchPage = useCallback(
    () => projectsService.list(query, filter === 'current' ? [] : [filter], page),
    [query, filter, page],
  );
  const list = useLoad(fetchPage, `${query}:${filter}:${String(page)}`);

  useEffect(() => {
    const timer = setTimeout(() => {
      setPage(1);
      setQuery(search);
    }, 300);
    return () => {
      clearTimeout(timer);
    };
  }, [search]);

  const blockedReason = readOnly
    ? t('readOnlyHint')
    : atLimit
      ? t('limitReached', { limit: usageInfo.limit ?? 0 })
      : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">{t('title')}</h1>
          <p className="text-muted-foreground">{t('intro')}</p>
        </div>
        {canCreate ? (
          <div className="flex flex-col gap-1 sm:items-end">
            <Button
              disabled={blockedReason !== null}
              aria-describedby={blockedReason ? 'project-blocked' : undefined}
              onClick={() => {
                setFormOpen(true);
              }}
            >
              <FolderPlus aria-hidden className="size-5" />
              {t('new')}
            </Button>
            {usageInfo ? (
              <span className="text-sm text-muted-foreground">
                {usageInfo.limit === null
                  ? t('usageUnlimited', { used: usageInfo.used })
                  : t('usageOf', { used: usageInfo.used, limit: usageInfo.limit })}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      {canCreate && blockedReason ? (
        <p id="project-blocked" className="text-sm text-muted-foreground">
          {blockedReason}{' '}
          {atLimit && !readOnly ? (
            <Link href="/settings/subscription" className="font-medium text-primary underline">
              {t('upgrade')}
            </Link>
          ) : null}
        </p>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <label htmlFor="project-search" className="sr-only">
            {t('search')}
          </label>
          <Search
            aria-hidden
            className="pointer-events-none absolute inset-y-0 start-3 my-auto size-5 text-muted-foreground"
          />
          <Input
            id="project-search"
            type="search"
            className="ps-11"
            placeholder={t('search')}
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
            }}
          />
        </div>
        <div className="sm:w-56">
          <label htmlFor="project-filter" className="sr-only">
            {t('statusFilter')}
          </label>
          <Select
            id="project-filter"
            value={filter}
            onChange={(event) => {
              setPage(1);
              setFilter(event.target.value as Filter);
            }}
          >
            <option value="current">{t('filterCurrent')}</option>
            {PROJECT_STATUSES.map((status) => (
              <option key={status} value={status}>
                {ts(status)}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {list.status === 'loading' ? (
        <div className="flex items-center gap-3" role="status">
          <Spinner />
          {tc('loading')}
        </div>
      ) : null}

      {list.status === 'error' ? (
        <div className="flex flex-col items-start gap-3">
          <Alert tone="danger">{errorMessage(list.error)}</Alert>
          <Button variant="secondary" onClick={list.reload}>
            {tc('retry')}
          </Button>
        </div>
      ) : null}

      {list.status === 'ready' && list.value.items.length === 0 ? (
        <Card>
          <p className="text-muted-foreground">
            {query || filter !== 'current'
              ? t('noResults')
              : canCreate
                ? t('emptyCreator')
                : t('emptyMember')}
          </p>
        </Card>
      ) : null}

      {list.status === 'ready' && list.value.items.length > 0 ? (
        <>
          <p className="text-sm text-muted-foreground">
            {t('count', { count: list.value.meta?.total ?? list.value.items.length })}
          </p>
          <ul className="flex flex-col gap-3">
            {list.value.items.map((project) => (
              <li key={project.id}>
                <Link
                  href={`/projects/${project.id}`}
                  className="flex items-center gap-3 rounded-xl border border-border bg-background p-4 shadow-sm hover:bg-muted"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <bdi dir="ltr" className="font-mono text-sm text-muted-foreground">
                        {project.code}
                      </bdi>
                      <ProjectStatusBadge status={project.status} />
                    </div>
                    <span className="font-semibold">
                      <bdi>{project.name}</bdi>
                    </span>
                    <span className="text-sm text-muted-foreground">
                      <bdi>{project.clientName}</bdi>
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {t('dates', {
                        start: calendarDate(project.startDate),
                        end: calendarDate(project.expectedEndDate),
                      })}
                    </span>
                  </div>
                  <ChevronRight
                    aria-hidden
                    className="size-5 shrink-0 text-muted-foreground rtl:-scale-x-100"
                  />
                </Link>
              </li>
            ))}
          </ul>
          {(list.value.meta?.totalPages ?? 1) > 1 ? (
            <nav aria-label={t('pages')} className="flex items-center gap-3">
              <Button
                variant="secondary"
                size="sm"
                disabled={page <= 1}
                onClick={() => {
                  setPage((current) => current - 1);
                }}
              >
                {t('previous')}
              </Button>
              <span className="text-sm text-muted-foreground">
                {t('pageOf', { page, total: list.value.meta?.totalPages ?? 1 })}
              </span>
              <Button
                variant="secondary"
                size="sm"
                disabled={page >= (list.value.meta?.totalPages ?? 1)}
                onClick={() => {
                  setPage((current) => current + 1);
                }}
              >
                {t('next')}
              </Button>
            </nav>
          ) : null}
        </>
      ) : null}

      <ProjectFormDialog
        open={formOpen}
        project={null}
        onClose={() => {
          setFormOpen(false);
        }}
        onSaved={(project) => {
          setFormOpen(false);
          router.push(`/projects/${project.id}`);
        }}
      />
    </div>
  );
}
