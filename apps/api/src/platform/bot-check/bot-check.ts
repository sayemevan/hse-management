import type { AppConfig } from '../../config/config';

/** Confirms that a public form was submitted by a person (T-11). */
export interface BotCheck {
  verify(token: string, remoteIp: string | null): Promise<boolean>;
}

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** Cloudflare Turnstile server-side verification. Fails closed on network errors. */
export class TurnstileBotCheck implements BotCheck {
  constructor(
    private readonly secretKey: string,
    // Wrapped: Workers reject a detached `fetch` called as a method ("Illegal invocation").
    private readonly fetchImpl: typeof fetch = (input, init) => fetch(input, init),
  ) {}

  async verify(token: string, remoteIp: string | null): Promise<boolean> {
    const form = new FormData();
    form.set('secret', this.secretKey);
    form.set('response', token);
    if (remoteIp) form.set('remoteip', remoteIp);
    try {
      const response = await this.fetchImpl(TURNSTILE_VERIFY_URL, { method: 'POST', body: form });
      if (!response.ok) return false;
      const result = await response.json<{ success?: boolean }>();
      return result.success === true;
    } catch {
      return false;
    }
  }
}

/** Local development and tests only; the config refuses it elsewhere. */
export const disabledBotCheck: BotCheck = {
  verify: () => Promise.resolve(true),
};

export function botCheckFor(config: AppConfig): BotCheck {
  const { provider, turnstileSecretKey } = config.botCheck;
  if (provider === 'disabled' || !turnstileSecretKey) return disabledBotCheck;
  return new TurnstileBotCheck(turnstileSecretKey);
}
