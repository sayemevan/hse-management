import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { ForgotPasswordScreen } from '@/modules/auth/forgot-password-screen';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('forgotPassword'))('title') };
}

/** US-002 (replaces the Sprint 1 "contact your administrator" page, O-7). */
export default function ForgotPasswordPage() {
  return <ForgotPasswordScreen />;
}
