'use client';

import { isValidSlug, RESERVED_SLUGS, SLUG_RULES, type SlugAvailabilityDto } from '@hse/shared';
import { CircleAlert, CircleCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState, useSyncExternalStore } from 'react';

import { FormField } from '@/components/form/form-field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/utils/cn';

import { registrationService } from './registration.service';

const DEBOUNCE_MS = 400;

type Availability =
  | { state: 'idle' }
  | { state: 'checking'; slug: string }
  | { state: 'result'; result: SlugAvailabilityDto }
  | { state: 'error'; slug: string };

/** Turns a company name into a subdomain suggestion (D-16); empty for non-Latin names. */
export function suggestSlug(companyName: string): string {
  return companyName
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, SLUG_RULES.maxLength)
    .replace(/-+$/, '');
}

const noSubscription = () => () => undefined;

/**
 * Subdomain input with the full address and a live, debounced availability badge
 * (US-011.1 FR-1). The server re-checks on submit, so the badge is only guidance.
 */
export function SlugField({
  value,
  onChange,
  error,
  ownSlug,
}: {
  value: string;
  onChange: (value: string) => void;
  error?: string | undefined;
  /** On resubmission, the applicant's own subdomain counts as available. */
  ownSlug?: string | undefined;
}) {
  const t = useTranslations('registration');
  const tc = useTranslations('common');
  const baseHost = useSyncExternalStore(
    noSubscription,
    () => window.location.host,
    () => '',
  );
  const [availability, setAvailability] = useState<Availability>({ state: 'idle' });

  useEffect(() => {
    const slug = value.trim().toLowerCase();
    if (!slug || slug === ownSlug || !isValidSlug(slug)) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setAvailability({ state: 'checking', slug });
      registrationService.slugAvailability(slug, controller.signal).then(
        (result) => {
          setAvailability({ state: 'result', result });
        },
        () => {
          if (!controller.signal.aborted) setAvailability({ state: 'error', slug });
        },
      );
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [value, ownSlug]);

  const slug = value.trim().toLowerCase();
  const badge = ((): { tone: 'ok' | 'bad' | 'busy'; text: string } | null => {
    if (!slug) return null;
    if (slug === ownSlug) return { tone: 'ok', text: t('slugStatus.yours') };
    if (RESERVED_SLUGS.includes(slug)) return { tone: 'bad', text: t('slugStatus.reserved') };
    if (!isValidSlug(slug)) return { tone: 'bad', text: t('slugStatus.invalid') };
    if (availability.state === 'result' && availability.result.slug === slug) {
      const { available, reason } = availability.result;
      return available
        ? { tone: 'ok', text: t('slugStatus.available') }
        : { tone: 'bad', text: t(`slugStatus.${reason ?? 'taken'}`) };
    }
    if (availability.state === 'error' && availability.slug === slug) {
      return { tone: 'bad', text: t('slugStatus.error') };
    }
    return { tone: 'busy', text: t('slugStatus.checking') };
  })();

  const address = `${slug || t('slugPlaceholder')}.${baseHost}`;

  return (
    <FormField
      id="slug"
      label={t('slug')}
      required
      requiredLabel={tc('required')}
      error={error}
      hint={
        <div id="slug-hint" className="flex flex-col gap-2 text-sm">
          <p className="text-muted-foreground">
            {t.rich('slugAddress', {
              address: () => (
                <bdi dir="ltr" className="inline-block font-medium break-all text-foreground">
                  {address}
                </bdi>
              ),
            })}
          </p>
          <p className="text-muted-foreground">
            {t('slugRules', { min: SLUG_RULES.minLength, max: SLUG_RULES.maxLength })}
          </p>
          {badge && !error ? (
            <p
              aria-live="polite"
              className={cn(
                'inline-flex items-center gap-2 self-start rounded-full px-3 py-1 font-medium',
                badge.tone === 'ok' && 'bg-success-surface text-success-foreground',
                badge.tone === 'bad' && 'bg-danger-surface text-danger-foreground',
                badge.tone === 'busy' && 'bg-muted text-muted-foreground',
              )}
            >
              {badge.tone === 'ok' ? <CircleCheck aria-hidden className="size-4" /> : null}
              {badge.tone === 'bad' ? <CircleAlert aria-hidden className="size-4" /> : null}
              {badge.tone === 'busy' ? <Spinner className="size-4" /> : null}
              {badge.text}
            </p>
          ) : null}
        </div>
      }
    >
      <Input
        id="slug"
        name="slug"
        dir="ltr"
        inputMode="url"
        autoCapitalize="none"
        autoComplete="off"
        spellCheck={false}
        maxLength={SLUG_RULES.maxLength}
        value={value}
        invalid={Boolean(error)}
        aria-describedby={error ? 'slug-hint slug-error' : 'slug-hint'}
        required
        onChange={(event) => {
          onChange(event.target.value.toLowerCase());
        }}
      />
    </FormField>
  );
}
