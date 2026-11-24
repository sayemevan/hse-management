'use client';

import {
  type InvitableRole,
  INVITABLE_ROLES,
  inviteUserRequestSchema,
  type Language,
  LANGUAGES,
  type UserListItemDto,
} from '@hse/shared';
import { useTranslations } from 'next-intl';
import { type SyntheticEvent, useEffect, useId, useRef, useState } from 'react';

import { FormField } from '@/components/form/form-field';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { useErrorMessage } from '@/modules/i18n/use-error-message';
import { useCompany } from '@/modules/tenant/tenant-provider';
import { ApiClientError } from '@/services/api-client';

import { usersService } from './users.service';

interface Errors {
  fullName?: string;
  email?: string;
}

/**
 * Invite user form (US-006) in a native dialog: full screen on phones, a panel from tablet
 * width. The invitation language defaults to the company language.
 */
export function InviteUserDialog({
  open,
  onClose,
  onInvited,
}: {
  open: boolean;
  onClose: () => void;
  onInvited: (user: UserListItemDto) => void;
}) {
  const t = useTranslations('users');
  const tc = useTranslations('common');
  const tl = useTranslations('language');
  const troles = useTranslations('roles');
  const errorMessage = useErrorMessage();
  const company = useCompany();
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [roleCode, setRoleCode] = useState<InvitableRole>('worker');
  const [language, setLanguage] = useState<Language>(company?.defaultLanguage ?? 'en');
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      setFullName('');
      setEmail('');
      setRoleCode('worker');
      setLanguage(company?.defaultLanguage ?? 'en');
      setErrors({});
      setFormError(null);
      element.showModal();
    }
    if (!open && element.open) element.close();
  }, [open, company?.defaultLanguage]);

  const handleSubmit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = inviteUserRequestSchema.safeParse({ fullName, email, roleCode, language });
    const found: Errors = {};
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        if (issue.path[0] === 'fullName') found.fullName = t('nameInvalid');
        if (issue.path[0] === 'email') found.email = t('emailInvalid');
      }
    }
    setErrors(found);
    setFormError(null);
    if (!parsed.success) return;

    setSending(true);
    try {
      onInvited(await usersService.invite(parsed.data));
    } catch (error) {
      if (error instanceof ApiClientError && error.code === 'EMAIL_IN_USE') {
        setErrors({ email: errorMessage(error) });
      } else {
        setFormError(errorMessage(error));
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      className="m-0 h-dvh max-h-none w-full max-w-none bg-background p-0 text-foreground backdrop:bg-black/40 sm:m-auto sm:h-auto sm:max-h-[90dvh] sm:w-[calc(100%-2rem)] sm:max-w-lg sm:rounded-xl sm:border sm:border-border sm:shadow-xl"
    >
      <form
        noValidate
        onSubmit={(event) => void handleSubmit(event)}
        className="flex flex-col gap-5 p-6"
      >
        <div className="flex flex-col gap-1">
          <h2 id={titleId} className="text-xl font-semibold">
            {t('inviteTitle')}
          </h2>
          <p className="text-muted-foreground">{t('inviteIntro')}</p>
        </div>
        {formError ? <Alert tone="danger">{formError}</Alert> : null}
        <FormField
          id="invite-name"
          label={t('fullName')}
          required
          requiredLabel={tc('required')}
          error={errors.fullName}
        >
          <Input
            id="invite-name"
            maxLength={100}
            value={fullName}
            invalid={Boolean(errors.fullName)}
            aria-describedby={errors.fullName ? 'invite-name-error' : undefined}
            onChange={(event) => {
              setFullName(event.target.value);
            }}
          />
        </FormField>
        <FormField
          id="invite-email"
          label={t('email')}
          required
          requiredLabel={tc('required')}
          error={errors.email}
        >
          <Input
            id="invite-email"
            type="email"
            inputMode="email"
            autoComplete="off"
            dir="ltr"
            maxLength={254}
            value={email}
            invalid={Boolean(errors.email)}
            aria-describedby={errors.email ? 'invite-email-error' : undefined}
            onChange={(event) => {
              setEmail(event.target.value);
            }}
          />
        </FormField>
        <FormField
          id="invite-role"
          label={t('role')}
          required
          requiredLabel={tc('required')}
          hint={
            <p id="invite-role-hint" className="text-sm text-muted-foreground">
              {troles(`${roleCode}Description` as 'workerDescription')}
            </p>
          }
        >
          <Select
            id="invite-role"
            value={roleCode}
            aria-describedby="invite-role-hint"
            onChange={(event) => {
              setRoleCode(event.target.value as InvitableRole);
            }}
          >
            {INVITABLE_ROLES.map((role) => (
              <option key={role} value={role}>
                {troles(role)}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField id="invite-language" label={t('invitationLanguage')}>
          <Select
            id="invite-language"
            value={language}
            onChange={(event) => {
              setLanguage(event.target.value as Language);
            }}
          >
            {LANGUAGES.map((option) => (
              <option key={option} value={option} lang={option}>
                {tl(option)}
              </option>
            ))}
          </Select>
        </FormField>
        <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button type="submit" disabled={sending}>
            {sending ? <Spinner /> : null}
            {sending ? t('sending') : t('send')}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
