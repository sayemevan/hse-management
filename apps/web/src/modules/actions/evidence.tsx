'use client';

import type { ActionFileDto } from '@hse/shared';
import { FileText } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { cn } from '@/utils/cn';

import { actionsService } from './actions.service';

/** Loads an evidence file through the action route (T-62) as an object URL. */
function useFileUrl(projectId: string, actionId: string, fileId: string): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let created: string | null = null;
    let cancelled = false;
    actionsService.file(projectId, actionId, fileId).then(
      (blob) => {
        if (cancelled) return;
        created = URL.createObjectURL(blob);
        setUrl(created);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [projectId, actionId, fileId]);
  return url;
}

/** A thumbnail (images) or a document chip (PDF); opens the file in a new tab. */
export function EvidenceThumb({
  projectId,
  actionId,
  file,
  selected,
  onToggle,
}: {
  projectId: string;
  actionId: string;
  file: ActionFileDto;
  selected?: boolean;
  onToggle?: () => void;
}) {
  const t = useTranslations('actions.evidence');
  const url = useFileUrl(projectId, actionId, file.id);
  const image = file.contentType.startsWith('image/');
  const content = image && url ? (
    // Object URLs of the user's own evidence; next/image can't optimise them.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt={file.fileName} className="size-full object-cover" />
  ) : (
    <span className="flex size-full flex-col items-center justify-center gap-1 p-1 text-center text-xs">
      <FileText aria-hidden className="size-6" />
      <bdi className="line-clamp-2 break-all">{file.fileName}</bdi>
    </span>
  );
  const box = cn(
    'block size-24 overflow-hidden rounded-lg border bg-muted',
    selected ? 'border-primary ring-2 ring-primary' : 'border-border',
  );
  if (onToggle) {
    return (
      <button
        type="button"
        aria-pressed={selected}
        aria-label={t(selected ? 'unselect' : 'select', { name: file.fileName })}
        className={box}
        onClick={onToggle}
      >
        {content}
      </button>
    );
  }
  return (
    <a
      href={url ?? undefined}
      target="_blank"
      rel="noopener"
      className={box}
      aria-label={t('open', { name: file.fileName })}
    >
      {content}
    </a>
  );
}

/** A row of evidence files, optionally selectable. */
export function EvidenceRow({
  projectId,
  actionId,
  files,
  selected,
  onToggle,
}: {
  projectId: string;
  actionId: string;
  files: readonly ActionFileDto[];
  selected?: ReadonlySet<string>;
  onToggle?: (fileId: string) => void;
}) {
  if (files.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-2">
      {files.map((file) => (
        <li key={file.id}>
          <EvidenceThumb
            projectId={projectId}
            actionId={actionId}
            file={file}
            {...(onToggle
              ? {
                  selected: selected?.has(file.id) ?? false,
                  onToggle: () => {
                    onToggle(file.id);
                  },
                }
              : {})}
          />
        </li>
      ))}
    </ul>
  );
}
