'use client';

import { Building2, ChevronDown, HardHat, LogOut, UserRound } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState } from 'react';

import { Spinner } from '@/components/ui/spinner';

import { useCompany } from '@/modules/tenant/tenant-provider';

import { useAuth } from './auth-provider';
import { hasPermission } from './require-permission';

const ITEM_CLASS =
  'flex min-h-12 w-full items-center gap-3 rounded-md px-3 text-start text-foreground hover:bg-muted focus-visible:bg-muted';

/** Account menu: my profile (with password and sessions), company and sign out (US-004, US-007, US-015). */
export function UserMenu() {
  const t = useTranslations('userMenu');
  const { user, signOut } = useAuth();
  const company = useCompany();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const menuId = useId();
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (
        event instanceof KeyboardEvent
          ? event.key === 'Escape'
          : !container.current?.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  if (!user) return null;

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      router.replace('/login');
    }
  };

  return (
    <div ref={container} className="relative">
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={t('open', { name: user.fullName })}
        onClick={() => {
          setOpen((current) => !current);
        }}
        className="flex min-h-12 items-center gap-2 rounded-lg px-3 hover:bg-muted"
      >
        <span
          aria-hidden
          className="flex size-8 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground"
        >
          {user.fullName.trim().charAt(0).toUpperCase()}
        </span>
        <bdi className="hidden max-w-40 truncate sm:inline">{user.fullName}</bdi>
        <ChevronDown aria-hidden className="size-4" />
      </button>

      {open ? (
        <div
          id={menuId}
          className="absolute end-0 z-20 mt-2 w-64 rounded-xl border border-border bg-background p-2 shadow-lg"
        >
          <Link
            href="/profile"
            className={ITEM_CLASS}
            onClick={() => {
              setOpen(false);
            }}
          >
            <UserRound aria-hidden className="size-5" />
            {t('profile')}
          </Link>
          {company && user.workforceMemberId ? (
            <Link
              href="/me/workforce"
              className={ITEM_CLASS}
              onClick={() => {
                setOpen(false);
              }}
            >
              <HardHat aria-hidden className="size-5" />
              {t('myWorkforce')}
            </Link>
          ) : null}
          {company && hasPermission(user, 'company.view') ? (
            <Link
              href="/company"
              className={ITEM_CLASS}
              onClick={() => {
                setOpen(false);
              }}
            >
              <Building2 aria-hidden className="size-5" />
              {t('company')}
            </Link>
          ) : null}
          <button
            type="button"
            className={ITEM_CLASS}
            disabled={signingOut}
            onClick={() => void handleSignOut()}
          >
            {signingOut ? <Spinner /> : <LogOut aria-hidden className="size-5 rtl:-scale-x-100" />}
            {signingOut ? t('signingOut') : t('signOut')}
          </button>
        </div>
      ) : null}
    </div>
  );
}
