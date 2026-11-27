'use client';

import { HardHat } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { Brand } from '@/components/layout/brand';
import { UserMenu } from '@/modules/auth/user-menu';
import { SubscriptionBanner } from '@/modules/billing/subscription-banner';
import { LanguageSwitcher } from '@/modules/i18n/language-switcher';
import { useAuth } from '@/modules/auth/auth-provider';
import { hasPermission } from '@/modules/auth/require-permission';
import { MyActionsLink } from '@/modules/actions/my-actions-link';
import { NotificationBell } from '@/modules/notifications/notification-bell';
import { ConnectionIndicator } from '@/modules/offline/connection-indicator';
import { UpdateBanner } from '@/modules/offline/update-banner';
import { useSync } from '@/modules/offline/sync-provider';
import { ProjectSwitcher } from '@/modules/projects/project-switcher';
import { useCompany } from '@/modules/tenant/tenant-provider';

/**
 * Header for signed-in pages. The full navigation (Doc 05 §4) arrives with the dashboard;
 * Sprint 5 adds Projects on company subdomains; Sprint 6 the project switcher and the
 * notification bell (PLT-17, PLT-19); Sprint 7 the Workforce link (US-024); Sprint 8 My actions
 * with the overdue count (PLT-24); Sprint 9 the connection indicator and the update banner
 * (PLT-25, PLT-31).
 */
export function AppHeader() {
  const company = useCompany();
  const { user } = useAuth();
  const t = useTranslations('workforce');
  // Offline, only the indicator: the other header items need the API.
  const { online } = useSync();
  return (
    <header className="sticky top-0 z-10 border-b border-border bg-background">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-2 px-4 py-2">
        <Link href="/" className="rounded-lg">
          <Brand compact />
        </Link>
        <div className="flex items-center sm:gap-1">
          {company ? (
            <>
              <ConnectionIndicator />
              {online ? <ProjectSwitcher /> : null}
              {online && hasPermission(user, 'workforce.view') ? (
                <Link
                  href="/workforce"
                  className="inline-flex min-h-12 items-center gap-2 rounded-lg px-3 font-medium hover:bg-muted"
                >
                  <HardHat aria-hidden className="size-5" />
                  <span className="sr-only sm:not-sr-only">{t('title')}</span>
                </Link>
              ) : null}
              {online ? (
                <>
                  <MyActionsLink />
                  <NotificationBell />
                </>
              ) : null}
            </>
          ) : null}
          <LanguageSwitcher className="hidden sm:inline-flex" />
          <UserMenu />
        </div>
      </div>
      <div className="flex justify-center border-t border-border py-1 sm:hidden">
        <LanguageSwitcher />
      </div>
      <SubscriptionBanner />
      <UpdateBanner />
    </header>
  );
}
