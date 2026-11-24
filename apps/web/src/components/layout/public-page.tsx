import type { ReactNode } from 'react';

import { Card } from '@/components/ui/card';
import { LanguageSwitcher } from '@/modules/i18n/language-switcher';
import { cn } from '@/utils/cn';

import { Brand } from './brand';

/** Layout for pages shown before sign-in: brand, language switcher and one centred card. */
export function PublicPage({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="flex min-h-dvh flex-col bg-muted">
      <header className="flex justify-end p-4">
        <LanguageSwitcher />
      </header>
      <main id="main" className="flex flex-1 items-start justify-center px-4 pb-12 sm:items-center">
        <div className={cn('flex w-full flex-col gap-6', wide ? 'max-w-2xl' : 'max-w-md')}>
          <Brand size="large" />
          <Card>{children}</Card>
        </div>
      </main>
    </div>
  );
}
