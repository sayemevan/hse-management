export {
  collectStuckEmails,
  type EmailConsumerDeps,
  type JobOutcome,
  MAX_EMAIL_ATTEMPTS,
  processEmailJob,
} from './email.consumer';
export { escapeHtml } from './email-layout';
export { emailOutbox } from './email-outbox.schema';
export {
  EmailSendError,
  type EmailSender,
  LogEmailSender,
  type OutgoingEmail,
  ResendEmailSender,
} from './email-senders';
export { type EmailRequest, EmailService, type EnqueuedEmail } from './email.service';
export { EMAIL_TEMPLATES, type EmailTemplateName, renderEmail } from './email-templates';
