'use client';

import type { UserListItemDto, UserListStatus } from '@hse/shared';
import { Mail, Search, UserPlus, X } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { useDateFormat } from '@/modules/i18n/use-date-format';
import { useErrorMessage } from '@/modules/i18n/use-error-message';
import { cn } from '@/utils/cn';

import { useLoad } from '@/modules/app/use-load';
import { useReadOnly } from '@/modules/billing/use-subscription-state';
import { companyService } from '@/modules/company-admin/company.service';

import { InviteUserDialog } from './invite-user-dialog';
import { usersService } from './users.service';

const STATUS_STYLES: Record<UserListStatus, string> = {
  active: 'bg-success-surface text-success-foreground',
  invitation_pending: 'bg-info-surface text-info-foreground',
  invitation_expired: 'bg-warning-surface text-warning-foreground',
  suspended: 'bg-danger-surface text-danger-foreground',
  locked: 'bg-danger-surface text-danger-foreground',
};

type ListState =
  | { status: 'loading' }
  | { status: 'error'; error: unknown }
  | { status: 'ready'; items: UserListItemDto[]; total: number; totalPages: number };

/** Seats used and the plan limit, from the account summary (PLT-12 UI). */
const loadSeats = async () => {
  const info = await companyService.information();
  return info.account ? info.account.users : null;
};

/** Settings → Users (US-006): the company's users, invitations, resend and cancel. */
export function UsersScreen() {
  const t = useTranslations('users');
  const tc = useTranslations('common');
  const troles = useTranslations('roles');
  const errorMessage = useErrorMessage();
  const { date } = useDateFormat();
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [cancelTarget, setCancelTarget] = useState<UserListItemDto | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // PLT-11 FR-7 and PLT-12: no invitations in read-only mode or at the plan's user limit.
  const readOnly = useReadOnly();
  const seats = useLoad(loadSeats, 'seats');
  const seatInfo = seats.status === 'ready' ? seats.value : null;
  const atLimit = seatInfo !== null && seatInfo.limit !== null && seatInfo.used >= seatInfo.limit;

  const fetchPage = useCallback(() => usersService.list(query, page), [query, page]);
  const list = useLoad(fetchPage, `${query}:${String(page)}`);
  const load = list.reload;
  const state: ListState =
    list.status === 'ready'
      ? {
          status: 'ready',
          items: list.value.items,
          total: list.value.meta?.total ?? list.value.items.length,
          totalPages: list.value.meta?.totalPages ?? 1,
        }
      : list.status === 'error'
        ? { status: 'error', error: list.error }
        : { status: 'loading' };

  // Search as the user types, after a short pause.
  useEffect(() => {
    const timer = setTimeout(() => {
      setPage(1);
      setQuery(search);
    }, 300);
    return () => {
      clearTimeout(timer);
    };
  }, [search]);

  const resend = async (user: UserListItemDto) => {
    setBusyId(user.id);
    setNotice(null);
    try {
      await usersService.resend(user.id);
      setNotice({ tone: 'success', text: t('resent', { email: user.email }) });
      load();
      seats.reload();
    } catch (error) {
      setNotice({ tone: 'danger', text: errorMessage(error) });
    } finally {
      setBusyId(null);
    }
  };

  const cancel = async (user: UserListItemDto) => {
    setCancelTarget(null);
    setBusyId(user.id);
    setNotice(null);
    try {
      await usersService.cancel(user.id);
      setNotice({ tone: 'success', text: t('cancelled', { email: user.email }) });
      load();
      seats.reload();
    } catch (error) {
      setNotice({ tone: 'danger', text: errorMessage(error) });
    } finally {
      setBusyId(null);
    }
  };

  const roleNames = (user: UserListItemDto) =>
    user.roleCodes.map((code) => troles(code as 'worker')).join(', ');

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">{t('title')}</h1>
          <p className="text-muted-foreground">{t('intro')}</p>
        </div>
        <div className="flex flex-col gap-1 sm:items-end">
          <Button
            disabled={readOnly || atLimit}
            aria-describedby={readOnly || atLimit ? 'invite-blocked' : undefined}
            onClick={() => {
              setInviteOpen(true);
            }}
          >
            <UserPlus aria-hidden className="size-5" />
            {t('invite')}
          </Button>
          {seatInfo ? (
            <span className="text-sm text-muted-foreground">
              {seatInfo.limit === null
                ? t('seatsUnlimited', { used: seatInfo.used })
                : t('seatsOf', { used: seatInfo.used, limit: seatInfo.limit })}
            </span>
          ) : null}
        </div>
      </div>

      {readOnly || atLimit ? (
        <p id="invite-blocked" className="text-sm text-muted-foreground">
          {readOnly ? t('readOnlyHint') : t('limitReached')}
        </p>
      ) : null}

      {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}

      <div className="relative max-w-md">
        <label htmlFor="user-search" className="sr-only">
          {t('search')}
        </label>
        <Search
          aria-hidden
          className="pointer-events-none absolute inset-y-0 start-3 my-auto size-5 text-muted-foreground"
        />
        <Input
          id="user-search"
          type="search"
          className="ps-11"
          placeholder={t('search')}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
          }}
        />
      </div>

      {state.status === 'loading' ? (
        <div className="flex items-center gap-3" role="status">
          <Spinner />
          {tc('loading')}
        </div>
      ) : null}

      {state.status === 'error' ? (
        <div className="flex flex-col items-start gap-3">
          <Alert tone="danger">{errorMessage(state.error)}</Alert>
          <Button variant="secondary" onClick={load}>
            {tc('retry')}
          </Button>
        </div>
      ) : null}

      {state.status === 'ready' && state.items.length === 0 ? (
        <Card>
          <p className="text-muted-foreground">{query ? t('noResults') : t('empty')}</p>
        </Card>
      ) : null}

      {state.status === 'ready' && state.items.length > 0 ? (
        <>
          <p className="text-sm text-muted-foreground">{t('count', { count: state.total })}</p>
          <ul className="flex flex-col gap-3">
            {state.items.map((user) => {
              const pending =
                user.status === 'invitation_pending' || user.status === 'invitation_expired';
              return (
                <li key={user.id}>
                  <Card className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={`/settings/users/${user.id}`}
                          className="font-semibold text-primary underline-offset-4 hover:underline"
                        >
                          <bdi>{user.fullName}</bdi>
                        </Link>
                        <span
                          className={cn(
                            'rounded-full px-2 py-0.5 text-xs font-medium',
                            STATUS_STYLES[user.status],
                          )}
                        >
                          {t(`status.${user.status}`)}
                        </span>
                      </div>
                      <bdi dir="ltr" className="truncate text-start text-sm text-muted-foreground">
                        {user.email}
                      </bdi>
                      <span className="text-sm text-muted-foreground">
                        {roleNames(user)}
                        {user.projectCount > 0
                          ? ` · ${t('projectCount', { count: user.projectCount })}`
                          : null}
                      </span>
                      {pending ? (
                        <span className="text-sm text-muted-foreground">
                          {user.status === 'invitation_expired'
                            ? t('expiredOn', { date: date(user.invitationExpiresAt) })
                            : t('sentOn', {
                                sent: date(user.invitationSentAt),
                                expires: date(user.invitationExpiresAt),
                              })}
                        </span>
                      ) : (
                        <span className="text-sm text-muted-foreground">
                          {t('lastSignIn', { date: date(user.lastLoginAt) })}
                        </span>
                      )}
                    </div>
                    {pending ? (
                      <div className="flex gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={readOnly || busyId === user.id}
                          onClick={() => void resend(user)}
                        >
                          <Mail aria-hidden className="size-4" />
                          {t('resend')}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={readOnly || busyId === user.id}
                          onClick={() => {
                            setCancelTarget(user);
                          }}
                        >
                          <X aria-hidden className="size-4" />
                          {t('cancelInvitation')}
                        </Button>
                      </div>
                    ) : null}
                  </Card>
                </li>
              );
            })}
          </ul>
          {state.totalPages > 1 ? (
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
                {t('pageOf', { page, total: state.totalPages })}
              </span>
              <Button
                variant="secondary"
                size="sm"
                disabled={page >= state.totalPages}
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

      <InviteUserDialog
        open={inviteOpen}
        onClose={() => {
          setInviteOpen(false);
        }}
        onInvited={(user) => {
          setInviteOpen(false);
          setNotice({ tone: 'success', text: t('invited', { email: user.email }) });
          load();
          seats.reload();
        }}
      />

      <ConfirmDialog
        open={cancelTarget !== null}
        title={t('cancelTitle')}
        body={t('cancelBody', { email: cancelTarget?.email ?? '' })}
        confirmLabel={t('cancelConfirm')}
        cancelLabel={tc('cancel')}
        tone="danger"
        onConfirm={() => {
          if (cancelTarget) void cancel(cancelTarget);
        }}
        onCancel={() => {
          setCancelTarget(null);
        }}
      />
    </div>
  );
}
