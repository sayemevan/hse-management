import type { LimitsDto, UsageDto } from '@hse/shared';

import type { PlanRow } from './subscription.schema';
import { PlanLimitReachedError } from './subscription.errors';
import type { SubscriptionService } from './subscription.service';

export type LimitedResource = 'users' | 'projects' | 'storage';

/**
 * Plan limits (PLT-12, T-29). The modules that own the data count it (seats in identity,
 * bytes in the file service, projects in Sprint 5) and pass the count in; this service only
 * knows the limits, so no module reads another's tables.
 */
export class PlanLimitService {
  constructor(private readonly subscriptions: SubscriptionService) {}

  async limitsFor(companyId: string): Promise<LimitsDto | null> {
    const current = await this.subscriptions.forCompany(companyId);
    return current ? limitsOf(current.plan) : null;
  }

  /** FR-1: refuses adding `amount` when `used + amount` passes the limit. `NULL` = unlimited. */
  async assertCanAdd(
    companyId: string,
    resource: LimitedResource,
    used: number,
    amount = 1,
  ): Promise<void> {
    const limits = await this.limitsFor(companyId);
    if (!limits) return;
    assertWithin(limits, resource, used, amount);
  }
}

export function limitsOf(row: PlanRow): LimitsDto {
  return { users: row.maxUsers, projects: row.maxProjects, storageBytes: row.maxStorageBytes };
}

export function assertWithin(
  limits: LimitsDto,
  resource: LimitedResource,
  used: number,
  amount: number,
): void {
  const limit = resource === 'storage' ? limits.storageBytes : limits[resource];
  if (limit === null) return;
  if (used + amount > limit) throw new PlanLimitReachedError(resource, limit, used);
}

/** FR-9 / O-34: the first limit current usage is over on a plan, or null if it fits. */
export function firstExceededLimit(row: PlanRow, usage: UsageDto): LimitedResource | null {
  const limits = limitsOf(row);
  if (limits.users !== null && usage.users > limits.users) return 'users';
  if (limits.projects !== null && usage.projects > limits.projects) return 'projects';
  if (usage.storageBytes > limits.storageBytes) return 'storage';
  return null;
}
