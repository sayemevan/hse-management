import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { RequirePermission } from '@/modules/auth/require-permission';
import { TemplateBuilder } from '@/modules/inspections/template-builder';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('inspections.builder'))('title') };
}

/** US-031, US-032: the template builder. */
export default async function InspectionTemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <RequirePermission permission="inspections.templates.manage">
      <TemplateBuilder id={id} />
    </RequirePermission>
  );
}
