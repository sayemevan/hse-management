import type { ReactNode } from 'react';
import { Suspense } from 'react';

import { AppHeader } from '@/modules/app/app-header';
import { RequireAuth } from '@/modules/auth/require-auth';
import { OfflineGate } from '@/modules/offline/offline-gate';

/** Every page in this group requires a signed-in user. Offline, only offline pages open (PLT-25). */
export default function SignedInLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense>
      <RequireAuth>
        <AppHeader />
        <main id="main" className="mx-auto w-full max-w-5xl px-4 py-6">
          <OfflineGate>{children}</OfflineGate>
        </main>
      </RequireAuth>
    </Suspense>
  );
}
