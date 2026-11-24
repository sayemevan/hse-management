import type { Logger } from '../../core/logging/logger';

export interface OutgoingEmail {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
}

/** A provider failure. `retryable` is false for errors that will never succeed (bad request). */
export class EmailSendError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'EmailSendError';
  }
}

export interface EmailSender {
  send(email: OutgoingEmail): Promise<{ messageId: string }>;
}

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

/** Resend (ADR-002). The only place that knows the provider's API. */
export class ResendEmailSender implements EmailSender {
  constructor(
    private readonly apiKey: string,
    // Wrapped: Workers reject a detached `fetch` called as a method ("Illegal invocation").
    private readonly fetchImpl: typeof fetch = (input, init) => fetch(input, init),
  ) {}

  async send(email: OutgoingEmail): Promise<{ messageId: string }> {
    let response: Response;
    try {
      response = await this.fetchImpl(RESEND_ENDPOINT, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          from: email.from,
          to: [email.to],
          subject: email.subject,
          html: email.html,
          text: email.text,
        }),
      });
    } catch {
      throw new EmailSendError('network error', true);
    }

    if (response.ok) {
      const body = await response.json<{ id?: string }>().catch(() => ({ id: undefined }));
      return { messageId: body.id ?? 'unknown' };
    }
    const retryable = response.status === 429 || response.status >= 500;
    throw new EmailSendError(`provider responded ${String(response.status)}`, retryable);
  }
}

/** Development and tests: logs the email instead of sending it (EMAIL_PROVIDER=log). */
export class LogEmailSender implements EmailSender {
  constructor(private readonly logger: Logger) {}

  send(email: OutgoingEmail): Promise<{ messageId: string }> {
    this.logger.info('email (log sender)', {
      to: email.to,
      subject: email.subject,
      body: email.text,
    });
    return Promise.resolve({ messageId: `log-${crypto.randomUUID()}` });
  }
}
