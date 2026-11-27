'use client';

import {
  Building2,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  Grid3x3,
  Megaphone,
  ShieldAlert,
  CreditCard,
  FolderKanban,
  HardHat,
  ListChecks,
  KeyRound,
  MonitorSmartphone,
  Receipt,
  ShieldCheck,
  SlidersHorizontal,
  UserRound,
  Users,
} from 'lucide-react';
import type { SwitcherProjectDto } from '@hse/shared';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { Card } from '@/components/ui/card';
import { useAuth } from '@/modules/auth/auth-provider';
import { hasPermission } from '@/modules/auth/require-permission';
import { isSystemOwner } from '@/modules/platform/require-system-owner';
import { projectContextService } from '@/modules/projects/structure.service';
import { useCompany } from '@/modules/tenant/tenant-provider';

/** Placeholder home until the dashboard (US-064): account and company administration links. */
export function HomeScreen() {
  const t = useTranslations();
  const { user } = useAuth();
  const company = useCompany();
  const platformLinks =
    !company && isSystemOwner(user)
      ? [
          {
            href: '/platform/registrations',
            label: t('home.registrations'),
            Icon: ClipboardCheck,
          },
          { href: '/platform/payments', label: t('home.payments'), Icon: Receipt },
          {
            href: '/platform/subscriptions',
            label: t('home.subscriptions'),
            Icon: CreditCard,
          },
        ]
      : [];

  // PLT-08: the menu follows the permissions the server reported; the API checks again.
  const adminLinks = company
    ? [
        { permission: 'users.view', href: '/settings/users', label: t('home.users'), Icon: Users },
        {
          permission: 'roles.view',
          href: '/settings/roles',
          label: t('home.roles'),
          Icon: ShieldCheck,
        },
        {
          permission: 'company.edit',
          href: '/settings/company',
          label: t('home.companyProfile'),
          Icon: Building2,
        },
        {
          permission: 'company.settings.edit',
          href: '/settings/preferences',
          label: t('home.preferences'),
          Icon: SlidersHorizontal,
        },
        {
          permission: 'workforce.lists.manage',
          href: '/settings/workforce-lists',
          label: t('home.workforceLists'),
          Icon: ListChecks,
        },
        {
          permission: 'inspections.templates.manage',
          href: '/settings/inspection-templates',
          label: t('home.inspectionTemplates'),
          Icon: ClipboardList,
        },
        {
          permission: 'safety_events.settings.manage',
          href: '/settings/safety-events',
          label: t('home.safetySettings'),
          Icon: ShieldAlert,
        },
        {
          permission: 'risk.matrix.manage',
          href: '/settings/risk-matrix',
          label: t('home.riskMatrix'),
          Icon: Grid3x3,
        },
        {
          permission: 'subscription.view',
          href: '/settings/subscription',
          label: t('home.subscription'),
          Icon: CreditCard,
        },
      ].filter((link) => hasPermission(user, link.permission))
    : [];

  // Sprint 5: every company user has a projects list (filtered by the API, PLT-16).
  const workLinks = company
    ? [
        { href: '/projects', label: t('home.projects'), Icon: FolderKanban },
        // Sprint 10 (US-033): works offline too.
        { href: '/inspections', label: t('home.myInspections'), Icon: ClipboardCheck },
        // Sprint 11 (PLT-33): report in one tap; works offline too.
        { href: '/safety-events/report', label: t('home.report'), Icon: Megaphone },
        { href: '/safety-events', label: t('home.myReports'), Icon: ShieldAlert },
        ...(hasPermission(user, 'workforce.view')
          ? [{ href: '/workforce', label: t('home.workforce'), Icon: HardHat }]
          : []),
      ]
    : [];

  const links = [
    { href: '/profile', label: t('userMenu.profile'), Icon: UserRound },
    ...(company && hasPermission(user, 'company.view')
      ? [{ href: '/company', label: t('userMenu.company'), Icon: Building2 }]
      : []),
    ...(company && user?.workforceMemberId
      ? [{ href: '/me/workforce', label: t('userMenu.myWorkforce'), Icon: HardHat }]
      : []),
    { href: '/profile/change-password', label: t('userMenu.changePassword'), Icon: KeyRound },
    { href: '/profile/sessions', label: t('userMenu.sessions'), Icon: MonitorSmartphone },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">
          {t('home.welcome', { name: user?.fullName ?? '' })}
        </h1>
        <p className="text-muted-foreground">{t('home.intro')}</p>
      </div>
      {platformLinks.length > 0 ? (
        <LinkCard title={t('home.platformTitle')} items={platformLinks} />
      ) : null}
      {company ? <ContinueInProject /> : null}
      {workLinks.length > 0 ? <LinkCard title={t('home.workTitle')} items={workLinks} /> : null}
      {adminLinks.length > 0 ? <LinkCard title={t('home.adminTitle')} items={adminLinks} /> : null}
      <LinkCard title={t('home.accountTitle')} items={links} />
    </div>
  );
}

/** PLT-19 FR-4: back to the last project opened, while it is viewable and not archived. */
function ContinueInProject() {
  const t = useTranslations('home');
  const [last, setLast] = useState<SwitcherProjectDto | null>(null);
  useEffect(() => {
    projectContextService.switcher().then(
      (result) => {
        setLast(result.items.find((item) => item.id === result.lastProjectId) ?? null);
      },
      () => undefined,
    );
  }, []);
  if (!last) return null;
  return (
    <Link
      href={`/projects/${last.id}`}
      className="flex min-h-14 items-center gap-3 rounded-xl border border-primary bg-background px-4 font-medium text-primary hover:bg-muted"
    >
      <FolderKanban aria-hidden className="size-5" />
      <span className="flex-1">
        {t('continueIn')}{' '}
        <bdi dir="ltr" className="font-mono">
          {last.code}
        </bdi>{' '}
        · <bdi>{last.name}</bdi>
      </span>
      <ChevronRight aria-hidden className="size-5 rtl:-scale-x-100" />
    </Link>
  );
}

function LinkCard({
  title,
  items,
}: {
  title: string;
  items: { href: string; label: string; Icon: typeof KeyRound }[];
}) {
  return (
    <Card className="p-2">
      <h2 className="px-3 pb-1 pt-2 text-sm font-semibold text-muted-foreground">{title}</h2>
      <ul>
        {items.map(({ href, label, Icon }) => (
          <li key={href}>
            <Link
              href={href}
              className="flex min-h-14 items-center gap-3 rounded-lg px-3 hover:bg-muted"
            >
              <Icon aria-hidden className="size-5 text-muted-foreground" />
              <span className="flex-1">{label}</span>
              <ChevronRight aria-hidden className="size-5 text-muted-foreground rtl:-scale-x-100" />
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
