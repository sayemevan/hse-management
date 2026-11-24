'use client';

import {
  BILLING_CYCLES,
  type BillingCycle,
  ErrorCode,
  PAYMENT_LIMITS,
  PAYMENT_PROOF_RULES,
  type PaymentDto,
  submitPaymentFieldsSchema,
} from '@hse/shared';
import { FileText, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type SyntheticEvent, useEffect, useId, useRef, useState } from 'react';

import { FileDropzone } from '@/components/form/file-dropzone';
import { FormField } from '@/components/form/form-field';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { useErrorMessage } from '@/modules/i18n/use-error-message';
import { usePlans } from '@/modules/platform/use-plans';
import { ApiClientError } from '@/services/api-client';

import { billingService } from './billing.service';
import { useMoney } from './money';

type Field = 'planCode' | 'billingCycle' | 'amount' | 'transferredOn' | 'reference' | 'file';
type Errors = Partial<Record<Field, string>>;

const MAX_MB = PAYMENT_PROOF_RULES.maxBytes / (1024 * 1024);

function localIsoDate(offsetDays = 0): string {
  const date = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Submit payment (PLT-13): plan, billing cycle, amount, transfer date, reference and the
 * receipt. A native dialog: full screen on phones, a panel from tablet width.
 */
export function SubmitPaymentDialog({
  open,
  currentPlanCode,
  onClose,
  onSubmitted,
}: {
  open: boolean;
  currentPlanCode: string;
  onClose: () => void;
  onSubmitted: (payment: PaymentDto) => void;
}) {
  const t = useTranslations('subscription.pay');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const money = useMoney();
  const plans = usePlans();
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [planCode, setPlanCode] = useState(currentPlanCode);
  const [billingCycle, setBillingCycle] = useState<BillingCycle>('monthly');
  const [amount, setAmount] = useState('');
  const [transferredOn, setTransferredOn] = useState(localIsoDate());
  const [reference, setReference] = useState('');
  const [receipt, setReceipt] = useState<File | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      setPlanCode(currentPlanCode);
      setBillingCycle('monthly');
      setAmount('');
      setTransferredOn(localIsoDate());
      setReference('');
      setReceipt(null);
      setErrors({});
      setFormError(null);
      element.showModal();
    }
    if (!open && element.open) element.close();
  }, [open, currentPlanCode]);

  const plan = plans.find((candidate) => candidate.code === planCode);
  const price = plan ? (billingCycle === 'monthly' ? plan.monthlyPrice : plan.annualPrice) : null;

  const handleSubmit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const fields = { planCode, billingCycle, amount, transferredOn, reference };
    const parsed = submitPaymentFieldsSchema.safeParse(fields);
    const found: Errors = {};
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as Field;
        found[field] = t(`errors.${field}` as 'errors.amount');
      }
    }
    if (
      transferredOn > localIsoDate() ||
      transferredOn < localIsoDate(-PAYMENT_LIMITS.transferMaxAgeDays)
    ) {
      found.transferredOn = t('errors.transferredOn');
    }
    if (!receipt) found.file = t('errors.file');
    setErrors(found);
    setFormError(null);
    if (Object.keys(found).length > 0 || !parsed.success || !receipt) return;

    setSending(true);
    try {
      onSubmitted(await billingService.submit(fields, receipt));
    } catch (error) {
      if (error instanceof ApiClientError && error.code === ErrorCode.VALIDATION_FAILED) {
        const fromServer: Errors = {};
        for (const detail of error.details) {
          const field = detail.path as Field;
          fromServer[field] = t(`errors.${field}` as 'errors.amount');
        }
        setErrors(fromServer);
      } else if (
        error instanceof ApiClientError &&
        (error.code === ErrorCode.FILE_TYPE_NOT_ALLOWED ||
          error.code === ErrorCode.FILE_TOO_LARGE ||
          error.code === ErrorCode.FILE_EMPTY)
      ) {
        setErrors({ file: errorMessage(error) });
      } else {
        setFormError(errorMessage(error));
      }
    } finally {
      setSending(false);
    }
  };

  const describedBy = (field: Field) => (errors[field] ? `pay-${field}-error` : undefined);

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      className="m-0 h-dvh max-h-none w-full max-w-none bg-background p-0 text-foreground backdrop:bg-black/40 sm:m-auto sm:h-auto sm:max-h-[90dvh] sm:w-[calc(100%-2rem)] sm:max-w-lg sm:rounded-xl sm:border sm:border-border sm:shadow-xl"
    >
      <form
        noValidate
        onSubmit={(event) => void handleSubmit(event)}
        className="flex flex-col gap-5 p-6"
      >
        <div className="flex flex-col gap-1">
          <h2 id={titleId} className="text-xl font-semibold">
            {t('title')}
          </h2>
          <p className="text-muted-foreground">{t('intro')}</p>
        </div>
        {formError ? <Alert tone="danger">{formError}</Alert> : null}

        <FormField
          id="pay-planCode"
          label={t('plan')}
          required
          requiredLabel={tc('required')}
          error={errors.planCode}
        >
          <Select
            id="pay-planCode"
            value={planCode}
            invalid={Boolean(errors.planCode)}
            aria-describedby={describedBy('planCode')}
            onChange={(event) => {
              setPlanCode(event.target.value);
            }}
          >
            {plans.length === 0 ? <option value={currentPlanCode}>{currentPlanCode}</option> : null}
            {plans.map((option) => (
              <option key={option.code} value={option.code}>
                {option.code === currentPlanCode
                  ? t('planCurrent', { plan: option.name })
                  : option.name}
              </option>
            ))}
          </Select>
        </FormField>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">{t('cycle')}</legend>
          <div className="grid grid-cols-2 gap-2">
            {BILLING_CYCLES.map((cycle) => (
              <label
                key={cycle}
                className="flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border border-border px-4 has-[:checked]:border-primary has-[:checked]:bg-muted"
              >
                <input
                  type="radio"
                  name="billingCycle"
                  value={cycle}
                  checked={billingCycle === cycle}
                  onChange={() => {
                    setBillingCycle(cycle);
                  }}
                  className="size-5 accent-primary"
                />
                {t(`cycles.${cycle}`)}
              </label>
            ))}
          </div>
          <p className="text-sm text-muted-foreground">
            {price === null ? t('priceOnRequest') : t('price', { price: money(price) })}{' '}
            {t('vatNote')}
          </p>
        </fieldset>

        <FormField
          id="pay-amount"
          label={t('amount')}
          required
          requiredLabel={tc('required')}
          error={errors.amount}
        >
          <Input
            id="pay-amount"
            inputMode="decimal"
            dir="ltr"
            autoComplete="off"
            placeholder="0.00"
            value={amount}
            invalid={Boolean(errors.amount)}
            aria-describedby={describedBy('amount')}
            onChange={(event) => {
              setAmount(event.target.value.replace(',', '.'));
            }}
          />
        </FormField>

        <FormField
          id="pay-transferredOn"
          label={t('transferredOn')}
          required
          requiredLabel={tc('required')}
          error={errors.transferredOn}
        >
          <Input
            id="pay-transferredOn"
            type="date"
            dir="ltr"
            max={localIsoDate()}
            min={localIsoDate(-PAYMENT_LIMITS.transferMaxAgeDays)}
            value={transferredOn}
            invalid={Boolean(errors.transferredOn)}
            aria-describedby={describedBy('transferredOn')}
            onChange={(event) => {
              setTransferredOn(event.target.value);
            }}
          />
        </FormField>

        <FormField
          id="pay-reference"
          label={t('reference')}
          error={errors.reference}
          hint={<p className="text-sm text-muted-foreground">{t('referenceHint')}</p>}
        >
          <Input
            id="pay-reference"
            dir="ltr"
            maxLength={PAYMENT_LIMITS.referenceMax}
            value={reference}
            invalid={Boolean(errors.reference)}
            aria-describedby={describedBy('reference')}
            onChange={(event) => {
              setReference(event.target.value);
            }}
          />
        </FormField>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">
            {t('receipt')}
            <span className="ms-1 text-danger" title={tc('required')} aria-hidden>
              *
            </span>
          </span>
          {receipt ? (
            <div className="flex items-center gap-3 rounded-lg border border-border p-3">
              <FileText aria-hidden className="size-6 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">
                <bdi>{receipt.name}</bdi>
              </span>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('removeReceipt')}
                onClick={() => {
                  setReceipt(null);
                }}
              >
                <X aria-hidden className="size-5" />
              </Button>
            </div>
          ) : (
            <FileDropzone
              label={t('receiptChoose')}
              hint={t('receiptHint', { max: MAX_MB })}
              accept={PAYMENT_PROOF_RULES.contentTypes.join(',')}
              invalid={Boolean(errors.file)}
              describedBy={describedBy('file')}
              onFile={(file) => {
                setReceipt(file);
                setErrors((current) => ({ ...current, file: undefined }));
              }}
            />
          )}
          {errors.file ? (
            <p id="pay-file-error" className="text-sm text-danger">
              {errors.file}
            </p>
          ) : null}
        </div>

        <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button type="submit" disabled={sending}>
            {sending ? <Spinner /> : null}
            {sending ? t('sending') : t('send')}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
