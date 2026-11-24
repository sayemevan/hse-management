'use client';

import {
  LEAVING_STATUSES,
  RECORD_KINDS,
  type RecordKind,
  WORKFORCE_STATUSES,
  type WorkforceMemberDto,
  type WorkforceStatus,
} from '@hse/shared';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';

import { FormField } from '@/components/form/form-field';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { useReadOnly } from '@/modules/billing/use-subscription-state';
import { useDateFormat } from '@/modules/i18n/use-date-format';
import { useErrorMessage } from '@/modules/i18n/use-error-message';
import { useCompany } from '@/modules/tenant/tenant-provider';
import { cn } from '@/utils/cn';

import {
  checkPerson,
  PersonFields,
  type PersonValues,
  requestOf,
  useFieldErrors,
  valuesOf,
} from './person-form';
import { AssignmentsTab, ContactsTab, HistoryTab } from './profile-tabs';
import { RecordsTab } from './records-tab';
import { workforceService } from './workforce.service';
import {
  ComplianceBadge,
  FormDialog,
  PersonPhoto,
  StatusChip,
  todayIso,
  useCountryName,
  usePersonName,
  usePositionName,
} from './workforce-ui';

type Tab = 'overview' | 'assignments' | RecordKind | 'contacts' | 'history';

const RECORD_TAB: Record<RecordKind, string> = {
  training: 'training',
  certificate: 'certificates',
  medical: 'medical',
  document: 'documents',
};

/**
 * US-024 – US-030: one person's profile with its tabs. `mine` shows the signed-in user's own
 * linked record, read-only (O-85).
 */
export function ProfileScreen({ memberId, mine = false }: { memberId?: string; mine?: boolean }) {
  const t = useTranslations('workforce');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [member, setMember] = useState<WorkforceMemberDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tab = (params.get('tab') ?? 'overview') as Tab;

  const load = useCallback(() => {
    const request = mine
      ? workforceService.mine().then((result) => result.member)
      : workforceService.get(memberId ?? '');
    request.then(setMember, (failure: unknown) => {
      setError(errorMessage(failure));
    });
  }, [memberId, mine, errorMessage]);
  useEffect(() => {
    load();
  }, [load]);

  const personName = usePersonName();

  if (error) {
    return (
      <div className="flex flex-col items-start gap-3">
        {mine ? null : (
          <Link href="/workforce" className="text-sm font-medium text-primary hover:underline">
            {t('back')}
          </Link>
        )}
        <Alert tone="danger">{mine ? t('notLinked') : error}</Alert>
      </div>
    );
  }
  if (!member) {
    return (
      <div className="flex items-center gap-3" role="status">
        <Spinner />
        {tc('loading')}
      </div>
    );
  }

  const tabs: { id: Tab; label: string; show: boolean }[] = [
    { id: 'overview', label: t('tabs.overview'), show: true },
    { id: 'assignments', label: t('tabs.assignments'), show: true },
    ...RECORD_KINDS.map((kind) => ({
      id: kind,
      label: t(`tabs.${RECORD_TAB[kind]}` as 'tabs.training'),
      show: kind !== 'document' || member.can.viewPersonal,
    })),
    { id: 'contacts', label: t('tabs.contacts'), show: member.can.viewContacts },
    { id: 'history', label: t('tabs.history'), show: !mine },
  ];
  const select = (id: Tab) => {
    const next = new URLSearchParams(params.toString());
    if (id === 'overview') next.delete('tab');
    else next.set('tab', id);
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  };
  const name = personName(member);

  return (
    <div className="flex flex-col gap-6">
      {mine ? null : (
        <Link href="/workforce" className="text-sm font-medium text-primary hover:underline">
          {t('back')}
        </Link>
      )}
      <div className="flex items-center gap-4">
        <PersonPhoto url={member.photoUrl} name={name} size="lg" />
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">
            <bdi>{name}</bdi>
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            <StatusChip status={member.status} />
            {member.archived ? (
              <span className="rounded-full bg-muted px-2 text-xs font-medium">
                {t('archivedChip')}
              </span>
            ) : null}
            <ComplianceBadge compliance={member.compliance} />
          </div>
        </div>
      </div>
      {mine ? <Alert tone="info">{t('mineHint')}</Alert> : null}
      {member.archived ? <Alert tone="warning">{t('archivedBanner')}</Alert> : null}
      <nav aria-label={t('tabs.label')} className="-mx-4 overflow-x-auto px-4">
        <ul className="flex min-w-max border-b border-border">
          {tabs
            .filter((item) => item.show)
            .map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  aria-current={tab === item.id ? 'page' : undefined}
                  onClick={() => {
                    select(item.id);
                  }}
                  className={cn(
                    'inline-flex min-h-12 items-center border-b-2 px-4 font-medium',
                    tab === item.id
                      ? 'border-primary text-primary'
                      : 'border-transparent hover:bg-muted',
                  )}
                >
                  {item.label}
                </button>
              </li>
            ))}
        </ul>
      </nav>
      {tab === 'overview' ? <Overview member={member} onChanged={setMember} /> : null}
      {tab === 'assignments' ? <AssignmentsTab member={member} /> : null}
      {RECORD_KINDS.includes(tab as RecordKind) ? (
        <RecordsTab key={tab} member={member} kind={tab as RecordKind} onChanged={load} />
      ) : null}
      {tab === 'contacts' ? <ContactsTab member={member} onChanged={load} /> : null}
      {tab === 'history' ? <HistoryTab member={member} /> : null}
    </div>
  );
}

function Overview({
  member,
  onChanged,
}: {
  member: WorkforceMemberDto;
  onChanged: (member: WorkforceMemberDto) => void;
}) {
  const t = useTranslations('workforce');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const readOnly = useReadOnly();
  const company = useCompany();
  const countryName = useCountryName();
  const positionName = usePositionName();
  const fitness = useTranslations('workforce.types.medical');
  const { calendarDate } = useDateFormat();
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [dialog, setDialog] = useState<'edit' | 'status' | 'link' | 'archive' | null>(null);
  const can = member.can;
  const editable = !readOnly && can.edit;

  const run = (action: Promise<WorkforceMemberDto | null>, text: string) => {
    action.then(
      (result) => {
        if (result) onChanged(result);
        else void workforceService.get(member.id).then(onChanged);
        setNotice({ tone: 'success', text });
      },
      (failure: unknown) => {
        setNotice({ tone: 'danger', text: errorMessage(failure) });
      },
    );
  };

  const detail = (label: string, value: React.ReactNode) => (
    <div className="flex flex-col gap-0.5">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd>{value}</dd>
    </div>
  );

  return (
    <div className="flex flex-col gap-6">
      {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}
      <dl className="grid gap-4 sm:grid-cols-2">
        {detail(t('fields.category'), t(`category.${member.category}`))}
        {detail(t('fields.jobPosition'), positionName(member.position))}
        {detail(t('fields.fullName'), <bdi>{member.fullName}</bdi>)}
        {member.altName ? detail(t('fields.altName'), <bdi>{member.altName}</bdi>) : null}
        {detail(
          t('fields.employeeId'),
          member.employeeId ? <bdi dir="ltr">{member.employeeId}</bdi> : '—',
        )}
        {detail(t('fields.nationality'), countryName(member.nationality))}
        {detail(t('fields.employer'), <bdi>{member.employer}</bdi>)}
        {detail(t('fields.department'), member.department ?? '—')}
        {detail(t('fields.mobile'), member.mobile ? <bdi dir="ltr">{member.mobile}</bdi> : '—')}
        {detail(t('fields.email'), member.email ? <bdi dir="ltr">{member.email}</bdi> : '—')}
        {detail(
          t('fields.status'),
          <span className="flex flex-col gap-1">
            <StatusChip status={member.status} />
            <span className="text-sm text-muted-foreground">
              {t('since', { date: calendarDate(member.statusSince) })}
              {member.statusReason ? ` · ${member.statusReason}` : ''}
            </span>
          </span>,
        )}
        {detail(
          t('fields.medical'),
          member.medical.fitness
            ? fitness(member.medical.fitness)
            : t('records.medicalNotRecorded'),
        )}
        {detail(
          t('fields.compliance'),
          <ComplianceBadge compliance={member.compliance} detailed />,
        )}
        {detail(
          t('fields.linkedUser'),
          member.linkedUser ? <bdi>{member.linkedUser.fullName}</bdi> : t('noLinkedUser'),
        )}
      </dl>

      <section className="flex flex-col gap-2" aria-labelledby="current-assignments">
        <h2 id="current-assignments" className="text-lg font-semibold">
          {t('currentAssignments')}
        </h2>
        {member.currentAssignments.length === 0 ? (
          <p className="text-muted-foreground">{t('assignments.none')}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {member.currentAssignments.map((row) => (
              <li key={row.id} className="rounded-xl border border-border p-4">
                <bdi dir="ltr" className="font-mono">
                  {row.project.code}
                </bdi>{' '}
                · <bdi>{row.project.name}</bdi> · {positionName(row.position)} ·{' '}
                {t(`assignments.state.${row.state}`)}
              </li>
            ))}
          </ul>
        )}
      </section>

      {editable || (can.linkUser && !readOnly) ? (
        <div className="flex flex-wrap gap-2">
          {editable ? (
            <>
              <Button
                variant="secondary"
                onClick={() => {
                  setDialog('edit');
                }}
              >
                {t('editDetails')}
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setDialog('status');
                }}
              >
                {t('changeStatus')}
              </Button>
              <PhotoButtons
                member={member}
                onDone={(text) => {
                  run(Promise.resolve(null), text);
                }}
              />
            </>
          ) : null}
          {can.linkUser && !member.archived ? (
            member.linkedUser ? (
              <Button
                variant="secondary"
                onClick={() => {
                  run(workforceService.unlink(member.id), t('unlinked'));
                }}
              >
                {t('unlinkAccount')}
              </Button>
            ) : (
              <Button
                variant="secondary"
                onClick={() => {
                  setDialog('link');
                }}
              >
                {t('linkAccount')}
              </Button>
            )
          ) : null}
          {editable && LEAVING_STATUSES.includes(member.status) ? (
            <Button
              variant="danger"
              onClick={() => {
                setDialog('archive');
              }}
            >
              {t('archive')}
            </Button>
          ) : null}
        </div>
      ) : null}
      {!readOnly && can.manage && member.archived ? (
        <Button
          variant="secondary"
          className="w-fit"
          onClick={() => {
            run(workforceService.restore(member.id), t('restored'));
          }}
        >
          {t('restore')}
        </Button>
      ) : null}

      <EditDialog
        open={dialog === 'edit'}
        member={member}
        companyName={company?.name ?? ''}
        onClose={() => {
          setDialog(null);
        }}
        onSaved={(next) => {
          setDialog(null);
          onChanged(next);
          setNotice({ tone: 'success', text: t('saved') });
        }}
      />
      <StatusDialog
        open={dialog === 'status'}
        member={member}
        onClose={() => {
          setDialog(null);
        }}
        onSaved={(next) => {
          setDialog(null);
          onChanged(next);
          setNotice({ tone: 'success', text: t('statusSaved') });
        }}
      />
      <LinkDialog
        open={dialog === 'link'}
        member={member}
        onClose={() => {
          setDialog(null);
        }}
        onSaved={(next) => {
          setDialog(null);
          onChanged(next);
          setNotice({ tone: 'success', text: t('linked') });
        }}
      />
      <ConfirmDialog
        open={dialog === 'archive'}
        title={t('archiveTitle')}
        body={t('archiveBody', { name: member.fullName })}
        confirmLabel={t('archive')}
        cancelLabel={tc('cancel')}
        tone="danger"
        onConfirm={() => {
          setDialog(null);
          run(workforceService.archive(member.id), t('archived'));
        }}
        onCancel={() => {
          setDialog(null);
        }}
      />
    </div>
  );
}

function PhotoButtons({
  member,
  onDone,
}: {
  member: WorkforceMemberDto;
  onDone: (text: string) => void;
}) {
  const t = useTranslations('workforce');
  const errorMessage = useErrorMessage();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <label className="inline-flex min-h-12 cursor-pointer items-center rounded-lg border border-border px-4 font-medium hover:bg-muted">
        {member.photoUrl ? t('changePhoto') : t('addPhoto')}
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            workforceService.uploadPhoto(member.id, file).then(
              () => {
                onDone(t('photoSaved'));
              },
              (failure: unknown) => {
                setError(errorMessage(failure));
              },
            );
          }}
        />
      </label>
      {member.photoUrl ? (
        <Button
          variant="secondary"
          onClick={() => {
            workforceService.removePhoto(member.id).then(
              () => {
                onDone(t('photoRemoved'));
              },
              (failure: unknown) => {
                setError(errorMessage(failure));
              },
            );
          }}
        >
          {t('removePhoto')}
        </Button>
      ) : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
    </>
  );
}

function EditDialog({
  open,
  member,
  companyName,
  onClose,
  onSaved,
}: {
  open: boolean;
  member: WorkforceMemberDto;
  companyName: string;
  onClose: () => void;
  onSaved: (member: WorkforceMemberDto) => void;
}) {
  const t = useTranslations('workforce');
  const te = useTranslations('workforce.errors');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const fieldErrors = useFieldErrors();
  const [values, setValues] = useState<PersonValues>(() => valuesOf(member, companyName));
  const [errors, setErrors] = useState<Partial<Record<keyof PersonValues, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setValues(valuesOf(member, companyName));
      setErrors({});
      setFormError(null);
    }
  }
  return (
    <FormDialog
      open={open}
      title={t('editDetails')}
      error={formError}
      saving={saving}
      submitLabel={t('save')}
      cancelLabel={tc('cancel')}
      onClose={onClose}
      onSubmit={() => {
        const found = checkPerson(values, te);
        setErrors(found);
        if (Object.keys(found).length > 0) return;
        setSaving(true);
        workforceService
          .update(member.id, requestOf(values))
          .then(onSaved, (failure: unknown) => {
            const fields = fieldErrors(failure);
            if (fields) setErrors(fields);
            else setFormError(errorMessage(failure));
          })
          .finally(() => {
            setSaving(false);
          });
      }}
    >
      <PersonFields values={values} errors={errors} onChange={setValues} />
    </FormDialog>
  );
}

function StatusDialog({
  open,
  member,
  onClose,
  onSaved,
}: {
  open: boolean;
  member: WorkforceMemberDto;
  onClose: () => void;
  onSaved: (member: WorkforceMemberDto) => void;
}) {
  const t = useTranslations('workforce');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const [status, setStatus] = useState<WorkforceStatus>(member.status);
  const [since, setSince] = useState(todayIso);
  const [reason, setReason] = useState('');
  const [endAssignments, setEndAssignments] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const leaving = LEAVING_STATUSES.includes(status);
  const open_ = member.currentAssignments.length;
  return (
    <FormDialog
      open={open}
      title={t('changeStatus')}
      error={error}
      saving={saving}
      submitLabel={t('save')}
      cancelLabel={tc('cancel')}
      onClose={onClose}
      onSubmit={() => {
        setSaving(true);
        setError(null);
        workforceService
          .changeStatus(member.id, {
            status,
            since,
            reason,
            endAssignments: leaving && endAssignments,
          })
          .then(onSaved, (failure: unknown) => {
            setError(errorMessage(failure));
          })
          .finally(() => {
            setSaving(false);
          });
      }}
    >
      <FormField
        id="status-value"
        label={t('fields.status')}
        required
        requiredLabel={tc('required')}
      >
        <Select
          id="status-value"
          value={status}
          onChange={(event) => {
            setStatus(event.target.value as WorkforceStatus);
          }}
        >
          {WORKFORCE_STATUSES.map((value) => (
            <option key={value} value={value}>
              {t(`status.${value}`)}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField id="status-since" label={t('sinceLabel')} required requiredLabel={tc('required')}>
        <Input
          id="status-since"
          type="date"
          value={since}
          max={todayIso()}
          onChange={(event) => {
            setSince(event.target.value);
          }}
        />
      </FormField>
      <FormField id="status-reason" label={t('reason')}>
        <Input
          id="status-reason"
          value={reason}
          onChange={(event) => {
            setReason(event.target.value);
          }}
        />
      </FormField>
      {leaving && open_ > 0 ? (
        <Checkbox
          id="status-end"
          label={t('endAssignments', { count: open_ })}
          checked={endAssignments}
          onChange={(event) => {
            setEndAssignments(event.target.checked);
          }}
        />
      ) : null}
    </FormDialog>
  );
}

function LinkDialog({
  open,
  member,
  onClose,
  onSaved,
}: {
  open: boolean;
  member: WorkforceMemberDto;
  onClose: () => void;
  onSaved: (member: WorkforceMemberDto) => void;
}) {
  const t = useTranslations('workforce');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const [search, setSearch] = useState('');
  const [users, setUsers] = useState<{ id: string; fullName: string; email: string }[]>([]);
  const [userId, setUserId] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      workforceService.userCandidates(search).then(setUsers, () => undefined);
    }, 250);
    return () => {
      window.clearTimeout(timer);
    };
  }, [open, search]);
  return (
    <FormDialog
      open={open}
      title={t('linkAccount')}
      error={error}
      submitLabel={t('link')}
      cancelLabel={tc('cancel')}
      onClose={onClose}
      onSubmit={() => {
        if (!userId) {
          setError(t('chooseAccount'));
          return;
        }
        workforceService.link(member.id, userId).then(onSaved, (failure: unknown) => {
          setError(errorMessage(failure));
        });
      }}
    >
      <p className="text-sm text-muted-foreground">{t('linkHint')}</p>
      <FormField id="link-search" label={t('searchAccounts')}>
        <Input
          id="link-search"
          type="search"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
          }}
        />
      </FormField>
      <ul className="flex flex-col gap-1">
        {users.map((user) => (
          <li key={user.id}>
            <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-lg px-2 hover:bg-muted">
              <input
                type="radio"
                name="link-user"
                checked={userId === user.id}
                onChange={() => {
                  setUserId(user.id);
                }}
              />
              <span className="flex flex-col">
                <bdi>{user.fullName}</bdi>
                <bdi dir="ltr" className="text-sm text-muted-foreground">
                  {user.email}
                </bdi>
              </span>
            </label>
          </li>
        ))}
      </ul>
    </FormDialog>
  );
}
