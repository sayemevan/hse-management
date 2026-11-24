'use client';

import { PLACE_CODE_PATTERN, PLACE_LIMITS, type PlaceDto, type PlaceLevel } from '@hse/shared';
import { useTranslations } from 'next-intl';
import { type SyntheticEvent, useEffect, useId, useRef, useState } from 'react';

import { FormField } from '@/components/form/form-field';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { useErrorMessage } from '@/modules/i18n/use-error-message';
import { ApiClientError } from '@/services/api-client';

import { placesService } from './structure.service';

export type PlaceFormTarget =
  | { mode: 'create'; level: PlaceLevel; parent: PlaceDto | null }
  | { mode: 'edit'; place: PlaceDto };

/** Add or edit an Area, Location or Work Zone (US-019 – US-021, O-60). */
export function PlaceFormDialog({
  projectId,
  target,
  onClose,
  onSaved,
}: {
  projectId: string;
  target: PlaceFormTarget | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations('structure');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');
  const [errors, setErrors] = useState<{ name?: string; code?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (target && !element.open) {
      const editing = target.mode === 'edit' ? target.place : null;
      setName(editing?.name ?? '');
      setCode(editing?.code ?? '');
      setDescription(editing?.description ?? '');
      setErrors({});
      setFormError(null);
      element.showModal();
    }
    if (!target && element.open) element.close();
  }, [target]);

  const level = target?.mode === 'edit' ? target.place.level : (target?.level ?? 'area');

  const handleSubmit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!target) return;
    const found: typeof errors = {};
    const trimmed = name.trim();
    const upper = code.trim().toUpperCase();
    if (trimmed.length < PLACE_LIMITS.nameMin || trimmed.length > PLACE_LIMITS.nameMax) {
      found.name = t('nameInvalid');
    }
    if (upper && (upper.length > PLACE_LIMITS.codeMax || !PLACE_CODE_PATTERN.test(upper))) {
      found.code = t('codeInvalid');
    }
    setErrors(found);
    setFormError(null);
    if (Object.keys(found).length > 0) return;

    setSaving(true);
    try {
      if (target.mode === 'create') {
        await placesService.create(projectId, {
          level: target.level,
          parentId: target.parent?.id ?? null,
          name: trimmed,
          code: upper || null,
          description: description.trim() || null,
        });
      } else {
        await placesService.update(projectId, target.place.id, {
          name: trimmed,
          code: upper || null,
          description: description.trim() || null,
        });
      }
      onSaved();
    } catch (error) {
      if (error instanceof ApiClientError && error.code === 'PLACE_NAME_TAKEN') {
        setErrors({ name: t(`nameTaken.${level}`) });
      } else if (error instanceof ApiClientError && error.code === 'PLACE_CODE_TAKEN') {
        setErrors({ code: t('codeTaken') });
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
      className="m-0 mt-auto w-full max-w-none rounded-t-xl bg-background p-0 text-foreground backdrop:bg-black/40 sm:m-auto sm:w-[calc(100%-2rem)] sm:max-w-lg sm:rounded-xl sm:border sm:border-border sm:shadow-xl"
    >
      <form
        noValidate
        onSubmit={(event) => void handleSubmit(event)}
        className="flex flex-col gap-5 p-6"
      >
        <h2 id={titleId} className="text-xl font-semibold">
          {target?.mode === 'edit' ? t(`editTitle.${level}`) : t(`addTitle.${level}`)}
        </h2>
        {target?.mode === 'create' && target.parent ? (
          <p className="text-muted-foreground">{t('inside', { name: target.parent.name })}</p>
        ) : null}
        {formError ? <Alert tone="danger">{formError}</Alert> : null}
        <FormField
          id="place-name"
          label={t('name')}
          required
          requiredLabel={tc('required')}
          error={errors.name}
        >
          <Input
            id="place-name"
            value={name}
            maxLength={PLACE_LIMITS.nameMax}
            invalid={Boolean(errors.name)}
            aria-describedby={errors.name ? 'place-name-error' : undefined}
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
        </FormField>
        <FormField
          id="place-code"
          label={t('code')}
          error={errors.code}
          hint={
            <p id="place-code-hint" className="text-sm text-muted-foreground">
              {t('codeHint')}
            </p>
          }
        >
          <Input
            id="place-code"
            dir="ltr"
            autoComplete="off"
            className="font-mono uppercase"
            value={code}
            maxLength={PLACE_LIMITS.codeMax}
            invalid={Boolean(errors.code)}
            aria-describedby={errors.code ? 'place-code-error' : 'place-code-hint'}
            onChange={(event) => {
              setCode(event.target.value.toUpperCase());
            }}
          />
        </FormField>
        <FormField id="place-description" label={t('description')}>
          <Textarea
            id="place-description"
            rows={3}
            maxLength={PLACE_LIMITS.descriptionMax}
            value={description}
            onChange={(event) => {
              setDescription(event.target.value);
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
