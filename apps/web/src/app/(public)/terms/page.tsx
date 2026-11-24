import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { PublicPage } from '@/components/layout/public-page';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('legal'))('termsTitle') };
}

/** O-14: placeholder until the Product Owner provides the final text (needed before go-live). */
export default async function TermsPage() {
  const t = await getTranslations('legal');
  return (
    <PublicPage>
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold">{t('termsTitle')}</h1>
        <p className="text-muted-foreground">{t('placeholder')}</p>
      </div>
    </PublicPage>
  );
}
