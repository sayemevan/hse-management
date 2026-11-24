'use client';

import {
  type CreateWorkforceMemberRequest,
  WORKFORCE_CATEGORIES,
  type WorkforceCategory,
  type WorkforceDuplicatesDto,
  type WorkforceListItemDto,
  type WorkforceMemberDto,
} from '@hse/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { type SyntheticEvent, useCallback, useEffect, useState } from 'react';

import { FormField } from '@/components/form/form-field';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { useLoad } from '@/modules/app/use-load';
import { useErrorMessage } from '@/modules/i18n/use-error-message';
import { countryOptions } from '@/modules/registration/location-options';
import { useCompany } from '@/modules/tenant/tenant-provider';
import { ApiClientError } from '@/services/api-client';

import { workforceService } from './workforce.service';
import { usePositionName } from './workforce-ui';

export interface PersonValues {
  category: WorkforceCategory;
  fullName: string;
  altName: string;
  employeeId: string;
  nationality: string;
  employer: string;
  jobPositionId: string;
  department: string;
  mobile: string;
  email: string;
}

export function valuesOf(member: WorkforceMemberDto | null, companyName: string): PersonValues {
  return {
    category: member?.category ?? 'employee',
    fullName: member?.fullName ?? '',
    altName: member?.altName ?? '',
    employeeId: member?.employeeId ?? '',
    nationality: member?.nationality ?? 'SA',
    employer: member?.employer ?? companyName,
    jobPositionId: member?.position?.id ?? '',
    department: member?.department ?? '',
    mobile: member?.mobile ?? '',
    email: member?.email ?? '',
  };
}

export function requestOf(values: PersonValues): CreateWorkforceMemberRequest {
  return {
    category: values.category,
    fullName: values.fullName,
    altName: values.altName,
    employeeId: values.employeeId,
    nationality: values.nationality,
    employer: values.employer,
    jobPositionId: values.jobPositionId,
    department: values.department,
    mobile: values.mobile,
    email: values.email,
  };
}

type Errors = Partial<Record<keyof PersonValues, string>>;

/** Field errors from a 422 (the API names the field and a message key). */
export function useFieldErrors() {
  const t = useTranslations('workforce.errors');
  return useCallback(
    (error: unknown): Record<string, string> | null => {
      if (!(error instanceof ApiClientError)) return null;
      if (error.code === 'WORKFORCE_EMPLOYEE_ID_TAKEN') {
        return { employeeId: t('employeeIdTaken', { name: String(error.params.name ?? '') }) };
      }
      if (error.code !== 'VALIDATION_FAILED' || error.details.length === 0) return null;
      const result: Record<string, string> = {};
      for (const issue of error.details) {
        const field = issue.path.split('.')[0] ?? '';
        result[field] = t.has(issue.message) ? t(issue.message as 'required') : t('invalid');
      }
      return result;
    },
    [t],
  );
}

/** The fields of a profile (US-024), for New person and Edit details. */
export function PersonFields({
  values,
  errors,
  onChange,
}: {
  values: PersonValues;
  errors: Errors;
  onChange: (values: PersonValues) => void;
}) {
  const t = useTranslations('workforce');
  const tc = useTranslations('common');
  const locale = useLocale();
  const positionName = usePositionName();
  const positions = useLoad<WorkforceListItemDto[]>(
    useCallback(() => workforceService.listItems('job_position'), []),
    'positions',
  );
  const [employers, setEmployers] = useState<string[]>([]);
  const [departments, setDepartments] = useState<string[]>([]);
  const countries = countryOptions(locale);
  const set = <K extends keyof PersonValues>(key: K, value: PersonValues[K]) => {
    onChange({ ...values, [key]: value });
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      workforceService.suggestions('employer', values.employer).then(setEmployers, () => undefined);
    }, 300);
    return () => {
      window.clearTimeout(timer);
    };
  }, [values.employer]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      workforceService
        .suggestions('department', values.department)
        .then(setDepartments, () => undefined);
    }, 300);
    return () => {
      window.clearTimeout(timer);
    };
  }, [values.department]);

  const field = (
    key: keyof PersonValues,
    label: string,
    input: (props: { id: string; invalid: boolean; describedBy?: string }) => React.ReactNode,
    required = false,
  ) => {
    const id = `person-${key}`;
    const error = errors[key];
    return (
      <FormField
        id={id}
        label={label}
        required={required}
        requiredLabel={tc('required')}
        error={error}
      >
        {input({ id, invalid: Boolean(error), ...(error ? { describedBy: `${id}-error` } : {}) })}
      </FormField>
    );
  };

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {field(
        'category',
        t('fields.category'),
        ({ id, invalid }) => (
          <Select
            id={id}
            invalid={invalid}
            value={values.category}
            onChange={(event) => {
              set('category', event.target.value as WorkforceCategory);
            }}
          >
            {WORKFORCE_CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {t(`category.${value}`)}
              </option>
            ))}
          </Select>
        ),
        true,
      )}
      {field(
        'jobPositionId',
        t('fields.jobPosition'),
        ({ id, invalid, describedBy }) => (
          <Select
            id={id}
            invalid={invalid}
            aria-describedby={describedBy}
            value={values.jobPositionId}
            onChange={(event) => {
              set('jobPositionId', event.target.value);
            }}
          >
            <option value="">{t('choose')}</option>
            {(positions.status === 'ready' ? positions.value : []).map((item) => (
              <option key={item.id} value={item.id}>
                {positionName(item)}
              </option>
            ))}
          </Select>
        ),
        true,
      )}
      {field(
        'fullName',
        t('fields.fullName'),
        ({ id, invalid, describedBy }) => (
          <Input
            id={id}
            invalid={invalid}
            aria-describedby={describedBy}
            autoComplete="off"
            value={values.fullName}
            onChange={(event) => {
              set('fullName', event.target.value);
            }}
          />
        ),
        true,
      )}
      {field('altName', t('fields.altName'), ({ id, invalid, describedBy }) => (
        <Input
          id={id}
          invalid={invalid}
          aria-describedby={describedBy}
          autoComplete="off"
          value={values.altName}
          onChange={(event) => {
            set('altName', event.target.value);
          }}
        />
      ))}
      {field('employeeId', t('fields.employeeId'), ({ id, invalid, describedBy }) => (
        <Input
          id={id}
          dir="ltr"
          invalid={invalid}
          aria-describedby={describedBy}
          value={values.employeeId}
          onChange={(event) => {
            set('employeeId', event.target.value);
          }}
        />
      ))}
      {field(
        'nationality',
        t('fields.nationality'),
        ({ id, invalid }) => (
          <Select
            id={id}
            invalid={invalid}
            value={values.nationality}
            onChange={(event) => {
              set('nationality', event.target.value);
            }}
          >
            {[...countries.gcc, ...countries.others].map((country) => (
              <option key={country.code} value={country.code}>
                {country.name}
              </option>
            ))}
          </Select>
        ),
        true,
      )}
      {field(
        'employer',
        t('fields.employer'),
        ({ id, invalid, describedBy }) => (
          <>
            <Input
              id={id}
              list={`${id}-options`}
              invalid={invalid}
              aria-describedby={describedBy}
              value={values.employer}
              onChange={(event) => {
                set('employer', event.target.value);
              }}
            />
            <datalist id={`${id}-options`}>
              {employers.map((value) => (
                <option key={value} value={value} />
              ))}
            </datalist>
          </>
        ),
        true,
      )}
      {field('department', t('fields.department'), ({ id, invalid, describedBy }) => (
        <>
          <Input
            id={id}
            list={`${id}-options`}
            invalid={invalid}
            aria-describedby={describedBy}
            value={values.department}
            onChange={(event) => {
              set('department', event.target.value);
            }}
          />
          <datalist id={`${id}-options`}>
            {departments.map((value) => (
              <option key={value} value={value} />
            ))}
          </datalist>
        </>
      ))}
      {field('mobile', t('fields.mobile'), ({ id, invalid, describedBy }) => (
        <Input
          id={id}
          type="tel"
          dir="ltr"
          invalid={invalid}
          aria-describedby={describedBy}
          value={values.mobile}
          onChange={(event) => {
            set('mobile', event.target.value);
          }}
        />
      ))}
      {field('email', t('fields.email'), ({ id, invalid, describedBy }) => (
        <Input
          id={id}
          type="email"
          dir="ltr"
          invalid={invalid}
          aria-describedby={describedBy}
          value={values.email}
          onChange={(event) => {
            set('email', event.target.value);
          }}
        />
      ))}
    </div>
  );
}

/** Client-side required checks (the API checks everything again). */
export function checkPerson(values: PersonValues, t: (key: 'required') => string): Errors {
  const errors: Errors = {};
  if (values.fullName.trim().length < 2) errors.fullName = t('required');
  if (values.employer.trim().length < 2) errors.employer = t('required');
  if (!values.jobPositionId) errors.jobPositionId = t('required');
  return errors;
}

/** New person (US-024 flow 2) with the duplicate warning (O-80). */
export function NewPersonScreen() {
  const t = useTranslations('workforce');
  const te = useTranslations('workforce.errors');
  const errorMessage = useErrorMessage();
  const fieldErrors = useFieldErrors();
  const company = useCompany();
  const router = useRouter();
  const [values, setValues] = useState<PersonValues>(() => valuesOf(null, company?.name ?? ''));
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<WorkforceDuplicatesDto['duplicates']>([]);
  const [saving, setSaving] = useState(false);

  const save = async (force: boolean) => {
    const found = checkPerson(values, te);
    setErrors(found);
    setFormError(null);
    if (Object.keys(found).length > 0) return;
    setSaving(true);
    try {
      const request = requestOf(values);
      if (!force) {
        const check = await workforceService.duplicates(request);
        if (check.duplicates.length > 0) {
          setDuplicates(check.duplicates);
          return;
        }
      }
      const created = await workforceService.create(request);
      router.push(`/workforce/${created.id}`);
    } catch (error) {
      const fields = fieldErrors(error);
      if (fields) setErrors(fields);
      else setFormError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    void save(false);
  };

  return (
    <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-6">
      <Link
        href="/workforce"
        className="text-sm font-medium text-primary underline-offset-4 hover:underline"
      >
        {t('back')}
      </Link>
      <h1 className="text-2xl font-semibold">{t('newTitle')}</h1>
      {formError ? <Alert tone="danger">{formError}</Alert> : null}
      <PersonFields
        values={values}
        errors={errors}
        onChange={(next) => {
          setValues(next);
          setDuplicates([]);
        }}
      />
      {duplicates.length > 0 ? (
        <Alert tone="warning">
          <div className="flex flex-col gap-2">
            <span>{t('duplicateWarning')}</span>
            <ul className="flex flex-col gap-1">
              {duplicates.map((item) => (
                <li key={item.id}>
                  <Link href={`/workforce/${item.id}`} className="font-medium underline">
                    <bdi>{item.fullName}</bdi>
                  </Link>{' '}
                  <bdi>{item.employer}</bdi>
                </li>
              ))}
            </ul>
            <Button
              type="button"
              variant="secondary"
              disabled={saving}
              onClick={() => void save(true)}
            >
              {t('createAnyway')}
            </Button>
          </div>
        </Alert>
      ) : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="submit" disabled={saving}>
          {saving ? <Spinner /> : null}
          {t('save')}
        </Button>
      </div>
    </form>
  );
}
