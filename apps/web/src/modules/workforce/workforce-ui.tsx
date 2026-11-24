'use client';

import {
  type ComplianceSummaryDto,
  daysBetween,
  type ExpiryState,
  type ListItemRefDto,
  type RecordKind,
  type WorkforceStatus,
} from '@hse/shared';
import {
  AlertTriangle,
  CheckCircle2,
  CircleHelp,
  MoreVertical,
  UserRound,
  XCircle,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import {
  type ReactNode,
  type SyntheticEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useDateFormat } from '@/modules/i18n/use-date-format';
import { cn } from '@/utils/cn';

import { workforceService } from './workforce.service';

/** Today in the browser's calendar; the server applies the company's day (T-50). */
export function todayIso(): string {
  const date = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Names of seeded list items follow the reader's language until renamed (T-54). */
export function usePositionName(): (ref: ListItemRefDto | null) => string {
  const t = useTranslations('workforce.seeds');
  return useCallback(
    (ref: ListItemRefDto | null) =>
      !ref ? '—' : ref.seedKey && t.has(ref.seedKey) ? t(ref.seedKey as 'welder') : ref.name,
    [t],
  );
}

/** The person's name in the reader's language when both scripts exist (O-81). */
export function usePersonName(): (person: { fullName: string; altName: string | null }) => string {
  const locale = useLocale();
  return useCallback(
    (person) => {
      if (!person.altName) return person.fullName;
      const arabic = /[؀-ۿ]/;
      const altIsArabic = arabic.test(person.altName);
      return locale.startsWith('ar') === altIsArabic ? person.altName : person.fullName;
    },
    [locale],
  );
}

export function useCountryName(): (code: string | null) => string {
  const locale = useLocale();
  return useCallback(
    (code: string | null) => {
      if (!code) return '—';
      try {
        return new Intl.DisplayNames([locale], { type: 'region' }).of(code) ?? code;
      } catch {
        return code;
      }
    },
    [locale],
  );
}

/** The label of a record: its type (certificates, documents, medical) or its name. */
export function useRecordLabel(): (record: {
  kind: RecordKind;
  type: string | null;
  name: string | null;
}) => string {
  const t = useTranslations('workforce.types');
  return useCallback(
    (record) => {
      if (record.kind === 'training' || !record.type) return record.name ?? '';
      if (record.type === 'other')
        return record.name ?? t(`${record.kind}.other` as 'document.other');
      const type = t(`${record.kind}.${record.type}` as 'document.passport');
      return record.name ? `${type} · ${record.name}` : type;
    },
    [t],
  );
}

const STATUS_TONE: Record<WorkforceStatus, string> = {
  active: 'bg-success-surface text-success-foreground',
  on_leave: 'bg-info-surface text-info-foreground',
  suspended: 'bg-warning-surface text-warning-foreground',
  inactive: 'bg-muted text-foreground',
  terminated: 'bg-inactive text-white',
};

export function StatusChip({ status }: { status: WorkforceStatus }) {
  const t = useTranslations('workforce.status');
  return (
    <span className={cn('w-fit rounded-full px-2 text-xs font-medium', STATUS_TONE[status])}>
      {t(status)}
    </span>
  );
}

const EXPIRY_STYLE: Record<ExpiryState, { Icon: typeof CheckCircle2; tone: string }> = {
  none: { Icon: CheckCircle2, tone: 'text-muted-foreground' },
  valid: { Icon: CheckCircle2, tone: 'text-success-foreground' },
  expiring: { Icon: AlertTriangle, tone: 'text-warning-foreground' },
  expired: { Icon: XCircle, tone: 'text-danger' },
};

/** PLT-20: the same expiry wording and icon everywhere (never colour alone). */
export function ExpiryBadge({
  state,
  expiresOn,
}: {
  state: ExpiryState;
  expiresOn: string | null;
}) {
  const t = useTranslations('workforce.expiry');
  const { calendarDate } = useDateFormat();
  const [today] = useState(todayIso);
  const { Icon, tone } = EXPIRY_STYLE[state];
  const days = expiresOn ? daysBetween(today, expiresOn) : 0;
  const text =
    state === 'none'
      ? t('none')
      : state === 'valid'
        ? t('validUntil', { date: calendarDate(expiresOn) })
        : state === 'expiring'
          ? days <= 0
            ? t('today')
            : t('inDays', { count: days })
          : t('expiredAgo', { count: Math.max(1, -days) });
  return (
    <span className={cn('inline-flex items-center gap-1 text-sm font-medium', tone)}>
      <Icon aria-hidden className="size-4 shrink-0" />
      {text}
    </span>
  );
}

const BADGE_STYLE = {
  ok: { Icon: CheckCircle2, tone: 'bg-success-surface text-success-foreground' },
  expiring: { Icon: AlertTriangle, tone: 'bg-warning-surface text-warning-foreground' },
  expired: { Icon: XCircle, tone: 'bg-danger text-white' },
  check: { Icon: CircleHelp, tone: 'bg-info-surface text-info-foreground' },
} as const;

/** PLT-20 compliance badge with the nearest item ("Operator licence expires in 6 days"). */
export function ComplianceBadge({
  compliance,
  detailed = false,
}: {
  compliance: ComplianceSummaryDto;
  detailed?: boolean;
}) {
  const t = useTranslations('workforce.compliance');
  const label = useRecordLabel();
  const { Icon, tone } = BADGE_STYLE[compliance.badge];
  const reasons: string[] = [];
  if (detailed) {
    if (compliance.expired > 0) reasons.push(t('expiredCount', { count: compliance.expired }));
    if (compliance.expiring > 0) reasons.push(t('expiringCount', { count: compliance.expiring }));
    if (compliance.medicalMissing) reasons.push(t('medicalMissing'));
    if (compliance.medicalUnfit) reasons.push(t('medicalUnfit'));
    if (compliance.noEmergencyContact) reasons.push(t('noContact'));
  }
  return (
    <span className="flex flex-col gap-1">
      <span
        className={cn(
          'inline-flex w-fit items-center gap-1 rounded-full px-2 text-xs font-medium',
          tone,
        )}
      >
        <Icon aria-hidden className="size-3.5" />
        {t(`badge.${compliance.badge}`)}
      </span>
      {compliance.nearest ? (
        <span className="text-sm text-muted-foreground">
          {label(compliance.nearest)}{' '}
          <ExpiryBadge
            state={compliance.worst === 'expired' ? 'expired' : 'expiring'}
            expiresOn={compliance.nearest.expiresOn}
          />
        </span>
      ) : null}
      {reasons.length > 0 ? (
        <span className="text-sm text-muted-foreground">{reasons.join(' · ')}</span>
      ) : null}
    </span>
  );
}

/** A photo served to signed-in readers only, fetched with the token. */
export function PersonPhoto({
  url,
  name,
  size = 'md',
}: {
  url: string | null;
  name: string;
  size?: 'md' | 'lg';
}) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!url) return;
    let revoked = false;
    let objectUrl: string | null = null;
    workforceService.blob(url).then(
      (blob) => {
        if (revoked) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      },
      () => undefined,
    );
    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url]);
  const box = size === 'lg' ? 'size-20' : 'size-12';
  if (!url || !src) {
    return (
      <span
        aria-hidden
        className={cn('flex shrink-0 items-center justify-center rounded-full bg-muted', box)}
      >
        <UserRound className="size-1/2 text-muted-foreground" />
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a blob URL, not an optimisable asset
    <img src={src} alt={name} className={cn('shrink-0 rounded-full object-cover', box)} />
  );
}

/** Opens a protected file in a new tab (blob URL). */
export async function openBlob(load: () => Promise<Blob>): Promise<void> {
  const tab = window.open('', '_blank');
  const blob = await load();
  const url = URL.createObjectURL(blob);
  if (tab) tab.location.href = url;
  else window.location.href = url;
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 60_000);
}

const dialogClass =
  'm-0 h-dvh max-h-none w-full max-w-none bg-background p-0 text-foreground backdrop:bg-black/40 sm:m-auto sm:h-auto sm:max-h-[90dvh] sm:w-[calc(100%-2rem)] sm:max-w-lg sm:rounded-xl sm:border sm:border-border sm:shadow-xl';

/** A form dialog, full-screen on phones (UI rules). */
export function FormDialog({
  open,
  title,
  error,
  saving,
  submitLabel,
  cancelLabel,
  tone = 'primary',
  onSubmit,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  error?: string | null;
  saving?: boolean;
  submitLabel: string;
  cancelLabel: string;
  tone?: 'primary' | 'danger';
  onSubmit: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);
  const handle = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit();
  };
  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      className={dialogClass}
    >
      {open ? (
        <form noValidate onSubmit={handle} className="flex flex-col gap-5 p-6">
          <h2 id={titleId} className="text-xl font-semibold">
            {title}
          </h2>
          {error ? <Alert tone="danger">{error}</Alert> : null}
          {children}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" onClick={onClose}>
              {cancelLabel}
            </Button>
            <Button type="submit" variant={tone} disabled={saving}>
              {saving ? <Spinner /> : null}
              {submitLabel}
            </Button>
          </div>
        </form>
      ) : null}
    </dialog>
  );
}

/** A small row menu (Edit, Renew, Void …), large touch targets. */
export function RowMenu({
  label,
  items,
}: {
  label: string;
  items: { label: string; onSelect: () => void; danger?: boolean }[];
}) {
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;
  return (
    <div className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={() => {
          setOpen(!open);
        }}
        className="inline-flex min-h-12 min-w-12 items-center justify-center rounded-lg hover:bg-muted"
      >
        <MoreVertical aria-hidden className="size-5" />
      </button>
      {open ? (
        <ul
          role="menu"
          className="absolute end-0 top-full z-10 mt-1 w-48 rounded-xl border border-border bg-background py-1 shadow-xl"
        >
          {items.map((item) => (
            <li key={item.label} role="none">
              <button
                type="button"
                role="menuitem"
                className={cn(
                  'flex min-h-12 w-full items-center px-4 text-start hover:bg-muted',
                  item.danger ? 'text-danger' : '',
                )}
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
