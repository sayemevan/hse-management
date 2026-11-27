'use client';

import {
  type InspectionResult,
  type InspectionScore,
  type InspectionStatus,
  type InspectionSummaryDto,
  localized,
} from '@hse/shared';
import {
  Ban,
  CheckCircle2,
  CircleDashed,
  CircleDot,
  CloudOff,
  Eye,
  FileCheck2,
  Lock,
  MinusCircle,
  PenLine,
  Search,
  XCircle,
} from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback } from 'react';

import { useDateFormat } from '@/modules/i18n/use-date-format';
import { cn } from '@/utils/cn';

/** O-143: the reader's language, else the other one. */
export function useLocalized() {
  const locale = useLocale();
  return useCallback(
    (text: { en?: string | null; ar?: string | null } | null | undefined) => localized(text, locale),
    [locale],
  );
}

export function useTemplateName() {
  const pick = useLocalized();
  return useCallback(
    (item: { templateNameEn?: string | null; templateNameAr?: string | null; nameEn?: string | null; nameAr?: string | null }) =>
      pick({ en: item.templateNameEn ?? item.nameEn ?? null, ar: item.templateNameAr ?? item.nameAr ?? null }),
    [pick],
  );
}

const STATUS_ICONS = {
  draft: PenLine,
  in_progress: CircleDot,
  submitted: FileCheck2,
  approved: CheckCircle2,
  closed: Lock,
} as const;

const STATUS_STYLES: Record<InspectionStatus, string> = {
  draft: 'border-border bg-muted text-foreground',
  in_progress: 'border-primary/40 bg-primary/10 text-primary',
  submitted: 'border-warning/40 bg-warning/10 text-foreground',
  approved: 'border-success/40 bg-success/10 text-foreground',
  closed: 'border-border bg-background text-muted-foreground',
};

/** Status with icon and word (never colour alone, PLT-32 UI). */
export function InspectionStatusChip({ status, cancelled }: { status: InspectionStatus; cancelled?: boolean }) {
  const t = useTranslations('inspections.status');
  if (cancelled) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium">
        <Ban aria-hidden className="size-3.5" />
        {t('cancelled')}
      </span>
    );
  }
  const Icon = STATUS_ICONS[status];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium',
        STATUS_STYLES[status],
      )}
    >
      <Icon aria-hidden className="size-3.5" />
      {t(status)}
    </span>
  );
}

export function SmallChip({ icon: Icon, children, tone = 'neutral' }: { icon: typeof Eye; children: React.ReactNode; tone?: 'neutral' | 'danger' | 'warning' }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium',
        tone === 'danger' && 'border-danger/40 bg-danger/10 text-danger',
        tone === 'warning' && 'border-warning/40 bg-warning/10',
        tone === 'neutral' && 'border-border',
      )}
    >
      <Icon aria-hidden className="size-3.5" />
      {children}
    </span>
  );
}

export function NotSyncedChip() {
  const t = useTranslations('inspections');
  return <SmallChip icon={CloudOff}>{t('notSynced')}</SmallChip>;
}

/** Score with its outcome word (T-81). */
export function ScoreBadge({ percent, outcome }: { percent: number | null; outcome: InspectionScore['outcome'] }) {
  const t = useTranslations('inspections.score');
  if (percent === null && outcome === null) return null;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium tabular-nums',
        outcome === 'fail' ? 'border-danger/40 bg-danger/10 text-danger' : 'border-border',
      )}
    >
      {outcome === 'fail' ? <XCircle aria-hidden className="size-3.5" /> : <CheckCircle2 aria-hidden className="size-3.5" />}
      {percent !== null ? <bdi dir="ltr">{t('percent', { value: percent })}</bdi> : null}
      {outcome ? <span>{t(outcome)}</span> : null}
    </span>
  );
}

export const RESULT_ICONS: Record<InspectionResult, typeof Eye> = {
  pass: CheckCircle2,
  fail: XCircle,
  observation: Eye,
  not_applicable: MinusCircle,
  not_inspected: CircleDashed,
};

/** US-034: the result buttons the template allows, 48 px high, icon and word. */
export function ResultButtons({
  allowed,
  value,
  onChange,
  disabled,
  labelledBy,
}: {
  allowed: readonly InspectionResult[];
  value: InspectionResult | null;
  onChange: (value: InspectionResult | null) => void;
  disabled?: boolean;
  labelledBy: string;
}) {
  const t = useTranslations('inspections.result');
  return (
    <div role="radiogroup" aria-labelledby={labelledBy} className="flex flex-wrap gap-2">
      {allowed.map((result) => {
        const Icon = RESULT_ICONS[result];
        const checked = value === result;
        return (
          <button
            key={result}
            type="button"
            role="radio"
            aria-checked={checked}
            disabled={disabled}
            onClick={() => {
              onChange(checked ? null : result);
            }}
            className={cn(
              'inline-flex min-h-12 flex-1 basis-24 items-center justify-center gap-2 rounded-lg border px-3 text-sm font-medium disabled:opacity-50',
              checked && result === 'fail' && 'border-danger bg-danger text-white',
              checked && result === 'pass' && 'border-success bg-success text-white',
              checked && result !== 'fail' && result !== 'pass' && 'border-primary bg-primary text-white',
              !checked && 'border-border hover:bg-muted',
            )}
          >
            <Icon aria-hidden className="size-5" />
            {t(result)}
          </button>
        );
      })}
    </div>
  );
}

/** One inspection in a list (Inspections tab, My inspections). */
export function InspectionCard({ item, href }: { item: InspectionSummaryDto; href: string }) {
  const t = useTranslations('inspections');
  const name = useTemplateName();
  const { calendarDate } = useDateFormat();
  const date = item.inspectedOn ?? item.plannedOn;
  return (
    <li>
      <Link
        href={href}
        className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4 hover:bg-muted/50 focus-visible:outline-2"
      >
        <div className="flex flex-wrap items-center gap-2">
          {item.reference ? (
            <bdi dir="ltr" className="text-sm font-semibold">
              {item.reference}
            </bdi>
          ) : (
            <NotSyncedChip />
          )}
          <InspectionStatusChip status={item.status} cancelled={item.cancelled} />
          {item.underReview ? <SmallChip icon={Search}>{t('underReview')}</SmallChip> : null}
          {item.overdueDays > 0 ? (
            <SmallChip icon={CircleDashed} tone="danger">
              {t('overdue', { days: item.overdueDays })}
            </SmallChip>
          ) : null}
          <ScoreBadge percent={item.scorePercent} outcome={item.scoreOutcome} />
        </div>
        <p className="font-medium">{name(item)}</p>
        <p className="text-sm text-muted-foreground">
          {[
            item.placeName,
            item.inspector.name,
            date ? calendarDate(date) : null,
            item.findingCount > 0 ? t('findingCount', { count: item.findingCount, open: item.openFindingCount }) : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </Link>
    </li>
  );
}
