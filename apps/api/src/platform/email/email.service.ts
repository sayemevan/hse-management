import { generateId, type Language } from '@hse/shared';

import type { Database } from '../../database/client';
import type { Statement } from '../../database/unit-of-work';
import type { JobMessage } from '../jobs';
import { emailOutbox } from './email-outbox.schema';
import {
  type EmailTemplateData,
  type EmailTemplateName,
  renderEmail,
  templateHasSecrets,
} from './email-templates';

export interface EmailRequest<T extends EmailTemplateName> {
  template: T;
  to: string;
  language: Language;
  data: EmailTemplateData<T>;
  /** Secret link values (T-10); only for templates that declare secrets. */
  secrets?: Record<string, string>;
  companyId?: string | null;
}

export interface EnqueuedEmail {
  /** Add to the caller's UnitOfWork so the email exists only if the change succeeds. */
  statement: Statement;
  /** Publish after the commit (`publishJobs`). */
  job: JobMessage;
}

/** The single entry point for sending email (Master Rules §6, PLT-05). */
export class EmailService {
  constructor(
    private readonly db: Database,
    private readonly clock: () => number = Date.now,
  ) {}

  enqueue<T extends EmailTemplateName>(request: EmailRequest<T>): EnqueuedEmail {
    // Rendering validates data and secrets now, so a bad call fails the request, not the job.
    renderEmail(request.template, request.language, request.data, request.secrets);

    const id = generateId();
    const statement = this.db.insert(emailOutbox).values({
      id,
      template: request.template,
      recipient: request.to,
      language: request.language,
      data: JSON.stringify(request.data),
      hasSecrets: templateHasSecrets(request.template),
      status: 'queued',
      companyId: request.companyId ?? null,
      createdAt: new Date(this.clock()),
    });
    const job: JobMessage = {
      type: 'email.send',
      outboxId: id,
      ...(request.secrets ? { secrets: request.secrets } : {}),
    };
    return { statement, job };
  }
}
