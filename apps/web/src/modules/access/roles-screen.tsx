'use client';

import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useLoad } from '@/modules/app/use-load';
import { useErrorMessage } from '@/modules/i18n/use-error-message';

import { accessService } from './access.service';

const loadRoles = () => accessService.roles();

/** Settings → Roles & permissions (US-009 FR-1): the 13 company roles. */
export function RolesScreen() {
  const t = useTranslations('rolesAdmin');
  const troles = useTranslations('roles');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const roles = useLoad(loadRoles, 'roles');

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-muted-foreground">{t('intro')}</p>
      </div>
      {roles.status === 'loading' ? (
        <div className="flex items-center gap-3" role="status">
          <Spinner />
          {tc('loading')}
        </div>
      ) : null}
      {roles.status === 'error' ? (
        <div className="flex flex-col items-start gap-3">
          <Alert tone="danger">{errorMessage(roles.error)}</Alert>
          <Button variant="secondary" onClick={roles.reload}>
            {tc('retry')}
          </Button>
        </div>
      ) : null}
      {roles.status === 'ready' ? (
        <ul className="flex flex-col gap-3">
          {roles.value.map((role) => (
            <li key={role.code}>
              <Link
                href={`/settings/roles/${role.code}`}
                className="flex items-center gap-3 rounded-xl border border-border bg-background p-4 shadow-sm hover:bg-muted"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{troles(role.code as 'worker')}</span>
                    {role.companyWide ? (
                      <span className="rounded-full bg-info-surface px-2 py-0.5 text-xs font-medium text-info-foreground">
                        {t('companyWide')}
                      </span>
                    ) : null}
                    {role.customised ? (
                      <span className="rounded-full bg-warning-surface px-2 py-0.5 text-xs font-medium text-warning-foreground">
                        {t('customised')}
                      </span>
                    ) : null}
                  </div>
                  <span className="text-sm text-muted-foreground">
                    {troles(`${role.code}Description` as 'workerDescription')}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {t('userCount', { count: role.userCount })}
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
      ) : null}
    </div>
  );
}
