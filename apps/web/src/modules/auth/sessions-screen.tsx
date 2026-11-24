'use client';

import type { SessionDto } from '@hse/shared';
import { LogOut, Monitor, Smartphone, Tablet } from 'lucide-react';
import { useFormatter, useNow, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Spinner } from '@/components/ui/spinner';
import { useErrorMessage } from '@/modules/i18n/use-error-message';
import { useCompany } from '@/modules/tenant/tenant-provider';

import { useAuth } from './auth-provider';
import { authService } from './auth.service';

const KNOWN_DEVICES = new Set([
  'iPad',
  'iPhone',
  'Android phone',
  'Android tablet',
  'Windows computer',
  'Mac',
  'Chromebook',
  'Linux computer',
  'Unknown device',
]);

function DeviceIcon({ label }: { label: string }) {
  const Icon = /phone|iPhone/i.test(label)
    ? Smartphone
    : /iPad|tablet/i.test(label)
      ? Tablet
      : Monitor;
  return <Icon aria-hidden className="size-6 shrink-0 text-muted-foreground" />;
}

/** Active sessions (US-010). */
export function SessionsScreen() {
  const t = useTranslations('sessions');
  const tc = useTranslations('common');
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const errorMessage = useErrorMessage();
  const { user } = useAuth();
  const company = useCompany();
  const timeZone = user?.timeZone ?? company?.timeZone;

  const [sessions, setSessions] = useState<SessionDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [exactTimeFor, setExactTimeFor] = useState<string | null>(null);

  const load = useCallback(
    () =>
      authService.listSessions().then(
        (list) => {
          setSessions(list);
          setError(null);
        },
        (loadError: unknown) => {
          setError(errorMessage(loadError));
        },
      ),
    [errorMessage],
  );

  useEffect(() => {
    const effect = { cancelled: false };
    authService.listSessions().then(
      (list) => {
        if (!effect.cancelled) setSessions(list);
      },
      (loadError: unknown) => {
        if (!effect.cancelled) setError(errorMessage(loadError));
      },
    );
    return () => {
      effect.cancelled = true;
    };
  }, [errorMessage]);

  const deviceName = (session: SessionDto) =>
    KNOWN_DEVICES.has(session.deviceLabel)
      ? t(`deviceLabels.${session.deviceLabel}` as 'deviceLabels.Mac')
      : session.deviceLabel;
  const browserName = (session: SessionDto) =>
    session.browser === 'Unknown browser' ? t('browsers.Unknown browser') : session.browser;

  const relative = (time: number) => format.relativeTime(time, now);
  const exact = (time: number) =>
    format.dateTime(time, {
      dateStyle: 'medium',
      timeStyle: 'short',
      ...(timeZone ? { timeZone } : {}),
    });

  const revoke = async (session: SessionDto) => {
    setBusyId(session.id);
    setNotice(null);
    try {
      await authService.revokeSession(session.id);
      setNotice(t('ended'));
      await load();
    } catch (revokeError) {
      setError(errorMessage(revokeError));
    } finally {
      setBusyId(null);
    }
  };

  const revokeOthers = async () => {
    setConfirming(false);
    setBusyId('others');
    setNotice(null);
    try {
      const count = await authService.revokeOtherSessions();
      setNotice(t('othersEnded', { count }));
      await load();
    } catch (revokeError) {
      setError(errorMessage(revokeError));
    } finally {
      setBusyId(null);
    }
  };

  const others = sessions?.filter((session) => !session.isCurrent) ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-muted-foreground">{t('intro')}</p>
      </div>

      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}

      {sessions === null && !error ? (
        <div className="flex items-center gap-3 text-muted-foreground">
          <Spinner />
          <span>{tc('loading')}</span>
        </div>
      ) : null}

      {sessions ? (
        <ul className="flex flex-col gap-3">
          {sessions.map((session) => (
            <li key={session.id}>
              <Card className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center">
                <div className="flex flex-1 items-start gap-3">
                  <DeviceIcon label={session.deviceLabel} />
                  <div className="flex flex-col gap-1">
                    <p className="font-medium">
                      {deviceName(session)}
                      <span className="text-muted-foreground">{' · '}</span>
                      {browserName(session)}
                      {session.isCurrent ? (
                        <span className="ms-2 inline-flex rounded-full bg-success-surface px-2 py-0.5 text-xs font-semibold text-success-foreground">
                          {t('thisDevice')}
                        </span>
                      ) : null}
                    </p>
                    <button
                      type="button"
                      className="text-start text-sm text-muted-foreground"
                      aria-expanded={exactTimeFor === session.id}
                      title={exact(session.lastActivityAt)}
                      onClick={() => {
                        setExactTimeFor((currentId) =>
                          currentId === session.id ? null : session.id,
                        );
                      }}
                    >
                      <span className="sr-only">{t('showExactTime')}</span>
                      {t('lastActive', { time: relative(session.lastActivityAt) })}
                    </button>
                    {exactTimeFor === session.id ? (
                      <p className="text-sm text-muted-foreground">
                        <time dateTime={new Date(session.lastActivityAt).toISOString()}>
                          {exact(session.lastActivityAt)}
                        </time>
                      </p>
                    ) : null}
                    <p className="text-sm text-muted-foreground">
                      {t('signedIn', { time: relative(session.createdAt) })}
                    </p>
                    <p className="text-sm text-muted-foreground" dir="auto">
                      {session.ipAddress
                        ? t('ipAddress', { ip: session.ipAddress })
                        : t('unknownIp')}
                    </p>
                  </div>
                </div>
                {session.isCurrent ? null : (
                  <Button
                    variant="secondary"
                    aria-label={t('signOutDevice', { device: deviceName(session) })}
                    disabled={busyId !== null}
                    onClick={() => void revoke(session)}
                  >
                    {busyId === session.id ? (
                      <Spinner />
                    ) : (
                      <LogOut aria-hidden className="size-5 rtl:-scale-x-100" />
                    )}
                    {t('signOut')}
                  </Button>
                )}
              </Card>
            </li>
          ))}
        </ul>
      ) : null}

      {sessions && others.length === 0 ? (
        <p className="text-muted-foreground">{t('empty')}</p>
      ) : null}

      {others.length > 0 ? (
        <Button
          variant="danger"
          className="self-start"
          disabled={busyId !== null}
          onClick={() => {
            setConfirming(true);
          }}
        >
          {busyId === 'others' ? <Spinner /> : null}
          {t('signOutOthers')}
        </Button>
      ) : null}

      <ConfirmDialog
        open={confirming}
        title={t('confirmOthersTitle')}
        body={t('confirmOthersBody')}
        confirmLabel={t('confirmOthers')}
        cancelLabel={tc('cancel')}
        tone="danger"
        onConfirm={() => void revokeOthers()}
        onCancel={() => {
          setConfirming(false);
        }}
      />
    </div>
  );
}
