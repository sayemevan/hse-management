'use client';

import type { SyncProbeDto } from '@hse/shared';
import { Camera, Pencil } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type SyntheticEvent, useCallback, useEffect, useId, useState } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/modules/auth/auth-provider';
import { authorizedRequest } from '@/modules/auth/auth-session';

import { compressPhoto, type CompressedPhoto, PhotoNotSupportedError } from '../photo';
import { useSync } from '../sync-provider';
import { useUnsavedChanges } from '../unsaved-changes';
import { listProbeCopies, mergeServerProbes, type ProbeCopy, queueProbe, queueProbeEdit } from './sync-probe';

/**
 * O-116 (development build only): create and edit a probe with photos, online or offline. Every
 * change goes through the outbox, exactly as inspections will in Sprint 10.
 */
export function SyncProbeScreen() {
  const t = useTranslations('offline.probe');
  const { user } = useAuth();
  const { online, refresh, items } = useSync();
  const titleId = useId();
  const noteId = useId();
  const photoId = useId();
  const [copies, setCopies] = useState<ProbeCopy[]>([]);
  const [editing, setEditing] = useState<ProbeCopy | null>(null);
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [photos, setPhotos] = useState<CompressedPhoto[]>([]);
  /** Photos still being compressed: Save waits for them (they would be lost otherwise). */
  const [preparing, setPreparing] = useState(0);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  useUnsavedChanges(title.length > 0 || note.length > 0 || photos.length > 0);

  const load = useCallback(async () => {
    if (!user) return;
    if (online) {
      const server = await authorizedRequest<{ items: SyncProbeDto[] }>('/dev/sync-probes')
        .then((response) => response.data.items)
        .catch(() => null);
      if (server) await mergeServerProbes(user.id, server);
    }
    setCopies(await listProbeCopies(user.id));
  }, [user, online]);

  // Reload when the queue changes too: a sync updates the device copies (number, version).
  const syncedCount = items.filter((item) => item.state === 'synced').length;
  useEffect(() => {
    void load();
  }, [load, syncedCount]);

  if (!user) return null;

  const reset = () => {
    setEditing(null);
    setTitle('');
    setNote('');
    setPhotos([]);
  };

  const save = async (event: SyntheticEvent) => {
    event.preventDefault();
    if (!title.trim()) {
      setMessage({ tone: 'danger', text: t('titleRequired') });
      return;
    }
    if (editing) {
      await queueProbeEdit(user.id, editing.id, { title: title.trim(), note: note.trim() });
    } else {
      await queueProbe(user.id, { title: title.trim(), note: note.trim(), photos });
    }
    setMessage({ tone: 'success', text: online ? t('savedOnline') : t('savedOffline') });
    reset();
    await refresh();
    await load();
  };

  const addPhotos = async (files: FileList | null) => {
    if (!files) return;
    const next: CompressedPhoto[] = [];
    const list = Array.from(files);
    setPreparing((current) => current + list.length);
    for (const file of list) {
      try {
        next.push(await compressPhoto(file, file.name));
      } catch (error) {
        setMessage({ tone: 'danger', text: error instanceof PhotoNotSupportedError ? t('notPhoto') : t('photoFailed') });
      } finally {
        setPreparing((current) => current - 1);
      }
    }
    setPhotos((current) => [...current, ...next].slice(0, 20));
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('intro')}</p>
      </div>
      {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}

      <form onSubmit={(event) => void save(event)} className="flex flex-col gap-4 rounded-xl border border-border p-4">
        <h2 className="font-semibold">{editing ? t('editHeading') : t('newHeading')}</h2>
        <label htmlFor={titleId} className="font-medium">
          {t('fieldTitle')}
        </label>
        <Input id={titleId} value={title} maxLength={100} onChange={(e) => { setTitle(e.target.value); }} />
        <label htmlFor={noteId} className="font-medium">
          {t('fieldNote')}
        </label>
        <Textarea id={noteId} value={note} maxLength={2000} onChange={(e) => { setNote(e.target.value); }} />
        {editing ? null : (
          <div className="flex flex-col gap-2">
            <label htmlFor={photoId} className="inline-flex min-h-12 w-fit cursor-pointer items-center gap-2 rounded-lg border border-border px-4 font-medium hover:bg-muted">
              <Camera aria-hidden className="size-5" />
              {t('addPhotos')}
            </label>
            <input
              id={photoId}
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              className="sr-only"
              onChange={(e) => void addPhotos(e.target.files)}
            />
            {photos.length > 0 ? (
              <p className="text-sm text-muted-foreground">
                {t('photosReady', { count: photos.length, size: (photos.reduce((s, p) => s + p.bytes.byteLength, 0) / 1024).toFixed(0) })}
              </p>
            ) : null}
          </div>
        )}
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button type="submit" disabled={preparing > 0}>
            {preparing > 0 ? t('preparing') : t('save')}
          </Button>
          {editing ? (
            <Button variant="secondary" onClick={reset}>
              {t('cancel')}
            </Button>
          ) : null}
        </div>
      </form>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t('listHeading')}</h2>
        {copies.length === 0 ? (
          <p className="text-muted-foreground">{t('empty')}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {copies.map((copy) => (
              <li key={copy.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border p-4">
                <div>
                  <p className="font-medium">
                    <bdi>{copy.title}</bdi>
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {copy.version === 0 ? t('notSynced') : t('version', { version: copy.version })} ·{' '}
                    {t('photoCount', { count: copy.photos })}
                  </p>
                  {copy.note ? <p className="mt-1 text-sm whitespace-pre-wrap"><bdi>{copy.note}</bdi></p> : null}
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setEditing(copy);
                    setTitle(copy.title);
                    setNote(copy.note);
                  }}
                >
                  <Pencil aria-hidden className="size-4" />
                  {t('edit')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
