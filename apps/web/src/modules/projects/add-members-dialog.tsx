'use client';

import {
  MEMBER_BULK_MAX,
  type MemberCandidateDto,
  PROJECT_ROLES_REQUIRING_END_DATE,
  type ProjectMemberDto,
  type ProjectRole,
} from '@hse/shared';
import { X } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { type SyntheticEvent, useEffect, useId, useRef, useState } from 'react';

import { FormField } from '@/components/form/form-field';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { useAuth } from '@/modules/auth/auth-provider';
import { hasPermission } from '@/modules/auth/require-permission';
import { useErrorMessage } from '@/modules/i18n/use-error-message';
import { ApiClientError } from '@/services/api-client';

import { membersService } from './structure.service';

function todayIso(): string {
  const date = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const dialogClass =
  'm-0 h-dvh max-h-none w-full max-w-none bg-background p-0 text-foreground backdrop:bg-black/40 sm:m-auto sm:h-auto sm:max-h-[90dvh] sm:w-[calc(100%-2rem)] sm:max-w-lg sm:rounded-xl sm:border sm:border-border sm:shadow-xl';

/** US-022: add one or several people with the same role and dates (O-68, O-69). */
export function AddMembersDialog({
  open,
  projectId,
  onClose,
  onSaved,
}: {
  open: boolean;
  projectId: string;
  onClose: () => void;
  onSaved: (count: number) => void;
}) {
  const t = useTranslations('members');
  const troles = useTranslations('roles');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const { user } = useAuth();
  const titleId = useId();
  const [search, setSearch] = useState('');
  const [candidates, setCandidates] = useState<MemberCandidateDto[] | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const [selected, setSelected] = useState<MemberCandidateDto[]>([]);
  const [roleCode, setRoleCode] = useState<string>('');
  const [validFrom, setValidFrom] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [errors, setErrors] = useState<{ users?: string; until?: string; from?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      setSearch('');
      setSelected([]);
      setRoleCode('');
      setValidFrom('');
      setValidUntil('');
      setErrors({});
      setFormError(null);
      element.showModal();
    }
    if (!open && element.open) element.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      membersService.candidates(projectId, search).then(
        (result) => {
          setCandidates(result.items);
          setRoles(result.assignableRoles);
          setRoleCode((current) => (current || result.assignableRoles[0]) ?? '');
        },
        (error: unknown) => {
          setFormError(errorMessage(error));
        },
      );
    }, 250);
    return () => {
      window.clearTimeout(timer);
    };
  }, [open, projectId, search, errorMessage]);

  const needsEnd = PROJECT_ROLES_REQUIRING_END_DATE.includes(roleCode as ProjectRole);

  const toggle = (candidate: MemberCandidateDto) => {
    setSelected((current) =>
      current.some((item) => item.id === candidate.id)
        ? current.filter((item) => item.id !== candidate.id)
        : current.length >= MEMBER_BULK_MAX
          ? current
          : [...current, candidate],
    );
  };

  const handleSubmit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const found: typeof errors = {};
    if (selected.length === 0) found.users = t('chooseSomeone');
    if (needsEnd && !validUntil) found.until = t('endRequired');
    if (validUntil && validUntil < todayIso()) found.until = t('endInPast');
    if (validFrom && validUntil && validFrom > validUntil) found.from = t('startAfterEnd');
    setErrors(found);
    setFormError(null);
    if (Object.keys(found).length > 0 || !roleCode) return;
    setSaving(true);
    try {
      await membersService.add(projectId, {
        userIds: selected.map((item) => item.id),
        roleCode: roleCode as ProjectRole,
        validFrom: validFrom || null,
        validUntil: validUntil || null,
      });
      onSaved(selected.length);
    } catch (error) {
      if (error instanceof ApiClientError && error.code === 'BULK_ADD_REFUSED') {
        const names = new Map(selected.map((item) => [item.id, item.fullName]));
        setFormError(
          [
            t('bulkRefused'),
            ...error.details.map((issue) =>
              t(`refused.${issue.message}` as 'refused.alreadyOnProject', {
                name: names.get(issue.path) ?? '',
              }),
            ),
          ].join(' '),
        );
      } else {
        setFormError(errorMessage(error));
      }
    } finally {
      setSaving(false);
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
      className={dialogClass}
    >
      <form
        noValidate
        onSubmit={(event) => void handleSubmit(event)}
        className="flex flex-col gap-5 p-6"
      >
        <h2 id={titleId} className="text-xl font-semibold">
          {t('addTitle')}
        </h2>
        {formError ? <Alert tone="danger">{formError}</Alert> : null}

        <FormField
          id="member-search"
          label={t('people')}
          required
          requiredLabel={tc('required')}
          error={errors.users}
        >
          <Input
            id="member-search"
            type="search"
            value={search}
            placeholder={t('searchPeople')}
            onChange={(event) => {
              setSearch(event.target.value);
            }}
          />
        </FormField>
        {selected.length > 0 ? (
          <ul
            className="flex flex-wrap gap-2"
            aria-label={t('selected', { count: selected.length })}
          >
            {selected.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className="inline-flex min-h-10 items-center gap-1 rounded-full bg-muted px-3 text-sm"
                  aria-label={t('unselect', { name: item.fullName })}
                  onClick={() => {
                    toggle(item);
                  }}
                >
                  <bdi>{item.fullName}</bdi>
                  <X aria-hidden className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="max-h-60 overflow-y-auto rounded-lg border border-border">
          {candidates === null ? (
            <div className="flex justify-center p-4" role="status">
              <Spinner />
            </div>
          ) : candidates.length === 0 ? (
            <p className="p-4 text-muted-foreground">{t('noCandidates')}</p>
          ) : (
            <ul className="divide-y divide-border">
              {candidates.map((candidate) => {
                const blocked = candidate.onProject || candidate.companyWide;
                const checked = selected.some((item) => item.id === candidate.id);
                return (
                  <li key={candidate.id}>
                    <label
                      className={`flex min-h-12 items-center gap-3 p-3 ${blocked ? 'opacity-60' : 'cursor-pointer'}`}
                    >
                      <input
                        type="checkbox"
                        className="size-5"
                        disabled={blocked}
                        checked={checked}
                        onChange={() => {
                          toggle(candidate);
                        }}
                      />
                      <span className="flex flex-col">
                        <bdi className="font-medium">{candidate.fullName}</bdi>
                        <span className="text-sm text-muted-foreground">
                          {candidate.onProject ? (
                            t('alreadyOnProject')
                          ) : candidate.companyWide ? (
                            t('seesAllProjects')
                          ) : candidate.status === 'pending_invitation' ? (
                            t('invited')
                          ) : (
                            <bdi dir="ltr">{candidate.email}</bdi>
                          )}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        {hasPermission(user, 'users.invite') ? (
          <Link
            href="/settings/users"
            className="text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            {t('inviteNew')}
          </Link>
        ) : null}

        <FormField id="member-role" label={t('role')} required requiredLabel={tc('required')}>
          <Select
            id="member-role"
            value={roleCode}
            onChange={(event) => {
              setRoleCode(event.target.value);
            }}
          >
            {roles.map((role) => (
              <option key={role} value={role}>
                {troles(role as 'worker')}
              </option>
            ))}
          </Select>
        </FormField>
        <div className="grid gap-5 sm:grid-cols-2">
          <FormField id="member-from" label={t('from')} error={errors.from}>
            <Input
              id="member-from"
              type="date"
              dir="ltr"
              value={validFrom}
              invalid={Boolean(errors.from)}
              onChange={(event) => {
                setValidFrom(event.target.value);
              }}
            />
          </FormField>
          <FormField
            id="member-until"
            label={t('until')}
            required={needsEnd}
            requiredLabel={tc('required')}
            error={errors.until}
          >
            <Input
              id="member-until"
              type="date"
              dir="ltr"
              min={todayIso()}
              value={validUntil}
              invalid={Boolean(errors.until)}
              onChange={(event) => {
                setValidUntil(event.target.value);
              }}
            />
          </FormField>
        </div>
        <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button type="submit" disabled={saving || !roleCode}>
            {saving ? <Spinner /> : null}
            {selected.length > 1 ? t('addCount', { count: selected.length }) : t('add')}
          </Button>
        </div>
      </form>
    </dialog>
  );
}

/** US-022: change a member's role or end date. */
export function EditMemberDialog({
  projectId,
  member,
  assignableRoles,
  onClose,
  onSaved,
}: {
  projectId: string;
  member: ProjectMemberDto | null;
  assignableRoles: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations('members');
  const troles = useTranslations('roles');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const titleId = useId();
  const [roleCode, setRoleCode] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (member && !element.open) {
      setRoleCode(member.roleCode);
      setValidUntil(member.validUntil ?? '');
      setError(null);
      element.showModal();
    }
    if (!member && element.open) element.close();
  }, [member]);
  const needsEnd = PROJECT_ROLES_REQUIRING_END_DATE.includes(roleCode as ProjectRole);
  const roles = [...new Set([...(member ? [member.roleCode] : []), ...assignableRoles])];

  const handleSubmit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!member) return;
    if (needsEnd && !validUntil) {
      setError(t('endRequired'));
      return;
    }
    setSaving(true);
    try {
      await membersService.update(projectId, member.assignmentId, {
        roleCode: roleCode as ProjectRole,
        validUntil: validUntil || null,
      });
      onSaved();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setSaving(false);
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
      className={dialogClass}
    >
      <form
        noValidate
        onSubmit={(event) => void handleSubmit(event)}
        className="flex flex-col gap-5 p-6"
      >
        <h2 id={titleId} className="text-xl font-semibold">
          {t('editTitle', { name: member?.user.fullName ?? '' })}
        </h2>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <FormField id="edit-member-role" label={t('role')} required requiredLabel={tc('required')}>
          <Select
            id="edit-member-role"
            value={roleCode}
            onChange={(event) => {
              setRoleCode(event.target.value);
            }}
          >
            {roles.map((role) => (
              <option key={role} value={role}>
                {troles(role as 'worker')}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField
          id="edit-member-until"
          label={t('until')}
          required={needsEnd}
          requiredLabel={tc('required')}
        >
          <Input
            id="edit-member-until"
            type="date"
            dir="ltr"
            min={todayIso()}
            value={validUntil}
            onChange={(event) => {
              setValidUntil(event.target.value);
            }}
          />
        </FormField>
        <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? <Spinner /> : null}
            {t('save')}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
