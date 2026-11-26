import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { ActionScreen } from '@/modules/actions/action-screen';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('projectTabs'))('actions') };
}

/** US-053 – US-058 */
export default async function ActionPage({
  params,
}: {
  params: Promise<{ actionId: string }>;
}) {
  const { actionId } = await params;
  return (
    <Suspense>
      <ActionScreen actionId={actionId} />
    </Suspense>
  );
}
