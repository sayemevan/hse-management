import { z } from 'zod';

import type { PaginationMeta } from './response';

export const PAGINATION_DEFAULTS = {
  page: 1,
  pageSize: 20,
  maxPageSize: 100,
} as const;

/** Query-string schema for paginated list endpoints (`?page=2&pageSize=50`). */
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(PAGINATION_DEFAULTS.page),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(PAGINATION_DEFAULTS.maxPageSize)
    .default(PAGINATION_DEFAULTS.pageSize),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export function buildPaginationMeta(query: PaginationQuery, total: number): PaginationMeta {
  return {
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / query.pageSize),
  };
}

/** Row offset for a page (for SQL `OFFSET`). */
export function paginationOffset(query: PaginationQuery): number {
  return (query.page - 1) * query.pageSize;
}
