import type { ReactNode } from 'react';

import { Spinner } from '@/components/ui/spinner';

import { PublicPage } from './public-page';

/** A full-page explanation with an optional recovery action (Doc 05 §22: error states). */
export function FullPageMessage({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <PublicPage>
      <div className="flex flex-col gap-4">
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="text-muted-foreground">{body}</p>
        {action}
      </div>
    </PublicPage>
  );
}

/** Centred loading indicator that never blocks with a blank screen (Doc 05 §21). */
export function FullPageLoading({ label }: { label: string }) {
  return (
    <div className="flex min-h-dvh items-center justify-center gap-3 text-muted-foreground">
      <Spinner />
      <span>{label}</span>
    </div>
  );
}
