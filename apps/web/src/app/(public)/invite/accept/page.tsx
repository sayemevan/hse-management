import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { AcceptInvitationScreen } from '@/modules/auth/accept-invitation-screen';
import { CompanyOnly } from '@/modules/tenant/company-only';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('acceptInvitation'))('pageTitle') };
}

/** US-006: the invited person's side. */
export default function AcceptInvitationPage() {
  return (
    <Suspense>
      <CompanyOnly>
        <AcceptInvitationScreen />
      </CompanyOnly>
    </Suspense>
  );
}
