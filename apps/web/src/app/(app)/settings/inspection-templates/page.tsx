import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { RequirePermission } from '@/modules/auth/require-permission';
import { TemplatesScreen } from '@/modules/inspections/templates-screen';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('inspections.templates'))('title') };
}

/** US-031, US-032 */
export default function InspectionTemplatesPage() {
  return (
    <RequirePermission permission="inspections.templates.manage">
      <TemplatesScreen />
    </RequirePermission>
  );
}
