import type { ErrorCode } from './error-codes';

/** Pagination metadata returned in `meta` for list endpoints. */
export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export type ResponseMeta = Record<string, unknown> & Partial<PaginationMeta>;

/** One field-level validation problem. `path` uses dot notation, e.g. `items.0.title`. */
export interface ValidationIssue {
  path: string;
  message: string;
}

/** Success envelope (API Rules: success, message, data, meta). */
export interface ApiSuccess<TData> {
  success: true;
  message: string;
  data: TData;
  meta?: ResponseMeta;
}

/** Error envelope. `message` is always safe to show to end users. */
export interface ApiFailure {
  success: false;
  message: string;
  error: {
    code: ErrorCode;
    requestId?: string;
    details?: ValidationIssue[];
    /** Values for the translated message, e.g. `{ minutes: 12 }` (PLT-03: the web app translates by code). */
    params?: Record<string, string | number>;
  };
}

export type ApiResponse<TData> = ApiSuccess<TData> | ApiFailure;

export function isApiFailure(value: unknown): value is ApiFailure {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { success?: unknown }).success === false &&
    typeof (value as { error?: unknown }).error === 'object'
  );
}
