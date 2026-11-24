/**
 * Subscription module — public contract (PLT-06, PLT-10, PLT-12).
 * Data and rules: plans, each company's subscription and its lifecycle, payment records and
 * plan limits. HTTP routes and workflows (payment submission and review, the daily job) live
 * in the billing module, which may depend on identity; this module must not.
 * `plan`, `subscription` and `payment` (tables) are exported for foreign-key references only.
 */
export { planRoutes } from './plan.routes';
export {
  addMonths,
  calendarDaysUntil,
  DAY_MS,
  dueThreshold,
  effectiveState,
  isoDateIn,
  type LifecycleDates,
  type LifecycleSettings,
  nextPeriodStart,
  periodEnd,
  stateAt,
} from './lifecycle';
export { type NewPayment, type PaymentConfirmation, PaymentRepository } from './payment.repository';
export {
  assertWithin,
  firstExceededLimit,
  type LimitedResource,
  limitsOf,
  PlanLimitService,
} from './plan-limit.service';
export {
  PaymentAlreadyPendingError,
  PaymentAlreadyReviewedError,
  PlanLimitReachedError,
  PlanNotAvailableError,
  SubscriptionReadOnlyError,
} from './subscription.errors';
export {
  payment,
  type PaymentRow,
  plan,
  type PlanRow,
  subscription,
  SUBSCRIPTION_STATUSES,
  type SubscriptionRow,
  type SubscriptionStatus,
} from './subscription.schema';
export {
  type ConfirmedPeriod,
  planName,
  type SubscriptionAccess,
  SubscriptionService,
  toPlanDto,
  toRiyals,
  type TrialStart,
} from './subscription.service';
