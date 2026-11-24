'use client';

import {
  type ActivityEntryDto,
  CONTACT_RELATIONSHIPS,
  type ContactRelationship,
  type EmergencyContactDto,
  type WorkforceMemberDto,
  WORKFORCE_LIMITS,
} from '@hse/shared';
import { Phone } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';

import { FormField } from '@/components/form/form-field';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { useLoad } from '@/modules/app/use-load';
import { useReadOnly } from '@/modules/billing/use-subscription-state';
import { useDateFormat } from '@/modules/i18n/use-date-format';
import { useErrorMessage } from '@/modules/i18n/use-error-message';
import { TimelineDays } from '@/modules/projects/timeline-screen';

import { useFieldErrors } from './person-form';
import { workforceService } from './workforce.service';
import { FormDialog, usePositionName } from './workforce-ui';

/** US-025 flow 5: every assignment of the person, newest first. */
export function AssignmentsTab({ member }: { member: WorkforceMemberDto }) {
  const t = useTranslations('workforce');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const { calendarDate } = useDateFormat();
  const positionName = usePositionName();
  const loaded = useLoad(
    useCallback(() => workforceService.assignments(member.id), [member.id]),
    member.id,
  );
  if (loaded.status === 'error') return <Alert tone="danger">{errorMessage(loaded.error)}</Alert>;
  if (loaded.status === 'loading') {
    return (
      <div className="flex items-center gap-3" role="status">
        <Spinner />
        {tc('loading')}
      </div>
    );
  }
  if (loaded.value.items.length === 0) {
    return <p className="text-muted-foreground">{t('assignments.empty')}</p>;
  }
  return (
    <ul className="flex flex-col gap-2">
      {loaded.value.items.map((row) => (
        <li key={row.id} className="flex flex-col gap-1 rounded-xl border border-border p-4">
          <Link
            href={`/projects/${row.project.id}/workforce`}
            className="font-medium hover:underline"
          >
            <bdi dir="ltr" className="font-mono">
              {row.project.code}
            </bdi>{' '}
            · <bdi>{row.project.name}</bdi>
          </Link>
          <span className="text-sm text-muted-foreground">
            {positionName(row.position)} ·{' '}
            {t('assignments.range', {
              from: calendarDate(row.startDate),
              to: row.endDate ? calendarDate(row.endDate) : t('assignments.open'),
            })}
          </span>
          <span className="w-fit rounded-full bg-muted px-2 text-xs font-medium">
            {t(`assignments.state.${row.state}`)}
          </span>
        </li>
      ))}
    </ul>
  );
}

interface ContactDraft {
  name: string;
  relationship: ContactRelationship;
  phone: string;
  phoneAlt: string;
}

/** US-029: up to 3 contacts in order, edited as one list. */
export function ContactsTab({
  member,
  onChanged,
}: {
  member: WorkforceMemberDto;
  onChanged: () => void;
}) {
  const t = useTranslations('workforce.contacts');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const fieldErrors = useFieldErrors();
  const readOnly = useReadOnly();
  const [items, setItems] = useState<EmergencyContactDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [drafts, setDrafts] = useState<ContactDraft[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    workforceService.contacts(member.id).then(
      (result) => {
        setItems(result.items);
      },
      (failure: unknown) => {
        setError(errorMessage(failure));
      },
    );
  }, [member.id, errorMessage]);

  const relationship = useTranslations('workforce.relationship');
  const canEdit = !readOnly && member.can.editContacts;

  const startEditing = () => {
    setDrafts(
      (items ?? []).map((item) => ({
        name: item.name,
        relationship: item.relationship,
        phone: item.phone,
        phoneAlt: item.phoneAlt ?? '',
      })),
    );
    setFormError(null);
    setEditing(true);
  };
  const update = (index: number, patch: Partial<ContactDraft>) => {
    setDrafts((current) => current.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  };
  const move = (index: number, delta: number) => {
    setDrafts((current) => {
      const next = [...current];
      const [item] = next.splice(index, 1);
      if (item) next.splice(index + delta, 0, item);
      return next;
    });
  };

  return (
    <div className="flex flex-col gap-4">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {items === null && !error ? (
        <div className="flex items-center gap-3" role="status">
          <Spinner />
          {tc('loading')}
        </div>
      ) : null}
      {items?.length === 0 ? <Alert tone="warning">{t('none')}</Alert> : null}
      {items && items.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <li
              key={item.position}
              className="flex flex-col gap-1 rounded-xl border border-border p-4"
            >
              <span className="text-xs font-medium text-muted-foreground">
                {item.position === 1
                  ? t('primary')
                  : item.position === 2
                    ? t('secondary')
                    : t('other')}
              </span>
              <bdi className="font-medium">{item.name}</bdi>
              <span className="text-sm text-muted-foreground">
                {relationship(item.relationship)}
              </span>
              {[item.phone, item.phoneAlt].filter(Boolean).map((phone) => (
                <a
                  key={phone}
                  href={`tel:${phone ?? ''}`}
                  className="inline-flex min-h-12 w-fit items-center gap-2 font-medium text-primary"
                >
                  <Phone aria-hidden className="size-4" />
                  <bdi dir="ltr">{phone}</bdi>
                </a>
              ))}
            </li>
          ))}
        </ul>
      ) : null}
      {canEdit && items ? (
        <Button variant="secondary" className="w-fit" onClick={startEditing}>
          {t('edit')}
        </Button>
      ) : null}
      <FormDialog
        open={editing}
        title={t('editTitle')}
        error={formError}
        saving={saving}
        submitLabel={t('save')}
        cancelLabel={tc('cancel')}
        onClose={() => {
          setEditing(false);
        }}
        onSubmit={() => {
          setSaving(true);
          setFormError(null);
          workforceService
            .saveContacts(member.id, {
              items: drafts.map((draft) => ({ ...draft, phoneAlt: draft.phoneAlt || null })),
            })
            .then(
              (result) => {
                setItems(result.items);
                setEditing(false);
                onChanged();
              },
              (failure: unknown) => {
                const fields = fieldErrors(failure);
                setFormError(fields ? t('checkFields') : errorMessage(failure));
              },
            )
            .finally(() => {
              setSaving(false);
            });
        }}
      >
        {drafts.map((draft, index) => (
          <fieldset key={index} className="flex flex-col gap-3 rounded-xl border border-border p-4">
            <legend className="px-1 text-sm font-medium">
              {index === 0 ? t('primary') : index === 1 ? t('secondary') : t('other')}
            </legend>
            <FormField
              id={`contact-name-${String(index)}`}
              label={t('name')}
              required
              requiredLabel={tc('required')}
            >
              <Input
                id={`contact-name-${String(index)}`}
                value={draft.name}
                onChange={(event) => {
                  update(index, { name: event.target.value });
                }}
              />
            </FormField>
            <FormField
              id={`contact-rel-${String(index)}`}
              label={t('relationship')}
              required
              requiredLabel={tc('required')}
            >
              <Select
                id={`contact-rel-${String(index)}`}
                value={draft.relationship}
                onChange={(event) => {
                  update(index, { relationship: event.target.value as ContactRelationship });
                }}
              >
                {CONTACT_RELATIONSHIPS.map((value) => (
                  <option key={value} value={value}>
                    {relationship(value)}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField
              id={`contact-phone-${String(index)}`}
              label={t('phone')}
              required
              requiredLabel={tc('required')}
            >
              <Input
                id={`contact-phone-${String(index)}`}
                type="tel"
                dir="ltr"
                value={draft.phone}
                onChange={(event) => {
                  update(index, { phone: event.target.value });
                }}
              />
            </FormField>
            <FormField id={`contact-alt-${String(index)}`} label={t('phoneAlt')}>
              <Input
                id={`contact-alt-${String(index)}`}
                type="tel"
                dir="ltr"
                value={draft.phoneAlt}
                onChange={(event) => {
                  update(index, { phoneAlt: event.target.value });
                }}
              />
            </FormField>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                disabled={index === 0}
                onClick={() => {
                  move(index, -1);
                }}
              >
                {t('moveUp')}
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={index === drafts.length - 1}
                onClick={() => {
                  move(index, 1);
                }}
              >
                {t('moveDown')}
              </Button>
              <Button
                type="button"
                variant="danger"
                onClick={() => {
                  setDrafts((current) => current.filter((_, i) => i !== index));
                }}
              >
                {t('remove')}
              </Button>
            </div>
          </fieldset>
        ))}
        {drafts.length < WORKFORCE_LIMITS.contactsMax ? (
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setDrafts((current) => [
                ...current,
                { name: '', relationship: 'spouse', phone: '', phoneAlt: '' },
              ]);
            }}
          >
            {t('add')}
          </Button>
        ) : null}
      </FormDialog>
    </div>
  );
}

/** T-56: the profile's History tab, newest first. */
export function HistoryTab({ member }: { member: WorkforceMemberDto }) {
  const t = useTranslations('timeline');
  const errorMessage = useErrorMessage();
  const [items, setItems] = useState<ActivityEntryDto[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(
    (before: string | null) => {
      workforceService.history(member.id, before).then(
        (page) => {
          setItems((current) => (before && current ? [...current, ...page.items] : page.items));
          setNext(page.nextBefore);
        },
        (failure: unknown) => {
          setError(errorMessage(failure));
          setItems((current) => current ?? []);
        },
      );
    },
    [member.id, errorMessage],
  );
  useEffect(() => {
    load(null);
  }, [load]);
  return (
    <div className="flex flex-col gap-4">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {items === null ? (
        <div className="flex justify-center p-6" role="status">
          <Spinner />
        </div>
      ) : items.length === 0 ? (
        <p className="text-muted-foreground">{t('emptyProfile')}</p>
      ) : (
        <TimelineDays items={items} />
      )}
      {next ? (
        <Button
          variant="secondary"
          onClick={() => {
            load(next);
          }}
        >
          {t('loadMore')}
        </Button>
      ) : null}
    </div>
  );
}
