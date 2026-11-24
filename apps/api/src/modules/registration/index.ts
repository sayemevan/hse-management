/**
 * Registration module — public contract (US-011.1 – US-011.5).
 *
 * Purpose: a company applies for the platform and the System Owner decides.
 * Responsibilities: applications, email verification, review (approve / reject), resubmission,
 * and housekeeping of unfinished applications (O-15).
 * Dependencies: company, identity and subscription (provisioning on approval, through their
 * public services); platform email, one-time tokens, bot check, audit log.
 */
export { platformRegistrationRoutes, registrationRoutes } from './registration.routes';
export { RegistrationContext, type RegistrationDependencies } from './registration.context';
export { runRegistrationMaintenance } from './registration-maintenance';
export { companyRegistration, registrationReview } from './registration.schema';
