'use client';

import {
  BILLING_CYCLES,
  type BillingCycle,
  ErrorCode,
  nextPeriodStart,
  PAYMENT_LIMITS,
  type PlatformPaymentDetailDto,
  periodEnd,
} from '@hse/shared';
import { ArrowLeft, Check, ExternalLink, FileText, X } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { type ReactNode, useCallback, useEffect, useState } from 'react';

import { FormField } from '@/components/form/form-field';
import { LoadStatus } from '@/components/layout/load-status';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { useLoad } from '@/modules/app/use-load';
import { useMoney } from '@/modules/billing/money';
import { PaymentStatusBadge, SubscriptionStateBadge } from '@/modules/billing/status-badges';
import { useErrorMessage } from '@/modules/i18n/use-error-message';
import { ApiClientError } from '@/services/api-client';

import { platformPaymentsService } from './platform-payments.service';
import { usePlatformDate } from './use-platform-date';
import { usePlans } from './use-plans';

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
      <dt className="text-sm text-muted-foreground sm:w-44 sm:shrink-0">{label}</dt>
      <dd className="break-words">{children}</dd>
    </div>
  );
}

/** Payment detail with the receipt, Confirm and Reject (PLT-14 FR-2 – FR-6). */
export function PaymentDetailScreen({ id }: { id: string }) {
  const t = useTranslations('platformPayments');
  const tp = useTranslations('subscription');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const formatDate = usePlatformDate();
  const money = useMoney();
  const plans = usePlans();
  const load = useCallback(() => platformPaymentsService.detail(id), [id]);
  const loaded = useLoad(load, id);
  // The preview uses the time the page opened; the API uses the time of the confirmation.
  const [openedAt] = useState(() => Date.now());

  const [planCode, setPlanCode] = useState<string | null>(null);
  const [cycle, setCycle] = useState<BillingCycle | null>(null);
  const [amount, setAmount] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'confirm' | 'reject' | null>(null);
  const [result, setResult] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  if (loaded.status !== 'ready') {
    return (
      <div className="flex flex-col gap-4">
        <BackLink label={t('backToQueue')} />
        <LoadStatus
          error={loaded.status === 'error' ? loaded.error : undefined}
          onRetry={loaded.reload}
        />
      </div>
    );
  }
  const payment = loaded.value;
  const chosenPlan = planCode ?? payment.planCode;
  const chosenCycle = cycle ?? payment.billingCycle;
  const chosenAmount = amount ?? payment.amount.toFixed(2);
  const pending = payment.status === 'pending';

  // The same rule as the API (O-33), so the preview matches what will be recorded.
  const start = nextPeriodStart(
    payment.subscription.state,
    {
      trialEndsAt: payment.subscription.trialEndsAt,
      currentPeriodEnd: payment.subscription.currentPeriodEnd,
    },
    openedAt,
  );
  const end = periodEnd(start, chosenCycle);

  const showResult = (tone: 'success' | 'danger', text: string) => {
    setResult({ tone, text });
    requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  };

  const confirm = async () => {
    setConfirming(false);
    setBusy('confirm');
    setResult(null);
    try {
      await platformPaymentsService.confirm(payment.id, {
        ...(chosenPlan !== payment.planCode ? { planCode: chosenPlan } : {}),
        ...(chosenCycle !== payment.billingCycle ? { billingCycle: chosenCycle } : {}),
        ...(Number(chosenAmount) !== payment.amount ? { amountReceived: chosenAmount } : {}),
      });
      loaded.reload();
      showResult('success', t('confirm.done'));
    } catch (error) {
      showResult('danger', errorMessage(error));
      if (error instanceof ApiClientError && error.code === ErrorCode.PAYMENT_ALREADY_REVIEWED) {
        loaded.reload();
      }
    } finally {
      setBusy(null);
    }
  };

  const reject = async () => {
    const trimmed = reason.trim();
    if (trimmed.length < PAYMENT_LIMITS.rejectionReasonMin) {
      setReasonError(t('reject.reasonTooShort', { min: PAYMENT_LIMITS.rejectionReasonMin }));
      return;
    }
    setRejecting(false);
    setBusy('reject');
    setResult(null);
    try {
      await platformPaymentsService.reject(payment.id, trimmed);
      setReason('');
      loaded.reload();
      showResult('success', t('reject.done'));
    } catch (error) {
      showResult('danger', errorMessage(error));
      if (error instanceof ApiClientError && error.code === ErrorCode.PAYMENT_ALREADY_REVIEWED) {
        loaded.reload();
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <BackLink label={t('backToQueue')} />

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">
            <bdi>{payment.companyName}</bdi>
          </h1>
          <PaymentStatusBadge status={payment.status} />
        </div>
        <p className="text-muted-foreground">
          <bdi dir="ltr">{payment.companySlug}</bdi>
        </p>
      </div>

      {result ? <Alert tone={result.tone}>{result.text}</Alert> : null}

      <Card className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">{t('paymentSection')}</h2>
        <dl className="flex flex-col gap-3">
          <Detail label={t('fields.amount')}>{money(payment.amount)}</Detail>
          <Detail label={t('fields.plan')}>
            {t('planCycle', {
              plan: payment.planName,
              cycle: tp(`pay.cycles.${payment.billingCycle}`),
            })}
          </Detail>
          <Detail label={t('fields.transferredOn')}>
            <bdi dir="ltr">{payment.transferredOn}</bdi>
          </Detail>
          <Detail label={t('fields.reference')}>
            {payment.reference ? <bdi dir="ltr">{payment.reference}</bdi> : '—'}
          </Detail>
          <Detail label={t('fields.submitted')}>
            {t('submittedBy', {
              name: payment.submittedByName ?? '—',
              date: formatDate(payment.submittedAt),
            })}
          </Detail>
          {payment.reviewedAt !== null ? (
            <Detail label={t('fields.reviewed')}>
              {t('submittedBy', {
                name: payment.reviewedByName ?? '—',
                date: formatDate(payment.reviewedAt),
              })}
            </Detail>
          ) : null}
          {payment.rejectionReason ? (
            <Detail label={t('fields.reason')}>
              <bdi>{payment.rejectionReason}</bdi>
            </Detail>
          ) : null}
          {payment.status === 'confirmed' && payment.periodEnd !== null ? (
            <Detail label={t('fields.period')}>
              {t('periodRange', {
                start: formatDate(payment.periodStart),
                end: formatDate(payment.periodEnd),
              })}
            </Detail>
          ) : null}
        </dl>
        <Receipt payment={payment} />
      </Card>

      <Card className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">{t('subscriptionSection')}</h2>
          <SubscriptionStateBadge state={payment.subscription.state} />
        </div>
        <dl className="flex flex-col gap-3">
          <Detail label={t('fields.trialEnds')}>
            {formatDate(payment.subscription.trialEndsAt)}
          </Detail>
          <Detail label={t('fields.periodEnds')}>
            {formatDate(payment.subscription.currentPeriodEnd)}
          </Detail>
          <Detail label={t('fields.users')}>{payment.usage.users}</Detail>
          <Detail label={t('fields.contact')}>
            {payment.contactEmail ? <bdi dir="ltr">{payment.contactEmail}</bdi> : '—'}
            {payment.contactPhone ? (
              <span className="block">
                <bdi dir="ltr">{payment.contactPhone}</bdi>
              </span>
            ) : null}
          </Detail>
        </dl>
      </Card>

      {pending ? (
        <Card className="flex flex-col gap-5">
          <h2 className="text-lg font-semibold">{t('decisionSection')}</h2>
          <p className="text-sm text-muted-foreground">{t('decisionIntro')}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="confirm-plan" label={t('confirm.plan')}>
              <Select
                id="confirm-plan"
                value={chosenPlan}
                onChange={(event) => {
                  setPlanCode(event.target.value);
                }}
              >
                {plans.length === 0 ? (
                  <option value={payment.planCode}>{payment.planName}</option>
                ) : null}
                {plans.map((plan) => (
                  <option key={plan.code} value={plan.code}>
                    {plan.code === payment.planCode
                      ? t('confirm.planAsked', { plan: plan.name })
                      : plan.name}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField id="confirm-cycle" label={t('confirm.cycle')}>
              <Select
                id="confirm-cycle"
                value={chosenCycle}
                onChange={(event) => {
                  setCycle(event.target.value as BillingCycle);
                }}
              >
                {BILLING_CYCLES.map((option) => (
                  <option key={option} value={option}>
                    {tp(`pay.cycles.${option}`)}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField id="confirm-amount" label={t('confirm.amount')}>
              <Input
                id="confirm-amount"
                inputMode="decimal"
                dir="ltr"
                value={chosenAmount}
                onChange={(event) => {
                  setAmount(event.target.value.replace(',', '.'));
                }}
              />
            </FormField>
          </div>
          <Alert tone="info">
            {t('confirm.preview', { start: formatDate(start), end: formatDate(end) })}
          </Alert>
          <div className="flex flex-col gap-3 sm:flex-row-reverse sm:justify-start">
            <Button
              disabled={busy !== null}
              onClick={() => {
                setConfirming(true);
              }}
            >
              {busy === 'confirm' ? <Spinner /> : <Check aria-hidden className="size-5" />}
              {t('confirm.action')}
            </Button>
            <Button
              variant="secondary"
              className="border-danger text-danger hover:bg-danger-surface"
              disabled={busy !== null}
              onClick={() => {
                setReasonError(null);
                setRejecting(true);
              }}
            >
              {busy === 'reject' ? <Spinner /> : <X aria-hidden className="size-5" />}
              {t('reject.action')}
            </Button>
          </div>
        </Card>
      ) : null}

      {payment.history.length > 0 ? (
        <Card className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold">{t('historySection')}</h2>
          <ul className="flex flex-col gap-3">
            {payment.history.map((other) => (
              <li key={other.id} className="flex flex-col gap-1 border-t border-border pt-3">
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{money(other.amount)}</span>
                  <PaymentStatusBadge status={other.status} />
                </span>
                <span className="text-sm text-muted-foreground">
                  {t('planCycle', {
                    plan: other.planName,
                    cycle: tp(`pay.cycles.${other.billingCycle}`),
                  })}{' '}
                  · {formatDate(other.submittedAt)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <ConfirmDialog
        open={confirming}
        title={t('confirm.title')}
        body={t('confirm.body', {
          company: payment.companyName,
          start: formatDate(start),
          end: formatDate(end),
        })}
        confirmLabel={t('confirm.action')}
        cancelLabel={tc('cancel')}
        onConfirm={() => void confirm()}
        onCancel={() => {
          setConfirming(false);
        }}
      />
      <ConfirmDialog
        open={rejecting}
        title={t('reject.title')}
        body={t('reject.body')}
        confirmLabel={t('reject.action')}
        cancelLabel={tc('cancel')}
        tone="danger"
        confirmDisabled={reason.trim().length === 0}
        onConfirm={() => void reject()}
        onCancel={() => {
          setRejecting(false);
        }}
      >
        <FormField id="reject-reason" label={t('reject.reason')} required error={reasonError}>
          <Textarea
            id="reject-reason"
            rows={4}
            maxLength={PAYMENT_LIMITS.rejectionReasonMax}
            value={reason}
            invalid={Boolean(reasonError)}
            aria-describedby={reasonError ? 'reject-reason-error' : undefined}
            onChange={(event) => {
              setReason(event.target.value);
              setReasonError(null);
            }}
          />
        </FormField>
      </ConfirmDialog>
    </div>
  );
}

function BackLink({ label }: { label: string }) {
  return (
    <Link
      href="/platform/payments"
      className="inline-flex min-h-10 items-center gap-2 self-start font-medium text-primary underline-offset-4 hover:underline"
    >
      <ArrowLeft aria-hidden className="size-5 rtl:-scale-x-100" />
      {label}
    </Link>
  );
}

/** The receipt: an image shown fitted, a PDF opened in a new tab (PLT-14 UI). */
function Receipt({ payment }: { payment: PlatformPaymentDetailDto }) {
  const t = useTranslations('platformPayments');
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const effect = { cancelled: false, url: null as string | null };
    platformPaymentsService.receiptUrl(payment.id).then(
      (loaded) => {
        effect.url = loaded;
        if (effect.cancelled) URL.revokeObjectURL(loaded);
        else setUrl(loaded);
      },
      () => {
        if (!effect.cancelled) setFailed(true);
      },
    );
    return () => {
      effect.cancelled = true;
      if (effect.url) URL.revokeObjectURL(effect.url);
    };
  }, [payment.id]);

  if (failed) return <Alert tone="danger">{t('receiptFailed')}</Alert>;
  if (!url) {
    return (
      <div role="status" className="flex items-center gap-3 text-muted-foreground">
        <Spinner />
        {t('receiptLoading')}
      </div>
    );
  }
  const isImage = payment.fileContentType.startsWith('image/');
  return (
    <div className="flex flex-col gap-3">
      {isImage ? (
        // eslint-disable-next-line @next/next/no-img-element -- a private blob URL from the API
        <img
          src={url}
          alt={t('receiptAlt', { company: payment.companyName })}
          className="max-h-96 w-full rounded-lg border border-border object-contain"
        />
      ) : null}
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex min-h-10 items-center gap-2 self-start font-medium text-primary underline-offset-4 hover:underline"
      >
        {isImage ? (
          <ExternalLink aria-hidden className="size-5" />
        ) : (
          <FileText aria-hidden className="size-5" />
        )}
        {isImage ? t('receiptFullSize') : t('receiptOpen', { name: payment.fileName })}
      </a>
    </div>
  );
}
