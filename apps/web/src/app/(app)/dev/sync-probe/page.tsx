import { notFound } from 'next/navigation';

import { SyncProbeScreen } from '@/modules/offline/dev/sync-probe-screen';
import { CompanyOnly } from '@/modules/tenant/company-only';

/** O-116: development build only; production answers 404 (the API's probe routes do too). */
export default function SyncProbePage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return (
    <CompanyOnly>
      <SyncProbeScreen />
    </CompanyOnly>
  );
}
