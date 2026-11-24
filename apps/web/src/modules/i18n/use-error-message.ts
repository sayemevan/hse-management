'use client';

import { ErrorCode } from '@hse/shared';
import { useTranslations } from 'next-intl';
import { useCallback } from 'react';

import { ApiClientError } from '@/services/api-client';

const TRANSLATED_CODES = new Set<string>([
  ErrorCode.INVALID_CREDENTIALS,
  ErrorCode.ACCOUNT_TEMPORARILY_LOCKED,
  ErrorCode.ACCOUNT_INACTIVE,
  ErrorCode.SESSION_EXPIRED,
  ErrorCode.CURRENT_PASSWORD_INCORRECT,
  ErrorCode.PASSWORD_UNCHANGED,
  ErrorCode.CANNOT_REVOKE_CURRENT_SESSION,
  ErrorCode.TENANT_NOT_FOUND,
  ErrorCode.TENANT_ACCESS_DENIED,
  ErrorCode.RATE_LIMITED,
  ErrorCode.NOT_FOUND,
  ErrorCode.VALIDATION_FAILED,
  ErrorCode.FORBIDDEN,
  ErrorCode.UNAUTHENTICATED,
  ErrorCode.SERVICE_UNAVAILABLE,
  ErrorCode.BOT_CHECK_FAILED,
  ErrorCode.SLUG_UNAVAILABLE,
  ErrorCode.TOKEN_INVALID_OR_EXPIRED,
  ErrorCode.REGISTRATION_ALREADY_DECIDED,
  ErrorCode.REGISTRATION_CONFLICT,
  ErrorCode.EMAIL_IN_USE,
  ErrorCode.PLAN_USER_LIMIT_REACHED,
  ErrorCode.COMPANY_READ_ONLY,
  ErrorCode.INVITATION_NOT_PENDING,
  ErrorCode.FILE_TOO_LARGE,
  ErrorCode.FILE_TYPE_NOT_ALLOWED,
  ErrorCode.FILE_EMPTY,
  ErrorCode.CONFLICT,
  // Sprint 4
  ErrorCode.SUBSCRIPTION_READ_ONLY,
  ErrorCode.PLAN_LIMIT_REACHED,
  ErrorCode.PLAN_NOT_AVAILABLE,
  ErrorCode.PAYMENT_ALREADY_PENDING,
  ErrorCode.PAYMENT_ALREADY_REVIEWED,
  // Sprint 5
  ErrorCode.PROJECT_CODE_TAKEN,
  ErrorCode.PROJECT_CODE_LOCKED,
  ErrorCode.INVALID_STATUS_TRANSITION,
  ErrorCode.PROJECT_ARCHIVED,
  ErrorCode.LAST_ADMINISTRATOR,
  ErrorCode.PERMISSION_LOCKED,
  ErrorCode.ROLE_NOT_ALLOWED,
  // Sprint 6
  ErrorCode.PLACE_NAME_TAKEN,
  ErrorCode.PLACE_CODE_TAKEN,
  ErrorCode.PLACE_IN_USE,
  ErrorCode.PLACE_INACTIVE,
  ErrorCode.PLACE_LEVEL_INVALID,
  ErrorCode.PLACE_LIMIT_REACHED,
  ErrorCode.ROLE_EXCEEDS_YOUR_ACCESS,
  ErrorCode.CANNOT_CHANGE_OWN_ROLE,
  ErrorCode.BULK_ADD_REFUSED,
  // Sprint 7
  ErrorCode.WORKFORCE_EMPLOYEE_ID_TAKEN,
  ErrorCode.WORKFORCE_DOCUMENT_NUMBER_TAKEN,
  ErrorCode.WORKFORCE_ARCHIVED,
  ErrorCode.WORKFORCE_NOT_ASSIGNABLE,
  ErrorCode.WORKFORCE_ASSIGNMENT_OVERLAP,
  ErrorCode.WORKFORCE_USER_ALREADY_LINKED,
  ErrorCode.WORKFORCE_RECORD_VOIDED,
  ErrorCode.WORKFORCE_LIMIT_REACHED,
  ErrorCode.WORKFORCE_ARCHIVE_REFUSED,
  ErrorCode.WORKFORCE_CONTACT_LIMIT,
  ErrorCode.BULK_ASSIGN_REFUSED,
  ErrorCode.PROJECT_CLOSED_FOR_ASSIGNMENT,
  ErrorCode.LIST_ITEM_NAME_TAKEN,
  ErrorCode.LIST_ITEM_IN_USE,
  ErrorCode.LIST_ITEM_INACTIVE,
  ErrorCode.LIST_LIMIT_REACHED,
]);

/**
 * Turns any thrown error into a user-friendly, translated message (Master Rules §10).
 * The API's error *code* selects the text; its English message is never shown directly.
 */
export function useErrorMessage(): (error: unknown) => string {
  const t = useTranslations('errors');
  return useCallback(
    (error: unknown) => {
      if (error instanceof ApiClientError && TRANSLATED_CODES.has(error.code)) {
        return t(error.code as 'INVALID_CREDENTIALS', error.params);
      }
      return t('generic');
    },
    [t],
  );
}
