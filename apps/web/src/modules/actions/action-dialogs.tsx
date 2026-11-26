'use client';

import {
  ACTION_FILE_RULES,
  ACTION_LIMITS,
  ACTION_PRIORITIES,
  ACTION_TYPES,
  type ActionDto,
  type ActionPriority,
  type ActionType,
  EVIDENCE_REQUIRED_PRIORITIES,
  VERIFICATION_METHODS,
  type VerificationMethod,
} from '@hse/shared';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { FormField } from '@/components/form/form-field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useErrorMessage } from '@/modules/i18n/use-error-message';
import { FormDialog } from '@/modules/workforce/workforce-ui';
import { cn } from '@/utils/cn';

import { actionsService } from './actions.service';
import { EvidenceRow } from './evidence';
import { PersonSelect } from './person-select';

export type StepKind =
  | 'progress'
  | 'complete'
  | 'verify'
  | 'verify_and_close'
  | 'send_back'
  | 'close'
  | 'void'
  | 'owner'
  | 'edit';

const PERCENTS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90] as const;

/** One dialog for every step of US-053 – US-058 (FormDialog: full-screen on phones). */
export function StepDialog({
  kind,
  action,
  onClose,
  onDone,
}: {
  kind: StepKind | null;
  action: ActionDto;
  onClose: () => void;
  onDone: (updated: ActionDto, message: string) => void;
}) {
  return kind ? (
    <StepForm key={kind} kind={kind} action={action} onClose={onClose} onDone={onDone} />
  ) : null;
}

function StepForm({
  kind,
  action,
  onClose,
  onDone,
}: {
  kind: StepKind;
  action: ActionDto;
  onClose: () => void;
  onDone: (updated: ActionDto, message: string) => void;
}) {
  const t = useTranslations('actions');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const [note, setNote] = useState('');
  const [percent, setPercent] = useState<number | null>(null);
  const [method, setMethod] = useState<VerificationMethod | ''>('');
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(kind === 'complete' ? action.files.map((f) => f.id) : []),
  );
  const [uploads, setUploads] = useState<File[]>([]);
  const [owner, setOwner] = useState('');
  const [edit, setEdit] = useState({
    title: action.title,
    type: action.type,
    priority: action.priority,
    dueOn: action.dueOn,
    description: action.description ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { projectId, id } = action;

  const evidenceRequired =
    kind === 'complete' && EVIDENCE_REQUIRED_PRIORITIES.includes(action.priority);
  const withFiles = kind === 'progress' || kind === 'complete' || kind === 'verify' || kind === 'verify_and_close';

  /** Uploads new files first, then returns the ids to attach (new ones plus selected ones). */
  const filesToAttach = async (): Promise<string[]> => {
    if (uploads.length === 0) return [...selected];
    const before = new Set(action.files.map((f) => f.id));
    const updated = await actionsService.uploadFiles(projectId, id, uploads);
    const added = updated.files.filter((f) => !before.has(f.id)).map((f) => f.id);
    return [...selected, ...added];
  };

  const validate = (): string | null => {
    switch (kind) {
      case 'progress':
        return note.trim().length < ACTION_LIMITS.progressNoteMin ? t('errors.progressNote') : null;
      case 'complete':
        if (note.trim().length < ACTION_LIMITS.completionNoteMin) return t('errors.completionNote');
        return evidenceRequired && selected.size + uploads.length === 0
          ? t('errors.evidence')
          : null;
      case 'verify':
      case 'verify_and_close':
        return method ? null : t('errors.method');
      case 'send_back':
        return note.trim().length < ACTION_LIMITS.reasonMin ? t('errors.reason') : null;
      case 'void':
        return note.trim().length < ACTION_LIMITS.reasonMin ? t('errors.reason') : null;
      case 'owner':
        if (!owner) return t('errors.owner');
        return note.trim().length < ACTION_LIMITS.changeReasonMin ? t('errors.changeReason') : null;
      case 'edit': {
        if (edit.title.trim().length < ACTION_LIMITS.titleMin) return t('errors.title');
        const sensitive = edit.dueOn !== action.dueOn || edit.priority !== action.priority;
        return sensitive && note.trim().length < ACTION_LIMITS.changeReasonMin
          ? t('errors.changeReason')
          : null;
      }
      case 'close':
        return null;
    }
  };

  const run = async (): Promise<ActionDto> => {
    switch (kind) {
      case 'progress':
        return actionsService.addProgress(projectId, id, {
          note: note.trim(),
          percent,
          fileIds: await filesToAttach(),
        });
      case 'complete':
        return actionsService.transition(projectId, id, {
          transition: 'complete',
          note: note.trim(),
          evidenceFileIds: await filesToAttach(),
        });
      case 'verify':
      case 'verify_and_close':
        return actionsService.transition(projectId, id, {
          transition: kind,
          method: method as VerificationMethod,
          note: note.trim() || null,
          evidenceFileIds: await filesToAttach(),
        });
      case 'send_back':
        return actionsService.transition(projectId, id, {
          transition: 'send_back',
          reason: note.trim(),
        });
      case 'close':
        return actionsService.transition(projectId, id, {
          transition: 'close',
          note: note.trim() || null,
        });
      case 'void':
        return actionsService.void(projectId, id, note.trim());
      case 'owner':
        return actionsService.changeOwner(projectId, id, { ownerId: owner, reason: note.trim() });
      case 'edit':
        return actionsService.update(projectId, id, {
          title: edit.title.trim(),
          type: edit.type,
          priority: edit.priority,
          dueOn: edit.dueOn,
          description: edit.description.trim() || null,
          ...(note.trim() ? { reason: note.trim() } : {}),
        });
    }
  };

  const submit = () => {
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError(null);
    run().then(
      (updated) => {
        onDone(updated, t(`done.${kind}`));
      },
      (failure: unknown) => {
        setSaving(false);
        setError(errorMessage(failure));
      },
    );
  };

  const noteLabel = {
    progress: t('dialog.progressNote'),
    complete: t('dialog.completionNote'),
    verify: t('dialog.verifyNote'),
    verify_and_close: t('dialog.verifyNote'),
    send_back: t('dialog.sendBackReason'),
    close: t('dialog.closeNote'),
    void: t('dialog.voidReason'),
    owner: t('dialog.ownerReason'),
    edit: t('dialog.editReason'),
  }[kind];
  const noteRequired = !['verify', 'verify_and_close', 'close', 'edit'].includes(kind);

  return (
    <FormDialog
      open
      title={t(`dialog.title.${kind}`)}
      error={error}
      saving={saving}
      submitLabel={t(`dialog.submit.${kind}`)}
      cancelLabel={tc('cancel')}
      tone={kind === 'void' ? 'danger' : 'primary'}
      onSubmit={submit}
      onClose={onClose}
    >
      {kind === 'edit' ? (
        <>
          <FormField id="edit-title" label={t('fields.title')} required>
            <Input
              id="edit-title"
              value={edit.title}
              maxLength={ACTION_LIMITS.titleMax}
              onChange={(event) => {
                setEdit({ ...edit, title: event.target.value });
              }}
            />
          </FormField>
          <FormField id="edit-type" label={t('fields.type')}>
            <Select
              id="edit-type"
              value={edit.type}
              onChange={(event) => {
                setEdit({ ...edit, type: event.target.value as ActionType });
              }}
            >
              {ACTION_TYPES.map((value) => (
                <option key={value} value={value}>
                  {t(`type.${value}`)}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField id="edit-priority" label={t('fields.priority')}>
            <Select
              id="edit-priority"
              value={edit.priority}
              onChange={(event) => {
                setEdit({ ...edit, priority: event.target.value as ActionPriority });
              }}
            >
              {ACTION_PRIORITIES.map((value) => (
                <option key={value} value={value}>
                  {t(`priority.${value}`)}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField id="edit-due" label={t('fields.dueOn')}>
            <Input
              id="edit-due"
              type="date"
              dir="ltr"
              value={edit.dueOn}
              onChange={(event) => {
                setEdit({ ...edit, dueOn: event.target.value });
              }}
            />
          </FormField>
          <FormField id="edit-description" label={t('fields.description')}>
            <Textarea
              id="edit-description"
              rows={3}
              maxLength={ACTION_LIMITS.descriptionMax}
              value={edit.description}
              onChange={(event) => {
                setEdit({ ...edit, description: event.target.value });
              }}
            />
          </FormField>
        </>
      ) : null}

      {kind === 'owner' ? (
        <FormField id="new-owner" label={t('dialog.newOwner')} required>
          <PersonSelect
            id="new-owner"
            projectId={projectId}
            value={owner}
            exclude={[action.owner.id]}
            onChange={(userId) => {
              setOwner(userId);
            }}
          />
        </FormField>
      ) : null}

      {kind === 'verify' || kind === 'verify_and_close' ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium">
            {t('dialog.method')}
            <span className="ms-1 text-danger" aria-hidden>
              *
            </span>
          </legend>
          {VERIFICATION_METHODS.map((value) => (
            <label
              key={value}
              className={cn(
                'flex min-h-12 items-center gap-3 rounded-lg border px-4',
                method === value ? 'border-primary bg-muted' : 'border-border',
              )}
            >
              <input
                type="radio"
                name="method"
                value={value}
                checked={method === value}
                onChange={() => {
                  setMethod(value);
                }}
              />
              {t(`method.${value}`)}
            </label>
          ))}
        </fieldset>
      ) : null}

      {kind === 'progress' ? (
        <fieldset>
          <legend className="mb-2 text-sm font-medium">{t('dialog.percent')}</legend>
          <div className="flex flex-wrap gap-2">
            {PERCENTS.map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={percent === value}
                onClick={() => {
                  setPercent(percent === value ? null : value);
                }}
                className={cn(
                  'min-h-10 min-w-12 rounded-full border px-3 text-sm tabular-nums',
                  percent === value ? 'border-primary bg-primary text-white' : 'border-border',
                )}
              >
                {t('percent', { value })}
              </button>
            ))}
          </div>
        </fieldset>
      ) : null}

      <FormField id="step-note" label={noteLabel} required={noteRequired}>
        <Textarea
          id="step-note"
          rows={3}
          dir="auto"
          maxLength={kind === 'owner' || kind === 'edit' || kind === 'void' ? 500 : ACTION_LIMITS.noteMax}
          value={note}
          onChange={(event) => {
            setNote(event.target.value);
          }}
        />
      </FormField>

      {withFiles ? (
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">
            {kind === 'progress' ? t('dialog.photos') : t('dialog.evidence')}
            {evidenceRequired ? (
              <span className="ms-1 text-danger" aria-hidden>
                *
              </span>
            ) : null}
          </span>
          {evidenceRequired ? (
            <p className="text-sm text-muted-foreground">{t('dialog.evidenceRequired')}</p>
          ) : null}
          {kind !== 'progress' && action.files.length > 0 ? (
            <EvidenceRow
              projectId={projectId}
              actionId={id}
              files={action.files}
              selected={selected}
              onToggle={(fileId) => {
                const next = new Set(selected);
                if (next.has(fileId)) next.delete(fileId);
                else next.add(fileId);
                setSelected(next);
              }}
            />
          ) : null}
          <input
            type="file"
            multiple
            accept={ACTION_FILE_RULES.contentTypes.join(',')}
            aria-label={t('dialog.addFiles')}
            className="text-sm file:me-3 file:min-h-10 file:rounded-lg file:border file:border-border file:bg-background file:px-3"
            onChange={(event) => {
              const files = [...(event.target.files ?? [])];
              const tooBig = files.find((f) => f.size > ACTION_FILE_RULES.maxBytes);
              if (tooBig) {
                setError(t('errors.fileTooLarge', { name: tooBig.name }));
                return;
              }
              setUploads(files.slice(0, ACTION_LIMITS.filesPerUpload));
            }}
          />
          {uploads.length > 0 ? (
            <p className="text-sm text-muted-foreground">
              {t('dialog.filesChosen', { count: uploads.length })}
            </p>
          ) : null}
        </div>
      ) : null}
    </FormDialog>
  );
}
