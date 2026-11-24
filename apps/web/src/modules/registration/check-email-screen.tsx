'use client';

import { MailCheck } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useSyncExternalStore } from 'react';

import { PublicPage } from '@/components/layout/public-page';

import { pendingEmail } from './registration.service';
import { ResendLinkForm } from './resend-link-form';

const noSubscription = () => () => undefined;

/** Check your email (US-011.1 step 7, US-011.2 resend). */
export function CheckEmailScreen() {
  const t = useTranslations('registration.checkEmail');
  const email = useSyncExternalStore(noSubscription, pendingEmail, () => null);

  return (
    <PublicPage>
      <div className="flex flex-col gap-5">
        <MailCheck aria-hidden className="size-10 text-primary" />
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        {email ? (
          <p className="text-muted-foreground">
            {t.rich('sentTo', {
              email: () => (
                <bdi dir="ltr" className="font-medium break-all text-foreground">
                  {email}
                </bdi>
              ),
            })}
          </p>
        ) : (
          <p className="text-muted-foreground">{t('sentToUnknown')}</p>
        )}
        <p className="text-muted-foreground">{t('nextSteps')}</p>
        <div className="flex flex-col gap-2 rounded-lg bg-muted p-4 text-sm">
          <p className="font-medium">{t('helpTitle')}</p>
          <ul className="list-disc ps-5 text-muted-foreground">
            <li>{t('helpSpam')}</li>
            <li>{t('helpWait')}</li>
          </ul>
        </div>
        <ResendLinkForm fixedEmail={email} submitLabel={t('resend')} />
        <Link
          href="/register"
          className="text-center text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          {t('wrongEmail')}
        </Link>
      </div>
    </PublicPage>
  );
}
