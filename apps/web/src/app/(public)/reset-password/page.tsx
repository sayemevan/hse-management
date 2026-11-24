import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { ResetPasswordScreen } from '@/modules/auth/reset-password-screen';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('resetPassword'))('title') };
}

/** US-003 */
export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordScreen />
    </Suspense>
  );
}
