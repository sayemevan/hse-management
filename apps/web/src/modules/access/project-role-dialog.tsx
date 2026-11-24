'use client';

import {
  type ProjectListItemDto,
  type ProjectRole,
  type ProjectRoleAssignmentDto,
  PROJECT_ROLES,
  PROJECT_ROLES_REQUIRING_END_DATE,
  type UserDetailDto,
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
import { projectsService } from '@/modules/projects/projects.service';

import { accessService } from './access.service';

function todayIso(): string {
  const date = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Add a project role, or edit one (US-008): project, role, From and Until (O-48). */
export function ProjectRoleDialog({
  open,
  userId,
  editing,
  onClose,
  onSaved,
}: {
  open: boolean;
  userId: string;
  /** null = add. */
  editing: ProjectRoleAssignmentDto | null;
  onClose: () => void;
  onSaved: (user: UserDetailDto) => void;
}) {
  const t = useTranslations('userAccess');
  const troles = useTranslations('roles');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [projects, setProjects] = useState<ProjectListItemDto[] | null>(null);
  const [projectId, setProjectId] = useState('');
  const [roleCode, setRoleCode] = useState<ProjectRole>('safety_officer');
  const [validFrom, setValidFrom] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [errors, setErrors] = useState<{ project?: string; from?: string; until?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      setProjectId(editing?.projectId ?? '');
      setRoleCode((editing?.roleCode as ProjectRole | undefined) ?? 'safety_officer');
      setValidFrom('');
      setValidUntil(editing?.validUntil ?? '');
      setErrors({});
      setFormError(null);
      if (!editing) {
        projectsService.list('', [], 1).then(
          (page) => {
            setProjects(page.items);
          },
          (error: unknown) => {
            setFormError(errorMessage(error));
          },
        );
      }
      element.showModal();
    }
    if (!open && element.open) element.close();
  }, [open, editing, errorMessage]);

  const needsEnd = PROJECT_ROLES_REQUIRING_END_DATE.includes(roleCode);

  const handleSubmit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const found: typeof errors = {};
    if (!editing && !projectId) found.project = t('projectRequired');
    if (needsEnd && !validUntil) found.until = t('endRequired');
    if (validUntil && validUntil < todayIso()) found.until = t('endInPast');
    if (validFrom && validUntil && validFrom > validUntil) found.from = t('startAfterEnd');
    setErrors(found);
    setFormError(null);
    if (Object.keys(found).length > 0) return;

    setSaving(true);
    try {
      const saved = editing
        ? await accessService.updateProjectRole(userId, editing.id, {
            roleCode,
            validUntil: validUntil || null,
          })
        : await accessService.addProjectRole(userId, {
            projectId,
            roleCode,
            validFrom: validFrom || null,
            validUntil: validUntil || null,
          });
      onSaved(saved);
    } catch (error) {
      setFormError(errorMessage(error));
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
      className="m-0 h-dvh max-h-none w-full max-w-none bg-background p-0 text-foreground backdrop:bg-black/40 sm:m-auto sm:h-auto sm:max-h-[90dvh] sm:w-[calc(100%-2rem)] sm:max-w-lg sm:rounded-xl sm:border sm:border-border sm:shadow-xl"
    >
      <form
        noValidate
        onSubmit={(event) => void handleSubmit(event)}
        className="flex flex-col gap-5 p-6"
      >
        <h2 id={titleId} className="text-xl font-semibold">
          {editing ? t('editProjectRole') : t('addToProject')}
        </h2>
        {formError ? <Alert tone="danger">{formError}</Alert> : null}
        {editing ? (
          <p>
            <bdi dir="ltr" className="font-mono text-muted-foreground">
              {editing.projectCode}
            </bdi>{' '}
            <bdi>{editing.projectName}</bdi>
          </p>
        ) : (
          <FormField
            id="role-project"
            label={t('project')}
            required
            requiredLabel={tc('required')}
            error={errors.project}
          >
            {projects === null ? (
              <Spinner />
            ) : projects.length === 0 ? (
              <p className="text-muted-foreground">{t('noProjects')}</p>
            ) : (
              <Select
                id="role-project"
                value={projectId}
                invalid={Boolean(errors.project)}
                aria-describedby={errors.project ? 'role-project-error' : undefined}
                onChange={(event) => {
                  setProjectId(event.target.value);
                }}
              >
                <option value="">{t('chooseProject')}</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {`${project.code} · ${project.name}`}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
        )}
        <FormField
          id="role-code"
          label={t('role')}
          required
          requiredLabel={tc('required')}
          hint={
            <p id="role-code-hint" className="text-sm text-muted-foreground">
              {troles(`${roleCode}Description` as 'workerDescription')}
            </p>
          }
        >
          <Select
            id="role-code"
            value={roleCode}
            aria-describedby="role-code-hint"
            onChange={(event) => {
              setRoleCode(event.target.value as ProjectRole);
            }}
          >
            {PROJECT_ROLES.map((role) => (
              <option key={role} value={role}>
                {troles(role)}
              </option>
            ))}
          </Select>
        </FormField>
        <div className="grid gap-5 sm:grid-cols-2">
          {editing ? null : (
            <FormField id="role-from" label={t('from')} error={errors.from}>
              <Input
                id="role-from"
                type="date"
                dir="ltr"
                value={validFrom}
                invalid={Boolean(errors.from)}
                aria-describedby={errors.from ? 'role-from-error' : undefined}
                onChange={(event) => {
                  setValidFrom(event.target.value);
                }}
              />
            </FormField>
          )}
          <FormField
            id="role-until"
            label={t('until')}
            required={needsEnd}
            requiredLabel={tc('required')}
            error={errors.until}
            hint={
              needsEnd ? (
                <p id="role-until-hint" className="text-sm text-muted-foreground">
                  {t('endRequiredHint')}
                </p>
              ) : undefined
            }
          >
            <Input
              id="role-until"
              type="date"
              dir="ltr"
              min={todayIso()}
              value={validUntil}
              invalid={Boolean(errors.until)}
              aria-describedby={
                errors.until ? 'role-until-error' : needsEnd ? 'role-until-hint' : undefined
              }
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
          <Button type="submit" disabled={saving}>
            {saving ? <Spinner /> : null}
            {t('save')}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
