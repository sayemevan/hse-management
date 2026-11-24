'use client';

import {
  type ApprovalResultDto,
  ErrorCode,
  REGISTRATION_LIMITS,
  type RegistrationDetailDto,
} from '@hse/shared';
import { ArrowLeft, Check, ExternalLink, X } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';

import { FormField } from '@/components/form/form-field';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Select } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { useErrorMessage } from '@/modules/i18n/use-error-message';
import { ApiClientError } from '@/services/api-client';

import { platformRegistrationsService } from './platform-registrations.service';
import { RegistrationStatusBadge } from './registration-status-badge';
import { usePlatformDate } from './use-platform-date';
import { planName, usePlans } from './use-plans';

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
      <dt className="text-sm text-muted-foreground sm:w-44 sm:shrink-0">{label}</dt>
      <dd className="break-words">{children}</dd>
    </div>
  );
}

/** Registration detail with Approve / Reject (US-011.3, US-011.4; Doc 05 §17). */
export function RegistrationDetailScreen({ id }: { id: string }) {
  const t = useTranslations('platformRegistrations');
  const tc = useTranslations('common');
  const tl = useTranslations('language');
  const locale = useLocale();
  const errorMessage = useErrorMessage();
  const formatDate = usePlatformDate();
  const plans = usePlans();
  const regionNames = useMemo(
    () => new Intl.DisplayNames([locale], { type: 'region', fallback: 'code' }),
    [locale],
  );

  const [registration, setRegistration] = useState<RegistrationDetailDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [phoneConfirmed, setPhoneConfirmed] = useState(false);
  const [planCode, setPlanCode] = useState('');
  const [confirmingApprove, setConfirmingApprove] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const [approved, setApproved] = useState<ApprovalResultDto | null>(null);
  const [rejected, setRejected] = useState(false);

  // A malformed id in the address is answered with a validation error: show it as not found.
  const loadErrorMessage = useCallback(
    (error: unknown) =>
      errorMessage(
        error instanceof ApiClientError && error.code === ErrorCode.VALIDATION_FAILED
          ? new ApiClientError(ErrorCode.NOT_FOUND, error.message, 404)
          : error,
      ),
    [errorMessage],
  );

  const load = useCallback(
    () =>
      platformRegistrationsService.detail(id).then(
        (detail) => {
          setRegistration(detail);
          setPlanCode(detail.planCode);
          setLoadError(null);
        },
        (error: unknown) => {
          setLoadError(loadErrorMessage(error));
        },
      ),
    [id, loadErrorMessage],
  );

  useEffect(() => {
    const effect = { cancelled: false };
    platformRegistrationsService.detail(id).then(
      (detail) => {
        if (effect.cancelled) return;
        setRegistration(detail);
        setPlanCode(detail.planCode);
      },
      (error: unknown) => {
        if (!effect.cancelled) setLoadError(loadErrorMessage(error));
      },
    );
    return () => {
      effect.cancelled = true;
    };
  }, [id, loadErrorMessage]);

  // The outcome is shown at the top of the page; on a phone the buttons are far below it.
  const showResult = () => {
    requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  };

  const handleActionError = async (error: unknown) => {
    setActionError(errorMessage(error));
    showResult();
    // Someone else decided meanwhile: show the current state.
    if (error instanceof ApiClientError && error.code === ErrorCode.REGISTRATION_ALREADY_DECIDED) {
      await load();
    }
  };

  const approve = async () => {
    if (!registration) return;
    setConfirmingApprove(false);
    setBusy('approve');
    setActionError(null);
    try {
      const result = await platformRegistrationsService.approve(
        registration.id,
        planCode && planCode !== registration.planCode ? planCode : undefined,
      );
      setApproved(result);
      await load();
      showResult();
    } catch (error) {
      await handleActionError(error);
    } finally {
      setBusy(null);
    }
  };

  const reject = async () => {
    if (!registration) return;
    const trimmed = reason.trim();
    if (trimmed.length < REGISTRATION_LIMITS.rejectionReasonMin) {
      setReasonError(t('reject.reasonTooShort', { min: REGISTRATION_LIMITS.rejectionReasonMin }));
      return;
    }
    setRejecting(false);
    setBusy('reject');
    setActionError(null);
    try {
      await platformRegistrationsService.reject(registration.id, trimmed);
      setRejected(true);
      setReason('');
      await load();
      showResult();
    } catch (error) {
      await handleActionError(error);
    } finally {
      setBusy(null);
    }
  };

  const backLink = (
    <Link
      href="/platform/registrations"
      className="inline-flex min-h-10 items-center gap-2 self-start font-medium text-primary underline-offset-4 hover:underline"
    >
      <ArrowLeft aria-hidden className="size-5 rtl:-scale-x-100" />
      {t('backToQueue')}
    </Link>
  );

  if (loadError && !registration) {
    return (
      <div className="flex flex-col gap-4">
        {backLink}
        <Alert tone="danger">{loadError}</Alert>
      </div>
    );
  }

  if (!registration) {
    return (
      <div role="status" className="flex items-center gap-3 text-muted-foreground">
        <Spinner />
        <span>{tc('loading')}</span>
      </div>
    );
  }

  const decidable = registration.status === 'submitted';
  const reasonLength = reason.trim().length;

  return (
    <div className="flex flex-col gap-6">
      {backLink}

      {/* ---- Overview -------------------------------------------------------------- */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">
            <bdi>{registration.companyName}</bdi>
          </h1>
          <RegistrationStatusBadge status={registration.status} />
        </div>
        <p className="text-muted-foreground">
          <bdi dir="ltr">{registration.slug}</bdi>
        </p>
      </div>

      {approved ? (
        <Alert tone="success">
          <p className="font-medium">{t('approve.done')}</p>
          <a
            href={approved.signInUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-flex items-center gap-1 font-medium underline underline-offset-4"
          >
            <bdi dir="ltr">{approved.signInUrl}</bdi>
            <ExternalLink aria-hidden className="size-4" />
          </a>
        </Alert>
      ) : null}
      {rejected ? <Alert tone="success">{t('reject.done')}</Alert> : null}
      {actionError ? <Alert tone="danger">{actionError}</Alert> : null}

      {/* ---- Information ------------------------------------------------------------ */}
      <Card className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">{t('companySection')}</h2>
        <dl className="flex flex-col gap-3">
          <Detail label={t('fields.country')}>{regionNames.of(registration.countryCode)}</Detail>
          <Detail label={t('fields.city')}>
            <bdi>{registration.city}</bdi>
          </Detail>
          <Detail label={t('fields.timeZone')}>
            <bdi dir="ltr">{registration.timeZone}</bdi>
          </Detail>
          <Detail label={t('fields.defaultLanguage')}>{tl(registration.defaultLanguage)}</Detail>
          <Detail label={t('fields.plan')}>{planName(plans, registration.planCode)}</Detail>
          <Detail label={t('fields.submittedAt')}>{formatDate(registration.submittedAt)}</Detail>
        </dl>
      </Card>

      <Card className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">{t('applicantSection')}</h2>
        <dl className="flex flex-col gap-3">
          <Detail label={t('fields.applicantName')}>
            <bdi>{registration.applicantName}</bdi>
          </Detail>
          <Detail label={t('fields.applicantEmail')}>
            <bdi dir="ltr" className="break-all">
              {registration.applicantEmail}
            </bdi>
          </Detail>
          <Detail label={t('fields.applicantPhone')}>
            <a
              href={`tel:${registration.applicantPhone}`}
              dir="ltr"
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              {registration.applicantPhone}
            </a>
          </Detail>
          <Detail label={t('fields.applicantLanguage')}>
            {tl(registration.applicantLanguage)}
          </Detail>
          <Detail label={t('fields.emailVerifiedAt')}>
            {formatDate(registration.emailVerifiedAt)}
          </Detail>
        </dl>
      </Card>

      {/* ---- Decision ---------------------------------------------------------------- */}
      {decidable ? (
        <Card className="flex flex-col gap-5">
          <h2 className="text-lg font-semibold">{t('decisionSection')}</h2>
          <p className="text-sm text-muted-foreground">{t('decisionIntro')}</p>
          <Checkbox
            id="phoneConfirmed"
            checked={phoneConfirmed}
            onChange={(event) => {
              setPhoneConfirmed(event.target.checked);
            }}
            label={t.rich('approve.phoneConfirmed', {
              phone: () => <bdi dir="ltr">{registration.applicantPhone}</bdi>,
            })}
          />
          {plans.length > 0 ? (
            <FormField id="planCode" label={t('approve.plan')}>
              <Select
                id="planCode"
                value={planCode}
                onChange={(event) => {
                  setPlanCode(event.target.value);
                }}
              >
                {plans.map((plan) => (
                  <option key={plan.code} value={plan.code}>
                    {plan.code === registration.planCode
                      ? t('approve.planChosen', { plan: plan.name })
                      : plan.name}
                  </option>
                ))}
              </Select>
            </FormField>
          ) : null}
          <div className="flex flex-col gap-3 sm:flex-row-reverse sm:justify-start">
            <Button
              disabled={!phoneConfirmed || busy !== null}
              aria-describedby={phoneConfirmed ? undefined : 'approve-hint'}
              onClick={() => {
                setConfirmingApprove(true);
              }}
            >
              {busy === 'approve' ? <Spinner /> : <Check aria-hidden className="size-5" />}
              {t('approve.action')}
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
          {phoneConfirmed ? null : (
            <p id="approve-hint" className="text-sm text-muted-foreground">
              {t('approve.needsPhone')}
            </p>
          )}
        </Card>
      ) : null}

      {/* ---- History ------------------------------------------------------------------ */}
      <Card className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">{t('historySection')}</h2>
        {registration.reviews.length === 0 ? (
          <p className="text-muted-foreground">{t('historyEmpty')}</p>
        ) : (
          <ol className="flex flex-col gap-4">
            {registration.reviews.map((review) => (
              <li
                key={`${review.decidedAt}-${review.decision}`}
                className="flex flex-col gap-1 border-s-2 border-border ps-4"
              >
                <p className="font-medium">
                  {review.decision === 'approved'
                    ? t('history.approved', { name: review.decidedByName ?? '—' })
                    : t('history.rejected', { name: review.decidedByName ?? '—' })}
                </p>
                <p className="text-sm text-muted-foreground">{formatDate(review.decidedAt)}</p>
                {review.reason ? (
                  <p className="whitespace-pre-line" dir="auto">
                    {review.reason}
                  </p>
                ) : null}
                {review.newPlanCode && review.newPlanCode !== review.previousPlanCode ? (
                  <p className="text-sm text-muted-foreground">
                    {t('history.planChanged', {
                      from: planName(plans, review.previousPlanCode),
                      to: planName(plans, review.newPlanCode),
                    })}
                  </p>
                ) : null}
                {review.phoneConfirmed ? (
                  <p className="text-sm text-muted-foreground">{t('history.phoneConfirmed')}</p>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </Card>

      <ConfirmDialog
        open={confirmingApprove}
        title={t('approve.confirmTitle')}
        body={t('approve.confirmBody', {
          company: registration.companyName,
          plan: planName(plans, planCode || registration.planCode),
        })}
        confirmLabel={t('approve.confirm')}
        cancelLabel={tc('cancel')}
        onConfirm={() => void approve()}
        onCancel={() => {
          setConfirmingApprove(false);
        }}
      />

      <ConfirmDialog
        open={rejecting}
        title={t('reject.title')}
        body={t('reject.body')}
        confirmLabel={t('reject.confirm')}
        cancelLabel={tc('cancel')}
        tone="danger"
        onConfirm={() => void reject()}
        onCancel={() => {
          setRejecting(false);
        }}
      >
        <FormField
          id="reject-reason"
          label={t('reject.reason')}
          required
          requiredLabel={tc('required')}
          error={reasonError}
          hint={
            <p id="reject-reason-count" className="text-end text-sm text-muted-foreground">
              {t('reject.counter', {
                count: reasonLength,
                max: REGISTRATION_LIMITS.rejectionReasonMax,
              })}
            </p>
          }
        >
          <Textarea
            id="reject-reason"
            dir="auto"
            maxLength={REGISTRATION_LIMITS.rejectionReasonMax}
            value={reason}
            invalid={Boolean(reasonError)}
            aria-describedby={
              reasonError ? 'reject-reason-count reject-reason-error' : 'reject-reason-count'
            }
            onChange={(event) => {
              setReason(event.target.value);
              if (reasonError) setReasonError(null);
            }}
          />
        </FormField>
      </ConfirmDialog>
    </div>
  );
}
