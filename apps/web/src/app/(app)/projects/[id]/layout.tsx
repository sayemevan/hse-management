import type { ReactNode } from 'react';

import { ProjectShell } from '@/modules/projects/project-context';
import { CompanyOnly } from '@/modules/tenant/company-only';

/** PLT-19: every project tab shares the loaded project, its header and the tab bar. */
export default async function ProjectLayout({
  params,
  children,
}: {
  params: Promise<{ id: string }>;
  children: ReactNode;
}) {
  const { id } = await params;
  return (
    <CompanyOnly>
      <ProjectShell id={id}>{children}</ProjectShell>
    </CompanyOnly>
  );
}
