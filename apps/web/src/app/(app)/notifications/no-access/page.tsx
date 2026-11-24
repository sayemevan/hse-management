import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('notifications'))('noAccessTitle') };
}

/** PLT-17 FR-8 (T-41): the record behind a notification can no longer be opened. */
export default async function NoAccessPage() {
  const t = await getTranslations('notifications');
  const tc = await getTranslations('common');
  return (
    <div className="flex flex-col items-start gap-4">
      <h1 className="text-2xl font-semibold">{t('noAccessTitle')}</h1>
      <p className="text-muted-foreground">{t('noAccessBody')}</p>
      <Link href="/" className="font-medium text-primary underline-offset-4 hover:underline">
        {tc('home')}
      </Link>
    </div>
  );
}
