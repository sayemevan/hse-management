/**
 * Billing module — public contract (Sprint 4).
 *
 * Purpose: the workflows around a subscription: the company's subscription page and payment
 * proofs (PLT-13), the System Owner's review and overview (PLT-14), read-only mode (PLT-11)
 * and the daily lifecycle job with its emails (PLT-10, PLT-15).
 * Dependencies: subscription (data and rules), company, identity (sign-in, permissions,
 * recipients, seats), platform/file-storage, email, reminders, audit-log, jobs.
 * It is separate from the subscription module because identity depends on subscription
 * (seat limits), so subscription must never depend on identity.
 */
export { BillingContext, type BillingDependencies } from './billing.context';
export {
  platformPaymentRoutes,
  platformSubscriptionRoutes,
  subscriptionRoutes,
} from './billing.routes';
export { SUBSCRIPTION_LIFECYCLE_JOB, subscriptionLifecycleJob } from './lifecycle.job';
export {
  enforceSubscriptionAccess,
  isAllowedInReadOnly,
  READ_ONLY_ALLOWED_WRITES,
} from './read-only.middleware';
