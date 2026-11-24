'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { PublicPage } from '@/components/layout/public-page';

import { emptyRegistrationValues, RegistrationForm } from './registration-form';
import { registrationService, rememberPendingEmail } from './registration.service';

/** Register your company (US-011.1). */
export function RegisterScreen() {
  const t = useTranslations('registration');
  const router = useRouter();
  const [initial] = useState(emptyRegistrationValues);

  return (
    <PublicPage wide>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">{t('title')}</h1>
          <p className="text-muted-foreground">{t('intro')}</p>
        </div>
        <RegistrationForm
          mode="register"
          initial={initial}
          onSubmit={async ({ values, turnstileToken, applicantLanguage }) => {
            await registrationService.register({
              companyName: values.companyName,
              slug: values.slug,
              countryCode: values.countryCode,
              city: values.city,
              timeZone: values.timeZone,
              defaultLanguage: values.defaultLanguage,
              applicantName: values.applicantName,
              applicantEmail: values.applicantEmail,
              applicantPhone: values.applicantPhone,
              password: values.password,
              planCode: values.planCode,
              applicantLanguage,
              termsAccepted: true,
              turnstileToken,
            });
            rememberPendingEmail(values.applicantEmail.trim().toLowerCase());
            router.push('/register/check-email');
          }}
        />
        <p className="text-center text-sm text-muted-foreground">
          {t.rich('haveAccount', {
            link: (chunks) => (
              <Link
                href="/login"
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                {chunks}
              </Link>
            ),
          })}
        </p>
      </div>
    </PublicPage>
  );
}
