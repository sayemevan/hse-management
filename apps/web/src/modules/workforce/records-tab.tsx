'use client';

import {
  CERTIFICATE_TYPES,
  DOCUMENT_TYPES,
  MEDICAL_FITNESS,
  type RecordKind,
  type WorkforceListItemDto,
  type WorkforceMemberDto,
  type WorkforceRecordDto,
  type WorkforceRecordListDto,
} from '@hse/shared';
import { Paperclip, Plus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useState } from 'react';

import { FormField } from '@/components/form/form-field';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { useLoad } from '@/modules/app/use-load';
import { useReadOnly } from '@/modules/billing/use-subscription-state';
import { useDateFormat } from '@/modules/i18n/use-date-format';
import { useErrorMessage } from '@/modules/i18n/use-error-message';
import { countryOptions } from '@/modules/registration/location-options';

import { useFieldErrors } from './person-form';
import { workforceService } from './workforce.service';
import {
  ExpiryBadge,
  FormDialog,
  openBlob,
  RowMenu,
  todayIso,
  useCountryName,
  usePositionName,
  useRecordLabel,
} from './workforce-ui';

interface RecordValues {
  type: string;
  name: string;
  competencyId: string;
  number: string;
  issuer: string;
  country: string;
  issuedOn: string;
  expiresOn: string;
  noExpiry: boolean;
  reference: string;
  restrictionNote: string;
  note: string;
}

const EMPTY: RecordValues = {
  type: '',
  name: '',
  competencyId: '',
  number: '',
  issuer: '',
  country: '',
  issuedOn: '',
  expiresOn: '',
  noExpiry: false,
  reference: '',
  restrictionNote: '',
  note: '',
};

const TYPES: Partial<Record<RecordKind, readonly string[]>> = {
  certificate: CERTIFICATE_TYPES,
  document: DOCUMENT_TYPES,
  medical: MEDICAL_FITNESS,
};

/** The fields each kind shows (US-026 – US-028, US-030). */
const FIELDS: Record<RecordKind, (keyof RecordValues)[]> = {
  training: ['name', 'competencyId', 'issuer', 'issuedOn', 'expiresOn', 'reference', 'note'],
  certificate: [
    'type',
    'name',
    'competencyId',
    'number',
    'issuer',
    'issuedOn',
    'expiresOn',
    'noExpiry',
    'note',
  ],
  medical: ['type', 'issuedOn', 'expiresOn', 'issuer', 'restrictionNote', 'note'],
  document: ['type', 'name', 'number', 'country', 'issuedOn', 'expiresOn', 'note'],
};

function valuesOf(
  record: WorkforceRecordDto | null,
  kind: RecordKind,
  nationality: string,
): RecordValues {
  if (!record) {
    return {
      ...EMPTY,
      type: kind === 'medical' ? 'fit' : (TYPES[kind]?.[0] ?? ''),
      issuedOn: kind === 'document' ? '' : todayIso(),
      country: kind === 'document' ? nationality : '',
    };
  }
  return {
    type: record.type ?? '',
    name: record.name ?? '',
    competencyId: record.competency?.id ?? '',
    number: record.number ?? '',
    issuer: record.issuer ?? '',
    country: record.country ?? '',
    issuedOn: record.issuedOn ?? '',
    expiresOn: record.expiresOn ?? '',
    noExpiry: record.noExpiry,
    reference: record.reference ?? '',
    restrictionNote: record.restrictionNote ?? '',
    note: record.note ?? '',
  };
}

function dataOf(kind: RecordKind, values: RecordValues): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const key of FIELDS[kind]) {
    const value = values[key];
    if (key === 'noExpiry') data.noExpiry = value;
    else if (key === 'competencyId' || key === 'country') data[key] = value || null;
    else if (key === 'expiresOn') data.expiresOn = values.noExpiry ? null : value || null;
    else if (key === 'issuedOn') data.issuedOn = value || null;
    else data[key] = value;
  }
  return data;
}

type Mode =
  | { kind: 'add' }
  | { kind: 'edit'; record: WorkforceRecordDto }
  | { kind: 'renew'; record: WorkforceRecordDto };

/** One record tab: list, history, add, edit, renew, void, open copy. */
/** `onChanged` refreshes the profile (compliance badge, medical status). */
export function RecordsTab({
  member,
  kind,
  onChanged,
}: {
  member: WorkforceMemberDto;
  kind: RecordKind;
  onChanged: () => void;
}) {
  const t = useTranslations('workforce.records');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const readOnly = useReadOnly();
  const label = useRecordLabel();
  const { calendarDate } = useDateFormat();
  const positionName = usePositionName();
  const [history, setHistory] = useState(false);
  const [mode, setMode] = useState<Mode | null>(null);
  const [voiding, setVoiding] = useState<WorkforceRecordDto | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const loaded = useLoad<WorkforceRecordListDto>(
    useCallback(
      () => workforceService.records(member.id, kind, history),
      [member.id, kind, history],
    ),
    `${member.id}:${kind}:${String(history)}`,
  );
  const canEdit =
    !readOnly &&
    (kind === 'medical' || kind === 'document' ? member.can.editPersonal : member.can.edit);
  const renewable = kind !== 'medical';
  const data = loaded.status === 'ready' ? loaded.value : null;
  const fitness = useTranslations('workforce.types.medical');

  const open = (record: WorkforceRecordDto) => {
    openBlob(() => workforceService.recordFile(member.id, kind, record.id)).catch(
      (error: unknown) => {
        setNotice(errorMessage(error));
      },
    );
  };

  return (
    <div className="flex flex-col gap-4">
      {kind === 'medical' && data?.status ? (
        <div className="flex flex-col gap-1 rounded-xl border border-border p-4">
          <span className="text-sm text-muted-foreground">{t('medicalStatus')}</span>
          <span className="font-semibold">
            {data.status.fitness ? fitness(data.status.fitness) : t('medicalNotRecorded')}
          </span>
          {data.status.fitness && data.status.fitness !== 'unfit' ? (
            <ExpiryBadge state={data.status.expiryState} expiresOn={data.status.expiresOn} />
          ) : null}
          {data.status.hasRestrictions && !member.can.viewPersonal ? (
            <span className="text-sm">{t('restrictionsHidden')}</span>
          ) : null}
        </div>
      ) : null}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Checkbox
          id={`history-${kind}`}
          label={t('showHistory')}
          checked={history}
          onChange={(event) => {
            setHistory(event.target.checked);
          }}
        />
        {canEdit ? (
          <Button
            onClick={() => {
              setMode({ kind: 'add' });
            }}
          >
            <Plus aria-hidden className="size-5" />
            {t(`add.${kind}`)}
          </Button>
        ) : null}
      </div>
      {notice ? <Alert tone="info">{notice}</Alert> : null}
      {loaded.status === 'error' ? (
        <Alert tone="danger">{errorMessage(loaded.error)}</Alert>
      ) : !data ? (
        <div className="flex items-center gap-3" role="status">
          <Spinner />
          {tc('loading')}
        </div>
      ) : data.items.length === 0 ? (
        <p className="text-muted-foreground">{t(`empty.${kind}`)}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {data.items.map((record) => {
            const current = record.state === 'current';
            const menu = [
              ...(record.hasFile
                ? [
                    {
                      label: t('openCopy'),
                      onSelect: () => {
                        open(record);
                      },
                    },
                  ]
                : []),
              ...(canEdit && current
                ? [
                    {
                      label: t('edit'),
                      onSelect: () => {
                        setMode({ kind: 'edit', record });
                      },
                    },
                    ...(renewable
                      ? [
                          {
                            label: t(`renew.${kind}`),
                            onSelect: () => {
                              setMode({ kind: 'renew', record });
                            },
                          },
                        ]
                      : []),
                    {
                      label: t('void'),
                      danger: true,
                      onSelect: () => {
                        setVoiding(record);
                      },
                    },
                  ]
                : []),
            ];
            return (
              <li
                key={record.id}
                className="flex items-start gap-3 rounded-xl border border-border p-4"
              >
                <div className="flex flex-1 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">
                      {kind === 'medical' && record.type
                        ? fitness(record.type as 'fit')
                        : label(record)}
                    </span>
                    {record.state !== 'current' ? (
                      <span className="rounded-full bg-muted px-2 text-xs font-medium">
                        {t(`state.${record.state}`)}
                      </span>
                    ) : null}
                    {record.hasFile ? (
                      <Paperclip
                        aria-label={t('hasCopy')}
                        className="size-4 text-muted-foreground"
                      />
                    ) : kind === 'certificate' ? (
                      <span className="text-xs text-muted-foreground">{t('noCopy')}</span>
                    ) : null}
                  </div>
                  <span className="text-sm text-muted-foreground">
                    {[
                      record.competency ? positionName(record.competency) : null,
                      record.number ? `${t('number')} ${record.number}` : null,
                      record.issuer,
                      record.issuedOn
                        ? `${t(`issuedOn.${kind}`)} ${calendarDate(record.issuedOn)}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                  {record.restrictionNote ? (
                    <span className="w-fit rounded-lg bg-warning-surface px-2 py-1 text-sm text-warning-foreground">
                      {record.restrictionNote}
                    </span>
                  ) : null}
                  {current ? (
                    <ExpiryBadge state={record.expiryState} expiresOn={record.expiresOn} />
                  ) : null}
                  {record.voidReason ? (
                    <span className="text-sm text-muted-foreground">
                      {t('voidReason', { reason: record.voidReason })}
                    </span>
                  ) : null}
                </div>
                <RowMenu label={t('actions')} items={menu} />
              </li>
            );
          })}
        </ul>
      )}
      <RecordDialog
        member={member}
        kind={kind}
        mode={mode}
        onClose={() => {
          setMode(null);
        }}
        onSaved={(text) => {
          setMode(null);
          setNotice(text);
          loaded.reload();
          onChanged();
        }}
      />
      <VoidDialog
        member={member}
        kind={kind}
        record={voiding}
        onClose={() => {
          setVoiding(null);
        }}
        onSaved={() => {
          setVoiding(null);
          setNotice(t('voided'));
          loaded.reload();
          onChanged();
        }}
      />
    </div>
  );
}

function RecordDialog({
  member,
  kind,
  mode,
  onClose,
  onSaved,
}: {
  member: WorkforceMemberDto;
  kind: RecordKind;
  mode: Mode | null;
  onClose: () => void;
  onSaved: (notice: string) => void;
}) {
  const t = useTranslations('workforce.records');
  const tt = useTranslations('workforce.types');
  const tc = useTranslations('common');
  const locale = useLocale();
  const countryName = useCountryName();
  const positionName = usePositionName();
  const errorMessage = useErrorMessage();
  const fieldErrors = useFieldErrors();
  const [values, setValues] = useState<RecordValues>(EMPTY);
  const [file, setFile] = useState<File | null>(null);
  const [removeFile, setRemoveFile] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [openedFor, setOpenedFor] = useState<Mode | null>(null);
  const competencies = useLoad<WorkforceListItemDto[]>(
    useCallback(() => workforceService.listItems('competency'), []),
    'competencies',
  );

  // Reset the form each time the dialog opens.
  if (mode !== openedFor) {
    setOpenedFor(mode);
    if (mode) {
      const base = valuesOf(mode.kind === 'add' ? null : mode.record, kind, member.nationality);
      setValues(
        mode.kind === 'renew'
          ? { ...base, number: '', issuedOn: todayIso(), expiresOn: '', note: '' }
          : base,
      );
      setFile(null);
      setRemoveFile(false);
      setErrors({});
      setFormError(null);
    }
  }

  const set = <K extends keyof RecordValues>(key: K, value: RecordValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
  };
  const show = (key: keyof RecordValues) =>
    FIELDS[kind].includes(key) &&
    (key !== 'restrictionNote' || values.type === 'fit_with_restrictions') &&
    (key !== 'expiresOn' || !(kind === 'medical' && values.type === 'unfit'));

  const submit = async () => {
    if (!mode) return;
    setSaving(true);
    setFormError(null);
    setErrors({});
    try {
      const data: Record<string, unknown> = {
        ...dataOf(kind, values),
        ...(removeFile ? { removeFile: true } : {}),
      };
      if (kind === 'medical' && values.type === 'unfit') data.expiresOn = null;
      if (kind === 'medical' && values.type !== 'fit_with_restrictions') data.restrictionNote = '';
      if (mode.kind === 'add') await workforceService.addRecord(member.id, kind, data, file);
      else if (mode.kind === 'edit') {
        await workforceService.editRecord(member.id, kind, mode.record.id, data, file);
      } else await workforceService.renewRecord(member.id, kind, mode.record.id, data, file);
      onSaved(t('saved'));
    } catch (error) {
      const fields = fieldErrors(error);
      if (fields) setErrors(fields);
      else setFormError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const countries = countryOptions(locale);
  const title =
    mode?.kind === 'edit'
      ? t('editTitle')
      : mode?.kind === 'renew'
        ? t(`renew.${kind}`)
        : t(`add.${kind}`);
  const text = (
    key: keyof RecordValues,
    labelText: string,
    props: { dir?: 'ltr'; type?: string } = {},
  ) => (
    <FormField id={`record-${key}`} label={labelText} error={errors[key]}>
      <Input
        id={`record-${key}`}
        {...props}
        invalid={Boolean(errors[key])}
        value={values[key] as string}
        onChange={(event) => {
          set(key, event.target.value as never);
        }}
      />
    </FormField>
  );

  return (
    <FormDialog
      open={mode !== null}
      title={title}
      error={formError}
      saving={saving}
      submitLabel={t('save')}
      cancelLabel={tc('cancel')}
      onSubmit={() => void submit()}
      onClose={onClose}
    >
      {show('type') ? (
        <FormField id="record-type" label={t(`typeLabel.${kind}`)} error={errors.type}>
          <Select
            id="record-type"
            value={values.type}
            onChange={(event) => {
              set('type', event.target.value);
            }}
          >
            {(TYPES[kind] ?? []).map((value) => (
              <option key={value} value={value}>
                {tt(`${kind}.${value}` as 'document.passport')}
              </option>
            ))}
          </Select>
        </FormField>
      ) : null}
      {show('name') ? text('name', t(`nameLabel.${kind}`)) : null}
      {show('competencyId') ? (
        <FormField id="record-competency" label={t('competency')} error={errors.competencyId}>
          <Select
            id="record-competency"
            value={values.competencyId}
            onChange={(event) => {
              set('competencyId', event.target.value);
            }}
          >
            <option value="">{t('noCompetency')}</option>
            {(competencies.status === 'ready' ? competencies.value : []).map((item) => (
              <option key={item.id} value={item.id}>
                {positionName(item)}
              </option>
            ))}
          </Select>
        </FormField>
      ) : null}
      {show('number') ? text('number', t('number'), { dir: 'ltr' }) : null}
      {show('country') ? (
        <FormField id="record-country" label={t('country')} error={errors.country}>
          <Select
            id="record-country"
            value={values.country}
            onChange={(event) => {
              set('country', event.target.value);
            }}
          >
            <option value="">{countryName(null)}</option>
            {[...countries.gcc, ...countries.others].map((country) => (
              <option key={country.code} value={country.code}>
                {country.name}
              </option>
            ))}
          </Select>
        </FormField>
      ) : null}
      {show('issuer') ? text('issuer', t(`issuerLabel.${kind}`)) : null}
      {show('issuedOn') ? text('issuedOn', t(`issuedOn.${kind}`), { type: 'date' }) : null}
      {show('expiresOn') && !values.noExpiry
        ? text('expiresOn', t(kind === 'medical' ? 'validUntil' : 'expiresOn'), { type: 'date' })
        : null}
      {show('noExpiry') ? (
        <Checkbox
          id="record-no-expiry"
          label={t('noExpiry')}
          checked={values.noExpiry}
          onChange={(event) => {
            set('noExpiry', event.target.checked);
          }}
        />
      ) : null}
      {show('reference') ? text('reference', t('reference'), { dir: 'ltr' }) : null}
      {show('restrictionNote') ? (
        <FormField
          id="record-restriction"
          label={t('restrictionNote')}
          error={errors.restrictionNote}
        >
          <Textarea
            id="record-restriction"
            rows={2}
            value={values.restrictionNote}
            onChange={(event) => {
              set('restrictionNote', event.target.value);
            }}
          />
        </FormField>
      ) : null}
      {show('note') ? text('note', t('note')) : null}
      <FormField
        id="record-file"
        label={kind === 'document' ? t('copyRequired') : t('copy')}
        error={errors.file}
        hint={<span className="text-sm text-muted-foreground">{t('copyHint')}</span>}
      >
        <input
          id="record-file"
          type="file"
          accept="application/pdf,image/jpeg,image/png"
          className="min-h-12 text-sm"
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
          }}
        />
      </FormField>
      {mode?.kind === 'edit' && mode.record.hasFile && kind !== 'document' ? (
        <Checkbox
          id="record-remove-file"
          label={t('removeCopy')}
          checked={removeFile}
          onChange={(event) => {
            setRemoveFile(event.target.checked);
          }}
        />
      ) : null}
    </FormDialog>
  );
}

function VoidDialog({
  member,
  kind,
  record,
  onClose,
  onSaved,
}: {
  member: WorkforceMemberDto;
  kind: RecordKind;
  record: WorkforceRecordDto | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations('workforce.records');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  return (
    <FormDialog
      open={record !== null}
      title={t('voidTitle')}
      error={error}
      saving={saving}
      tone="danger"
      submitLabel={t('void')}
      cancelLabel={tc('cancel')}
      onClose={() => {
        setReason('');
        setError(null);
        onClose();
      }}
      onSubmit={() => {
        if (!record) return;
        if (reason.trim().length < 5) {
          setError(t('reasonRequired'));
          return;
        }
        setSaving(true);
        workforceService
          .voidRecord(member.id, kind, record.id, reason.trim())
          .then(
            () => {
              setReason('');
              onSaved();
            },
            (failure: unknown) => {
              setError(errorMessage(failure));
            },
          )
          .finally(() => {
            setSaving(false);
          });
      }}
    >
      <p>{t('voidBody')}</p>
      <FormField id="void-reason" label={t('reason')} required requiredLabel={tc('required')}>
        <Textarea
          id="void-reason"
          rows={2}
          value={reason}
          onChange={(event) => {
            setReason(event.target.value);
          }}
        />
      </FormField>
    </FormDialog>
  );
}
