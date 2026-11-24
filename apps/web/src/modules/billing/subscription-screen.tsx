'use client';

import type { PaymentDto, SubscriptionSummaryDto } from '@hse/shared';
import { Check, Copy, Landmark, Receipt } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type ReactNode, useCallback, useState } from 'react';

import { LoadStatus } from '@/components/layout/load-status';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Spinner } from '@/components/ui/spinner';
import { useLoad } from '@/modules/app/use-load';
import { useDateFormat } from '@/modules/i18n/use-date-format';
import { useErrorMessage } from '@/modules/i18n/use-error-message';
import { useReloadTenant } from '@/modules/tenant/tenant-provider';

import { billingService } from './billing.service';
import { sizeParts, useMoney } from './money';
import { PaymentStatusBadge, SubscriptionStateBadge } from './status-badges';
import { SubmitPaymentDialog } from './submit-payment-dialog';

interface Loaded {
  summary: SubscriptionSummaryDto;
  payments: PaymentDto[];
}

const loadAll = async (): Promise<Loaded> => {
  const [summary, payments] = await Promise.all([
    billingService.summary(),
    billingService.payments(),
  ]);
  return { summary, payments };
};

/** Subscription page (PLT-13): status, usage, bank details, payment and history. */
export function SubscriptionScreen() {
  const t = useTranslations('subscription');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const reloadTenant = useReloadTenant();
  const { date } = useDateFormat();
  const money = useMoney();
  const loaded = useLoad(loadAll, 'subscription');
  const [paying, setPaying] = useState(false);
  const [withdrawing, setWithdrawing] = useState<PaymentDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  const size = useCallback(
    (bytes: number) => {
      const { unit, value } = sizeParts(bytes);
      return t(unit, { value });
    },
    [t],
  );

  if (loaded.status !== 'ready') {
    return (
      <LoadStatus
        error={loaded.status === 'error' ? loaded.error : undefined}
        onRetry={loaded.reload}
      />
    );
  }
  const { summary, payments } = loaded.value;
  const pending = summary.pendingPayment;

  const deadline =
    summary.state === 'trial'
      ? { label: t('trialEnds'), value: summary.trialEndsAt }
      : summary.state === 'active'
        ? { label: t('periodEnds'), value: summary.currentPeriodEnd }
        : summary.state === 'grace'
          ? { label: t('graceEnds'), value: summary.graceEndsAt }
          : { label: t('readOnlySince'), value: summary.readOnlySince };

  const withdraw = async () => {
    if (!withdrawing) return;
    const target = withdrawing;
    setWithdrawing(null);
    setBusy(true);
    setNotice(null);
    try {
      await billingService.withdraw(target.id);
      setNotice({ tone: 'success', text: t('withdrawn') });
      loaded.reload();
      reloadTenant();
    } catch (error) {
      setNotice({ tone: 'danger', text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-muted-foreground">{t('intro')}</p>
      </div>

      {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}
      {summary.state === 'read_only' ? <Alert tone="danger">{t('readOnlyExplained')}</Alert> : null}

      {/* ---- Status ---------------------------------------------------------------- */}
      <Card className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">{t('planTitle', { plan: summary.planName })}</h2>
          <SubscriptionStateBadge state={summary.state} />
        </div>
        <dl className="grid gap-4 sm:grid-cols-2">
          <Item label={deadline.label} value={date(deadline.value)} />
          <Item
            label={t('cycle')}
            value={summary.billingCycle ? t(`pay.cycles.${summary.billingCycle}`) : t('cycleNone')}
          />
          {summary.nextPlanName ? (
            <Item label={t('nextPlan')} value={summary.nextPlanName} />
          ) : null}
        </dl>
        <div className="grid gap-6 sm:grid-cols-2">
          <Usage
            label={t('users')}
            used={summary.usage.users}
            limit={summary.limits.users}
            text={
              summary.limits.users === null
                ? t('unlimited', { used: summary.usage.users })
                : t('of', { used: summary.usage.users, limit: summary.limits.users })
            }
          />
          <Usage
            label={t('projects')}
            used={summary.usage.projects}
            limit={summary.limits.projects}
            text={
              summary.limits.projects === null
                ? t('unlimited', { used: summary.usage.projects })
                : t('of', { used: summary.usage.projects, limit: summary.limits.projects })
            }
          />
          <Usage
            label={t('storage')}
            used={summary.usage.storageBytes}
            limit={summary.limits.storageBytes}
            text={t('of', {
              used: size(summary.usage.storageBytes),
              limit: size(summary.limits.storageBytes),
            })}
          />
        </div>
      </Card>

      {/* ---- Pay ------------------------------------------------------------------- */}
      <Card className="flex flex-col gap-4">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Landmark aria-hidden className="size-5 text-muted-foreground" />
          {t('bankTitle')}
        </h2>
        <p className="text-sm text-muted-foreground">{t('bankIntro')}</p>
        <dl className="grid gap-4 sm:grid-cols-2">
          <Item label={t('bankName')} value={summary.bankDetails.bankName} />
          <Item label={t('beneficiary')} value={summary.bankDetails.beneficiary} />
          <div className="flex flex-col gap-1 sm:col-span-2">
            <dt className="text-sm text-muted-foreground">{t('iban')}</dt>
            <dd className="flex flex-wrap items-center gap-2">
              <bdi dir="ltr" className="font-mono font-medium tracking-wide">
                {summary.bankDetails.iban}
              </bdi>
              <CopyButton value={summary.bankDetails.iban} />
            </dd>
          </div>
        </dl>

        {pending ? (
          <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{t('pendingTitle')}</span>
              <PaymentStatusBadge status="pending" />
            </div>
            <p className="text-sm text-muted-foreground">
              {t('paymentLine', {
                plan: pending.planName,
                cycle: t(`pay.cycles.${pending.billingCycle}`),
                amount: money(pending.amount),
                date: pending.transferredOn,
              })}
            </p>
            <Button
              variant="secondary"
              className="self-start"
              disabled={busy}
              onClick={() => {
                setWithdrawing(pending);
              }}
            >
              {busy ? <Spinner /> : null}
              {t('withdraw')}
            </Button>
          </div>
        ) : (
          <Button
            className="self-start"
            onClick={() => {
              setNotice(null);
              setPaying(true);
            }}
          >
            <Receipt aria-hidden className="size-5" />
            {t('submit')}
          </Button>
        )}
      </Card>

      {/* ---- History ---------------------------------------------------------------- */}
      <Card className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">{t('historyTitle')}</h2>
        {payments.length === 0 ? (
          <p className="text-muted-foreground">{t('historyEmpty')}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {payments.map((payment) => (
              <li
                key={payment.id}
                className="flex flex-col gap-2 rounded-lg border border-border p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">
                    {money(payment.confirmedAmount ?? payment.amount)}
                  </span>
                  <PaymentStatusBadge status={payment.status} />
                </div>
                <p className="text-sm text-muted-foreground">
                  {t('paymentLine', {
                    plan: payment.confirmedPlanName ?? payment.planName,
                    cycle: t(`pay.cycles.${payment.confirmedBillingCycle ?? payment.billingCycle}`),
                    amount: money(payment.amount),
                    date: payment.transferredOn,
                  })}
                </p>
                {payment.status === 'confirmed' && payment.periodEnd !== null ? (
                  <p className="text-sm">
                    {t('paidPeriod', {
                      start: date(payment.periodStart),
                      end: date(payment.periodEnd),
                    })}
                  </p>
                ) : null}
                {payment.status === 'rejected' && payment.rejectionReason ? (
                  <p className="rounded-md bg-muted p-3 text-sm">
                    <span className="font-medium">{t('rejectionReason')}</span>{' '}
                    <bdi>{payment.rejectionReason}</bdi>
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <SubmitPaymentDialog
        open={paying}
        currentPlanCode={summary.planCode}
        onClose={() => {
          setPaying(false);
        }}
        onSubmitted={() => {
          setPaying(false);
          setNotice({ tone: 'success', text: t('submitted') });
          loaded.reload();
          reloadTenant();
        }}
      />
      <ConfirmDialog
        open={withdrawing !== null}
        title={t('withdrawTitle')}
        body={t('withdrawBody')}
        confirmLabel={t('withdraw')}
        cancelLabel={tc('cancel')}
        tone="danger"
        onConfirm={() => void withdraw()}
        onCancel={() => {
          setWithdrawing(null);
        }}
      />
    </div>
  );
}

function Item({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

function CopyButton({ value }: { value: string }) {
  const t = useTranslations('subscription');
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => {
        void navigator.clipboard.writeText(value.replace(/\s+/g, '')).then(() => {
          setCopied(true);
          setTimeout(() => {
            setCopied(false);
          }, 2000);
        });
      }}
    >
      {copied ? <Check aria-hidden className="size-4" /> : <Copy aria-hidden className="size-4" />}
      <span aria-live="polite">{copied ? t('copied') : t('copyIban')}</span>
    </Button>
  );
}

/** A usage bar with the value in text too (not colour only). Over the limit shows in danger. */
function Usage({
  label,
  used,
  limit,
  text,
}: {
  label: string;
  used: number;
  limit: number | null;
  text: string;
}) {
  const percent = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-between gap-2 text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground">{text}</span>
      </div>
      {limit ? (
        <div
          role="progressbar"
          aria-label={label}
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuetext={text}
          className="h-2 overflow-hidden rounded-full bg-muted"
        >
          <div
            className={
              used > limit
                ? 'h-full bg-danger'
                : percent >= 90
                  ? 'h-full bg-warning'
                  : 'h-full bg-primary'
            }
            style={{ inlineSize: `${String(percent)}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}
