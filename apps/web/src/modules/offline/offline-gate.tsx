'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { OfflineNotice } from './offline-notice';
import { isOfflineRoute } from './registry';
import { useSync } from './sync-provider';

/**
 * PLT-25 FR-4 / O-115: offline, only offline-capable pages render; every other page explains
 * that it needs a connection instead of failing (D-11: everything else is online-only).
 */
export function OfflineGate({ children }: { children: ReactNode }) {
  const { online } = useSync();
  const pathname = usePathname();
  if (online || isOfflineRoute(pathname)) return children;
  return <OfflineNotice />;
}
