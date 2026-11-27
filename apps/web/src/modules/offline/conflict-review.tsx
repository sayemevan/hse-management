'use client';

import {
  ErrorCode,
  type ResolveConflictResultDto,
  type SyncConflictChoice,
  type SyncConflictDto,
} from '@hse/shared';
import { ArrowLeft, Diff } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Spinner } from '@/components/ui/spinner';
import { useAuth } from '@/modules/auth/auth-provider';
import { authorizedRequest } from '@/modules/auth/auth-session';
import { useDateFormat } from '@/modules/i18n/use-date-format';
import { useErrorMessage } from '@/modules/i18n/use-error-message';
import { ApiClientError } from '@/services/api-client';
import { cn } from '@/utils/cn';

import { enqueue, listDeviceConflicts, removeDeviceConflict, saveDeviceConflict } from './outbox';
import { offlineEntity, RESOLUTION_TYPE } from './registry';
import { useSync } from './sync-provider';

function text(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/**
 * PLT-30 (D-20, O-122): both versions side by side, field by field, changed fields marked with
 * an icon and a word. Keep mine, Keep theirs (confirmed) or Combine per field. Offline, the
 * choice is queued and sent later.
 */
export function ConflictReview({
  conflictId,
  onDone,
}: {
  conflictId: string;
  onDone: (message: string) => void;
}) {
  const t = useTranslations('offline.conflict');
  const { user } = useAuth();
  const { online, conflictResolved, conflictReplaced } = useSync();
  const errorMessage = useErrorMessage();
  const { dateTime } = useDateFormat();
  const router = useRouter();
  const [conflict, setConflict] = useState<SyncConflictDto | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing'>('loading');
  const [combining, setCombining] = useState(false);
  const [picks, setPicks] = useState<Record<string, 'mine' | 'theirs'>>({});
  const [confirmTheirs, setConfirmTheirs] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    let found: SyncConflictDto | null = null;
    if (online) {
      found = await authorizedRequest<SyncConflictDto>(`/me/sync/conflicts/${conflictId}`)
        .then((response) => response.data)
        .catch(() => null);
      if (found) {
        await saveDeviceConflict({
          userId: user.id,
          conflictId,
          outboxSeq: null,
          conflict: found,
          savedAt: Date.now(),
        }).catch(() => undefined);
      }
    }
    if (!found) {
      found = (await listDeviceConflicts(user.id)).find((row) => row.conflictId === conflictId)?.conflict ?? null;
    }
    setConflict(found);
    setState(found ? 'ready' : 'missing');
  }, [user, online, conflictId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state === 'loading') return <Spinner />;
  if (!conflict || state === 'missing') {
    return (
      <div className="flex flex-col gap-4">
        <Alert tone="warning">{t('missing')}</Alert>
        <Link href="/sync?tab=conflicts" className="text-primary underline-offset-4 hover:underline">
          {t('back')}
        </Link>
      </div>
    );
  }

  const entity = offlineEntity(conflict.entityType);
  const fields = conflict.fields.length > 0 ? conflict.fields : Object.keys(conflict.clientPayload);
  const mine = (field: string) =>
    field in conflict.clientPayload ? conflict.clientPayload[field] : conflict.serverSnapshot[field];
  const theirs = (field: string) => conflict.serverSnapshot[field];
  const changed = (field: string) => field in conflict.clientPayload && text(mine(field)) !== text(theirs(field));
  const render = (field: string, value: unknown) => entity?.renderValue?.(field, value) ?? <bdi>{text(value)}</bdi>;
  const closed = conflict.status !== 'open';

  const submit = async (choice: SyncConflictChoice) => {
    if (!user) return;
    const values =
      choice === 'combine'
        ? Object.fromEntries(fields.map((field) => [field, (picks[field] ?? 'mine') === 'mine' ? mine(field) : theirs(field)]))
        : undefined;
    setBusy(true);
    setError(null);
    try {
      if (!online) {
        // Queued: sent when the connection returns; the engine then closes the conflict.
        await enqueue({
          userId: user.id,
          entityType: RESOLUTION_TYPE,
          entityId: `conflict:${conflictId}`,
          kind: 'custom',
          label: conflict.label,
          projectCode: conflict.projectCode,
          request: {
            method: 'POST',
            path: `/me/sync/conflicts/${conflictId}/resolve`,
            body: { choice, ...(values ? { values } : {}) },
            contractVersion: 1,
          },
        });
        onDone(t('queued'));
        return;
      }
      await authorizedRequest<ResolveConflictResultDto>(`/me/sync/conflicts/${conflictId}/resolve`, {
        method: 'POST',
        body: { choice, ...(values ? { values } : {}) },
      });
      await removeDeviceConflict(user.id, conflictId);
      await conflictResolved(conflictId);
      onDone(choice === 'theirs' ? t('doneTheirs') : t('doneApplied'));
    } catch (failure) {
      if (failure instanceof ApiClientError && failure.code === ErrorCode.SYNC_CONFLICT_RESOLVED) {
        await removeDeviceConflict(user.id, conflictId);
        await conflictResolved(conflictId);
        onDone(t('alreadyResolved'));
        return;
      }
      if (failure instanceof ApiClientError && failure.code === ErrorCode.SYNC_CONFLICT) {
        // The record changed again: a new conflict replaces this one (both versions kept).
        const next = String(failure.params.conflictId ?? '');
        if (next) {
          await removeDeviceConflict(user.id, conflictId);
          await conflictReplaced(conflictId, next);
          router.replace(`/sync?conflict=${next}`);
          setError(t('changedAgain'));
          return;
        }
      }
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 pb-28">
      <Link
        href="/sync?tab=conflicts"
        className="inline-flex items-center gap-2 text-sm font-medium text-primary underline-offset-4 hover:underline"
      >
        <ArrowLeft aria-hidden className="size-4 rtl:-scale-x-100" />
        {t('back')}
      </Link>
      <div>
        <h1 className="text-2xl font-semibold">
          <bdi>{conflict.label}</bdi>
        </h1>
        <p className="text-sm text-muted-foreground">
          {t('changedBy', { name: conflict.changedBy ?? t('someone') })}{' '}
          <bdi dir="ltr">{dateTime(conflict.createdAt)}</bdi>
        </p>
        <p className="mt-2">{t('explain')}</p>
      </div>
      {!online ? <Alert tone="info">{t('offlineNote')}</Alert> : null}
      {closed ? <Alert tone="info">{t('closed')}</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}

      <ul className="flex flex-col gap-3">
        {fields.map((field) => {
          const differs = changed(field);
          const label = t.has(`fields.${field}`) ? t(`fields.${field}` as 'fields.title') : field;
          return (
            <li key={field} className={cn('rounded-xl border p-4', differs ? 'border-warning' : 'border-border')}>
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="font-medium">{label}</h2>
                {differs ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-warning-surface px-2 py-0.5 text-xs font-medium text-warning-foreground">
                    <Diff aria-hidden className="size-3.5" />
                    {t('changed')}
                  </span>
                ) : null}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {(['mine', 'theirs'] as const).map((side) => {
                  const value = side === 'mine' ? mine(field) : theirs(field);
                  const picked = (picks[field] ?? 'mine') === side;
                  return (
                    <div key={side} className="rounded-lg bg-muted p-3">
                      {combining && differs ? (
                        <label className="mb-1 flex min-h-10 cursor-pointer items-center gap-2 text-sm font-medium">
                          <input
                            type="radio"
                            name={`pick-${field}`}
                            aria-label={`${label}: ${t(side)}`}
                            checked={picked}
                            onChange={() => {
                              setPicks((current) => ({ ...current, [field]: side }));
                            }}
                          />
                          {t(side)}
                        </label>
                      ) : (
                        <p className="mb-1 text-sm font-medium text-muted-foreground">{t(side)}</p>
                      )}
                      <div className="whitespace-pre-wrap break-words">{render(field, value)}</div>
                    </div>
                  );
                })}
              </div>
            </li>
          );
        })}
      </ul>

      {!closed ? (
        <div className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-background p-4">
          <div className="mx-auto flex max-w-5xl flex-col gap-2 sm:flex-row sm:justify-end">
            {combining ? (
              <>
                <Button variant="secondary" disabled={busy} onClick={() => { setCombining(false); }}>
                  {t('cancel')}
                </Button>
                <Button disabled={busy} onClick={() => void submit('combine')}>
                  {busy ? <Spinner /> : null}
                  {t('saveCombined')}
                </Button>
              </>
            ) : (
              <>
                <Button variant="secondary" disabled={busy} onClick={() => { setConfirmTheirs(true); }}>
                  {t('keepTheirs')}
                </Button>
                <Button variant="secondary" disabled={busy} onClick={() => { setCombining(true); }}>
                  {t('combine')}
                </Button>
                <Button disabled={busy} onClick={() => void submit('mine')}>
                  {busy ? <Spinner /> : null}
                  {t('keepMine')}
                </Button>
              </>
            )}
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmTheirs}
        title={t('keepTheirsTitle')}
        body={t('keepTheirsBody')}
        confirmLabel={t('keepTheirs')}
        cancelLabel={t('cancel')}
        onCancel={() => { setConfirmTheirs(false); }}
        onConfirm={() => {
          setConfirmTheirs(false);
          void submit('theirs');
        }}
      />
    </div>
  );
}
