'use client';

import {
  ACTION_LIMITS,
  ACTION_PRIORITIES,
  ACTION_TYPES,
  type ActionDto,
  type ActionPriority,
  type ActionType,
  addIsoDays,
  type PlaceSelection,
} from '@hse/shared';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type SyntheticEvent, useEffect, useState } from 'react';

import { FormField } from '@/components/form/form-field';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/modules/auth/auth-provider';
import { useErrorMessage } from '@/modules/i18n/use-error-message';
import { PlacePicker } from '@/modules/projects/place-picker';
import { useCurrentProject } from '@/modules/projects/project-context';
import { todayIso } from '@/modules/workforce/workforce-ui';
import { ApiClientError } from '@/services/api-client';

import { actionsService } from './actions.service';
import { PeopleField, PersonSelect } from './person-select';

const QUICK_DAYS = [1, 3, 7, 14] as const;

/** US-053: New action (a page on desktop, full width on phones). */
export function NewActionScreen() {
  const t = useTranslations('actions');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const router = useRouter();
  const params = useSearchParams();
  const followUpOf = params.get('followUpOf');
  const { project } = useCurrentProject();
  const { user } = useAuth();
  const [today] = useState(todayIso);
  const [title, setTitle] = useState('');
  const [type, setType] = useState<ActionType>('corrective');
  const [priority, setPriority] = useState<ActionPriority>('medium');
  const [owner, setOwner] = useState<{ id: string; name: string }>({ id: '', name: '' });
  const [dueOn, setDueOn] = useState(addIsoDays(today, 7));
  const [description, setDescription] = useState('');
  const [place, setPlace] = useState<PlaceSelection>({});
  const [collaborators, setCollaborators] = useState<{ id: string; name: string }[]>([]);
  const [source, setSource] = useState<ActionDto | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // O-97: a follow-up starts from the closed action.
  useEffect(() => {
    if (!followUpOf) return;
    actionsService.get(project.id, followUpOf).then(
      (closed) => {
        setSource(closed);
        setTitle(t('followUpTitle', { title: closed.title }).slice(0, ACTION_LIMITS.titleMax));
        setType(closed.type);
        setDescription(closed.description ?? '');
        if (closed.place?.active) {
          setPlace({
            areaId: closed.place.areaId,
            locationId: closed.place.locationId,
            workZoneId: closed.place.workZoneId,
          });
        }
      },
      () => undefined,
    );
  }, [followUpOf, project.id, t]);

  const submit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const found: Record<string, string> = {};
    if (title.trim().length < ACTION_LIMITS.titleMin) found.title = t('errors.title');
    if (!owner.id) found.ownerId = t('errors.owner');
    if (!dueOn) found.dueOn = t('errors.dueOn');
    else if (dueOn < today) found.dueOn = t('errors.duePast');
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setSaving(true);
    setFailure(null);
    actionsService
      .create(project.id, {
        title: title.trim(),
        type,
        priority,
        ownerId: owner.id,
        dueOn,
        description: description.trim() || null,
        place: place.areaId ? place : null,
        collaboratorIds: collaborators.map((c) => c.id),
        ...(followUpOf ? { followUpOf } : {}),
      })
      .then(
        (created) => {
          router.push(`/projects/${project.id}/actions/${created.id}?created=1`);
        },
        (error: unknown) => {
          setSaving(false);
          if (error instanceof ApiClientError && error.details.length > 0) {
            setErrors(
              Object.fromEntries(error.details.map((d) => [d.path.split('.')[0] ?? d.path, t('errors.invalid')])),
            );
          }
          setFailure(errorMessage(error));
        },
      );
  };

  return (
    <form noValidate onSubmit={submit} className="flex max-w-2xl flex-col gap-5">
      <h2 className="text-xl font-semibold">{followUpOf ? t('newFollowUp') : t('new')}</h2>
      {source ? (
        <Alert tone="info">
          {t('followUpOf')}{' '}
          <bdi dir="ltr" className="font-mono">
            {source.reference}
          </bdi>
        </Alert>
      ) : null}
      {failure ? <Alert tone="danger">{failure}</Alert> : null}
      <p className="text-sm text-muted-foreground">{tc('requiredHint')}</p>

      <FormField id="action-title" label={t('fields.title')} required error={errors.title}>
        <Input
          id="action-title"
          value={title}
          maxLength={ACTION_LIMITS.titleMax}
          invalid={Boolean(errors.title)}
          aria-describedby={errors.title ? 'action-title-error' : undefined}
          onChange={(event) => {
            setTitle(event.target.value);
          }}
        />
      </FormField>

      <div className="grid gap-5 sm:grid-cols-2">
        <FormField id="action-type" label={t('fields.type')} required>
          <Select
            id="action-type"
            value={type}
            onChange={(event) => {
              setType(event.target.value as ActionType);
            }}
          >
            {ACTION_TYPES.map((value) => (
              <option key={value} value={value}>
                {t(`type.${value}`)}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField id="action-priority" label={t('fields.priority')} required>
          <Select
            id="action-priority"
            value={priority}
            onChange={(event) => {
              setPriority(event.target.value as ActionPriority);
            }}
          >
            {ACTION_PRIORITIES.map((value) => (
              <option key={value} value={value}>
                {t(`priority.${value}`)}
              </option>
            ))}
          </Select>
        </FormField>
      </div>

      <FormField id="action-owner" label={t('fields.owner')} required error={errors.ownerId}>
        <div className="flex flex-col gap-2">
          {user ? (
            <Button
              type="button"
              variant="secondary"
              className="w-fit"
              onClick={() => {
                setOwner({ id: user.id, name: user.fullName });
              }}
            >
              {t('assignToMe')}
            </Button>
          ) : null}
          <PersonSelect
            id="action-owner"
            projectId={project.id}
            value={owner.id}
            currentName={owner.name}
            invalid={Boolean(errors.ownerId)}
            onChange={(id, name) => {
              setOwner({ id, name });
            }}
          />
        </div>
      </FormField>

      <FormField id="action-due" label={t('fields.dueOn')} required error={errors.dueOn}>
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            {QUICK_DAYS.map((days) => (
              <Button
                key={days}
                type="button"
                size="sm"
                variant={dueOn === addIsoDays(today, days) ? 'primary' : 'secondary'}
                onClick={() => {
                  setDueOn(addIsoDays(today, days));
                }}
              >
                {t(`quickDue.${String(days) as '1'}`)}
              </Button>
            ))}
          </div>
          <Input
            id="action-due"
            type="date"
            dir="ltr"
            min={today}
            value={dueOn}
            invalid={Boolean(errors.dueOn)}
            onChange={(event) => {
              setDueOn(event.target.value);
            }}
          />
        </div>
      </FormField>

      <FormField id="action-description" label={t('fields.description')}>
        <Textarea
          id="action-description"
          rows={4}
          maxLength={ACTION_LIMITS.descriptionMax}
          value={description}
          onChange={(event) => {
            setDescription(event.target.value);
          }}
        />
      </FormField>

      <FormField id="action-place" label={t('fields.place')}>
        <PlacePicker id="action-place" projectId={project.id} value={place} onChange={setPlace} />
      </FormField>

      <FormField id="action-collaborators" label={t('fields.collaborators')}>
        <PeopleField
          id="action-collaborators"
          projectId={project.id}
          people={collaborators}
          onChange={setCollaborators}
          exclude={owner.id ? [owner.id] : []}
          max={ACTION_LIMITS.collaboratorsMax}
        />
      </FormField>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            router.back();
          }}
        >
          {tc('cancel')}
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? <Spinner /> : null}
          {t('create')}
        </Button>
      </div>
    </form>
  );
}
