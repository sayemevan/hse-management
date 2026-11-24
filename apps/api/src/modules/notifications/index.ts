/**
 * Notification centre module — public contract (Sprint 6, PLT-17).
 *
 * Purpose: the signed-in user's in-app notifications: list, unread count, mark read, open.
 * Dependencies: platform/notification (the one notification service and table), identity
 * (sign-in, permissions to re-check on open, actor names), project (does the project exist).
 * Modules write notifications through `NotificationService` in platform, never here.
 */
export { notificationRoutes } from './notification.routes';
