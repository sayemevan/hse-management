'use client';

import { ErrorCode } from '@hse/shared';
import { useTranslations } from 'next-intl';
import { useCallback } from 'react';

import { useErrorMessage } from '@/modules/i18n/use-error-message';
import { ApiClientError } from '@/services/api-client';

import type { OutboxError } from './device-store';
import { DEPENDENCY_CODE } from './sync-engine';

/** O-123: why an item waits or was refused, in the user's language. */
export function useSyncReason(): (error: OutboxError | null) => string | null {
  const t = useTranslations('offline.reasons');
  const errorMessage = useErrorMessage();
  return useCallback(
    (error: OutboxError | null) => {
      if (!error) return null;
      if (error.code === DEPENDENCY_CODE) return t('dependency');
      if (error.status === 0 || error.code === ErrorCode.SERVICE_UNAVAILABLE) return t('network');
      if (error.code === ErrorCode.FORBIDDEN || error.status === 403) {
        if (error.code === ErrorCode.SUBSCRIPTION_READ_ONLY) return t('readOnly');
        return t('forbidden');
      }
      if (error.code === ErrorCode.NOT_FOUND) return t('notFound');
      if (error.status === 401) return t('signIn');
      return errorMessage(
        new ApiClientError(error.code as ErrorCode, '', error.status, undefined, [], error.params ?? {}),
      );
    },
    [t, errorMessage],
  );
}
