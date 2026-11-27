'use client';

import { CloudOff, RefreshCw, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { useSync } from './sync-provider';

/**
 * PLT-31: the header indicator. Nothing when online and nothing waits; otherwise an icon and
 * words (never colour alone): Offline · n pending, Syncing n, n need attention.
 */
export function ConnectionIndicator() {
  const t = useTranslations('offline.indicator');
  const { online, syncing, counts } = useSync();
  const attention = counts.attention + counts.conflicts + counts.waitingSignIn;

  let icon = null;
  /** Phones show the icon and a count; the words stay for screen readers and wider screens. */
  let short: number | null = null;
  let text: string | null = null;
  let tone = 'text-foreground';
  if (attention > 0) {
    icon = <TriangleAlert aria-hidden className="size-5" />;
    text = t('attention', { count: attention });
    short = attention;
    tone = 'text-warning-foreground bg-warning-surface';
  } else if (!online) {
    icon = <CloudOff aria-hidden className="size-5" />;
    text = counts.pending > 0 ? t('offlinePending', { count: counts.pending }) : t('offline');
    short = counts.pending > 0 ? counts.pending : null;
    tone = 'bg-muted';
  } else if (syncing || counts.pending > 0) {
    icon = <RefreshCw aria-hidden className={syncing ? 'size-5 animate-spin' : 'size-5'} />;
    text = t('syncing', { count: counts.pending });
    short = counts.pending > 0 ? counts.pending : null;
    tone = 'bg-muted';
  }
  if (!text) return null;

  return (
    <Link
      href="/sync"
      aria-label={t('open', { status: text })}
      className={`inline-flex min-h-12 shrink-0 items-center gap-1 rounded-lg px-2 text-sm font-medium sm:gap-2 sm:px-3 ${tone}`}
    >
      {icon}
      {short === null ? null : (
        <span aria-hidden className="sm:hidden">
          {short}
        </span>
      )}
      <span aria-live="polite" className="sr-only sm:not-sr-only">
        {text}
      </span>
    </Link>
  );
}
