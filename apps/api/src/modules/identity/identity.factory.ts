import type { Context } from 'hono';

import { type SessionValidator, tokenServiceFor } from '../../core/auth/authenticate.middleware';
import type { AppEnv } from '../../core/context/app-context';
import { UnauthenticatedError } from '../../core/errors/app-error';
import { requestMeta } from '../../core/http/request-meta';
import { createDatabase } from '../../database/client';
import { AccountService } from './account.service';
import { AuthService } from './auth.service';
import { IdentityContext } from './identity.context';
import { InvitationService } from './invitation.service';
import { PasswordResetService } from './password-reset.service';
import type { UserRow } from './identity.schema';
import { SessionService } from './session.service';

// The signed-in account for the current request, set by the session validator.
const accounts = new WeakMap<Request, UserRow>();

/** The signed-in account. Only valid behind `authenticate(validateIdentitySession)`. */
export function currentAccount(c: Context<AppEnv>): UserRow {
  const account = accounts.get(c.req.raw);
  if (!account) throw new UnauthenticatedError();
  return account;
}

export function identityContextFor(c: Context<AppEnv>): IdentityContext {
  return new IdentityContext({
    db: createDatabase(c.env.DB),
    config: c.get('config'),
    tenant: c.get('tenant'),
    meta: requestMeta(c),
    logger: c.get('logger'),
    queue: c.env.JOBS,
    clock: Date.now,
  });
}

export function identityServicesFor(c: Context<AppEnv>) {
  const ctx = identityContextFor(c);
  const auth = new AuthService(ctx, tokenServiceFor(c));
  return {
    auth,
    sessions: new SessionService(ctx),
    account: new AccountService(ctx),
    passwordReset: new PasswordResetService(ctx),
    invitations: new InvitationService(ctx, auth),
  };
}

/** The session validator plugged into core `authenticate()` (T-2). */
export const validateIdentitySession: SessionValidator = async (c, principal) => {
  const account = await new SessionService(identityContextFor(c)).validate(principal);
  accounts.set(c.req.raw, account);
};
