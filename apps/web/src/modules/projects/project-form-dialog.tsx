'use client';

import {
  createProjectRequestSchema,
  INITIAL_PROJECT_STATUSES,
  PROJECT_LIMITS,
  type ProjectDto,
  updateProjectRequestSchema,
} from '@hse/shared';
import { useLocale, useTranslations } from 'next-intl';
import { type SyntheticEvent, useEffect, useId, useMemo, useRef, useState } from 'react';

import { FormField } from '@/components/form/form-field';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { useErrorMessage } from '@/modules/i18n/use-error-message';
import { countryOptions } from '@/modules/registration/location-options';
import { ApiClientError } from '@/services/api-client';

import { projectsService } from './projects.service';

type Field =
  | 'name'
  | 'code'
  | 'clientName'
  | 'contractNumber'
  | 'description'
  | 'city'
  | 'countryCode'
  | 'startDate'
  | 'expectedEndDate';

interface Values {
  name: string;
  code: string;
  clientName: string;
  contractNumber: string;
  description: string;
  city: string;
  countryCode: string;
  startDate: string;
  expectedEndDate: string;
  status: (typeof INITIAL_PROJECT_STATUSES)[number];
}

function initialValues(project: ProjectDto | null, country: string): Values {
  return {
    name: project?.name ?? '',
    code: project?.code ?? '',
    clientName: project?.clientName ?? '',
    contractNumber: project?.contractNumber ?? '',
    description: project?.description ?? '',
    city: project?.city ?? '',
    countryCode: project?.countryCode ?? country,
    startDate: project?.startDate ?? '',
    expectedEndDate: project?.expectedEndDate ?? '',
    status: 'planning',
  };
}

/**
 * New project (US-016) and edit project (US-017) in a native dialog: full screen on phones,
 * a panel from tablet width. The code can change only in Planning (O-51).
 */
export function ProjectFormDialog({
  open,
  project,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** null = new project. */
  project: ProjectDto | null;
  onClose: () => void;
  onSaved: (project: ProjectDto) => void;
}) {
  const t = useTranslations('projects');
  const ts = useTranslations('projectStatus');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const locale = useLocale();
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const countries = useMemo(() => countryOptions(locale), [locale]);
  const defaultCountry = 'SA';
  const [values, setValues] = useState<Values>(() => initialValues(project, defaultCountry));
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const editing = project !== null;
  const codeLocked = editing && !project.codeEditable;

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      setValues(initialValues(project, defaultCountry));
      setErrors({});
      setFormError(null);
      element.showModal();
    }
    if (!open && element.open) element.close();
  }, [open, project]);

  const set = (field: keyof Values) => (value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
  };

  const messageFor = (field: Field, code: string | undefined): string => {
    if (field === 'code') return t('codeInvalid');
    if (field === 'expectedEndDate' && code === 'endBeforeStart') return t('endBeforeStart');
    if (field === 'startDate') return t('startRequired');
    return t(`${field}Invalid`);
  };

  const handleSubmit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const fields = {
      name: values.name,
      code: values.code,
      clientName: values.clientName,
      contractNumber: values.contractNumber,
      description: values.description,
      city: values.city,
      countryCode: values.countryCode,
      startDate: values.startDate,
      expectedEndDate: values.expectedEndDate || null,
    };
    const parsed = editing
      ? updateProjectRequestSchema.safeParse({
          version: project.version,
          ...fields,
          ...(codeLocked ? { code: undefined } : {}),
        })
      : createProjectRequestSchema.safeParse({ ...fields, status: values.status });
    const found: Partial<Record<Field, string>> = {};
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as Field;
        found[field] ??= messageFor(field, issue.message);
      }
    }
    setErrors(found);
    setFormError(null);
    if (!parsed.success) return;

    setSaving(true);
    try {
      const saved = editing
        ? await projectsService.update(project.id, updateProjectRequestSchema.parse(parsed.data))
        : await projectsService.create(createProjectRequestSchema.parse(parsed.data));
      onSaved(saved);
    } catch (error) {
      if (error instanceof ApiClientError && error.code === 'PROJECT_CODE_TAKEN') {
        setErrors({ code: errorMessage(error) });
      } else {
        setFormError(errorMessage(error));
      }
    } finally {
      setSaving(false);
    }
  };

  const text = (
    field: Field,
    options: { required?: boolean; maxLength: number; dir?: 'ltr'; hint?: string } = {
      maxLength: 120,
    },
  ) => (
    <FormField
      id={`project-${field}`}
      label={t(field)}
      required={options.required}
      requiredLabel={tc('required')}
      error={errors[field]}
      hint={
        options.hint ? (
          <p id={`project-${field}-hint`} className="text-sm text-muted-foreground">
            {options.hint}
          </p>
        ) : undefined
      }
    >
      <Input
        id={`project-${field}`}
        dir={options.dir}
        maxLength={options.maxLength}
        value={values[field]}
        invalid={Boolean(errors[field])}
        aria-describedby={
          errors[field]
            ? `project-${field}-error`
            : options.hint
              ? `project-${field}-hint`
              : undefined
        }
        onChange={(event) => {
          set(field)(event.target.value);
        }}
      />
    </FormField>
  );

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      className="m-0 h-dvh max-h-none w-full max-w-none bg-background p-0 text-foreground backdrop:bg-black/40 sm:m-auto sm:h-auto sm:max-h-[90dvh] sm:w-[calc(100%-2rem)] sm:max-w-2xl sm:rounded-xl sm:border sm:border-border sm:shadow-xl"
    >
      <form
        noValidate
        onSubmit={(event) => void handleSubmit(event)}
        className="flex flex-col gap-5 p-6"
      >
        <h2 id={titleId} className="text-xl font-semibold">
          {editing ? t('editTitle') : t('newTitle')}
        </h2>
        {formError ? <Alert tone="danger">{formError}</Alert> : null}
        {text('name', { required: true, maxLength: PROJECT_LIMITS.nameMax })}
        {codeLocked ? (
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium">{t('code')}</span>
            <bdi dir="ltr" className="text-start font-mono">
              {project.code}
            </bdi>
            <span className="text-sm text-muted-foreground">{t('codeLockedHint')}</span>
          </div>
        ) : (
          <FormField
            id="project-code"
            label={t('code')}
            required
            requiredLabel={tc('required')}
            error={errors.code}
            hint={
              <p id="project-code-hint" className="text-sm text-muted-foreground">
                {t('codeHint')}
              </p>
            }
          >
            <Input
              id="project-code"
              dir="ltr"
              autoCapitalize="characters"
              className="font-mono uppercase"
              maxLength={PROJECT_LIMITS.codeMax}
              value={values.code}
              invalid={Boolean(errors.code)}
              aria-describedby={errors.code ? 'project-code-error' : 'project-code-hint'}
              onChange={(event) => {
                set('code')(event.target.value.toUpperCase());
              }}
            />
          </FormField>
        )}
        <div className="grid gap-5 sm:grid-cols-2">
          {text('clientName', { required: true, maxLength: PROJECT_LIMITS.clientMax })}
          {text('contractNumber', { maxLength: PROJECT_LIMITS.contractMax, dir: 'ltr' })}
        </div>
        <FormField id="project-description" label={t('description')} error={errors.description}>
          <Textarea
            id="project-description"
            rows={3}
            maxLength={PROJECT_LIMITS.descriptionMax}
            value={values.description}
            onChange={(event) => {
              set('description')(event.target.value);
            }}
          />
        </FormField>
        <div className="grid gap-5 sm:grid-cols-2">
          {text('city', { maxLength: PROJECT_LIMITS.cityMax })}
          <FormField
            id="project-countryCode"
            label={t('countryCode')}
            required
            requiredLabel={tc('required')}
            error={errors.countryCode}
          >
            <Select
              id="project-countryCode"
              value={values.countryCode}
              onChange={(event) => {
                set('countryCode')(event.target.value);
              }}
            >
              {[...countries.gcc, ...countries.others].map((option) => (
                <option key={option.code} value={option.code}>
                  {option.name}
                </option>
              ))}
            </Select>
          </FormField>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <FormField
            id="project-startDate"
            label={t('startDate')}
            required
            requiredLabel={tc('required')}
            error={errors.startDate}
          >
            <Input
              id="project-startDate"
              type="date"
              dir="ltr"
              value={values.startDate}
              invalid={Boolean(errors.startDate)}
              aria-describedby={errors.startDate ? 'project-startDate-error' : undefined}
              onChange={(event) => {
                set('startDate')(event.target.value);
              }}
            />
          </FormField>
          <FormField
            id="project-expectedEndDate"
            label={t('expectedEndDate')}
            error={errors.expectedEndDate}
          >
            <Input
              id="project-expectedEndDate"
              type="date"
              dir="ltr"
              min={values.startDate || undefined}
              value={values.expectedEndDate}
              invalid={Boolean(errors.expectedEndDate)}
              aria-describedby={
                errors.expectedEndDate ? 'project-expectedEndDate-error' : undefined
              }
              onChange={(event) => {
                set('expectedEndDate')(event.target.value);
              }}
            />
          </FormField>
        </div>
        {editing ? null : (
          <FormField id="project-status" label={t('firstStatus')}>
            <Select
              id="project-status"
              value={values.status}
              onChange={(event) => {
                set('status')(event.target.value);
              }}
            >
              {INITIAL_PROJECT_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {ts(status)}
                </option>
              ))}
            </Select>
          </FormField>
        )}
        <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? <Spinner /> : null}
            {editing ? t('save') : t('create')}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
