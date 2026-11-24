'use client';

import {
  COMPANY_ROLES,
  type CompanyRole,
  type ProjectRoleAssignmentDto,
  type UserDetailDto,
} from '@hse/shared';
import { ArrowLeft, FolderPlus, Pencil, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useCallback, useState } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Select } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { useLoad } from '@/modules/app/use-load';
import { useAuth } from '@/modules/auth/auth-provider';
import { hasPermission } from '@/modules/auth/require-permission';
import { useReadOnly } from '@/modules/billing/use-subscription-state';
import { useDateFormat } from '@/modules/i18n/use-date-format';
import { useErrorMessage } from '@/modules/i18n/use-error-message';
import { cn } from '@/utils/cn';

import { accessService } from './access.service';
import { ProjectRoleDialog } from './project-role-dialog';

const STATE_STYLES = {
  active: 'bg-success-surface text-success-foreground',
  scheduled: 'bg-info-surface text-info-foreground',
  ended: 'bg-muted text-muted-foreground',
} as const;

/** Settings → Users → a user (US-008): company role and project roles. */
export function UserDetailScreen({ id }: { id: string }) {
  const t = useTranslations('userAccess');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const loaded = useLoad(
    useCallback(() => accessService.user(id), [id]),
    id,
  );
  const [override, setOverride] = useState<UserDetailDto | null>(null);
  const detail = override ?? (loaded.status === 'ready' ? loaded.value : null);

  if (!detail && loaded.status === 'loading') {
    return (
      <div className="flex items-center gap-3" role="status">
        <Spinner />
        {tc('loading')}
      </div>
    );
  }
  if (!detail) {
    return (
      <div className="flex flex-col items-start gap-3">
        <BackLink label={t('back')} />
        <Alert tone="danger">
          {loaded.status === 'error' ? errorMessage(loaded.error) : tc('loading')}
        </Alert>
      </div>
    );
  }
  return <Details detail={detail} onChange={setOverride} />;
}

function BackLink({ label }: { label: string }) {
  return (
    <Link
      href="/settings/users"
      className="inline-flex items-center gap-2 text-sm font-medium text-primary underline-offset-4 hover:underline"
    >
      <ArrowLeft aria-hidden className="size-4 rtl:-scale-x-100" />
      {label}
    </Link>
  );
}

function Details({
  detail,
  onChange,
}: {
  detail: UserDetailDto;
  onChange: (detail: UserDetailDto) => void;
}) {
  const t = useTranslations('userAccess');
  const troles = useTranslations('roles');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const { user } = useAuth();
  const { calendarDate, date } = useDateFormat();
  const readOnly = useReadOnly();
  const canAssign = !readOnly && hasPermission(user, 'users.roles.assign');
  const [roleOpen, setRoleOpen] = useState(false);
  const [newRole, setNewRole] = useState<CompanyRole>(
    (detail.companyRole as CompanyRole | null) ?? 'worker',
  );
  const [dialog, setDialog] = useState<{ editing: ProjectRoleAssignmentDto | null } | null>(null);
  const [removeTarget, setRemoveTarget] = useState<ProjectRoleAssignmentDto | null>(null);
  const [showPast, setShowPast] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  const dates = (role: ProjectRoleAssignmentDto) => {
    if (role.state === 'scheduled') return t('startsOn', { date: calendarDate(role.validFrom) });
    if (role.state === 'ended') return t('endedOn', { date: calendarDate(role.validUntil) });
    return role.validUntil ? t('untilDate', { date: calendarDate(role.validUntil) }) : t('noEnd');
  };

  const changeRole = async () => {
    setRoleOpen(false);
    setNotice(null);
    try {
      onChange(await accessService.changeCompanyRole(detail.id, newRole));
      setNotice({ tone: 'success', text: t('roleChanged', { role: troles(newRole) }) });
    } catch (error) {
      setNotice({ tone: 'danger', text: errorMessage(error) });
    }
  };

  const remove = async (role: ProjectRoleAssignmentDto) => {
    setRemoveTarget(null);
    setNotice(null);
    try {
      await accessService.removeProjectRole(detail.id, role.id);
      onChange(await accessService.user(detail.id));
      setNotice({ tone: 'success', text: t('removed', { project: role.projectName }) });
    } catch (error) {
      setNotice({ tone: 'danger', text: errorMessage(error) });
    }
  };

  const roleCard = (role: ProjectRoleAssignmentDto, past: boolean) => (
    <li key={role.id}>
      <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <bdi dir="ltr" className="font-mono text-sm text-muted-foreground">
              {role.projectCode}
            </bdi>
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-xs font-medium',
                STATE_STYLES[role.state],
              )}
            >
              {t(`state.${role.state}`)}
            </span>
          </div>
          <Link href={`/projects/${role.projectId}`} className="font-semibold hover:underline">
            <bdi>{role.projectName}</bdi>
          </Link>
          <span className="text-sm">{troles(role.roleCode as 'worker')}</span>
          <span className="text-sm text-muted-foreground">{dates(role)}</span>
        </div>
        {canAssign && !past ? (
          <div className="flex gap-2">
            {role.projectStatus === 'archived' ? null : (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setDialog({ editing: role });
                }}
              >
                <Pencil aria-hidden className="size-4" />
                {t('edit')}
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setRemoveTarget(role);
              }}
            >
              <Trash2 aria-hidden className="size-4" />
              {t('remove')}
            </Button>
          </div>
        ) : null}
      </Card>
    </li>
  );

  return (
    <div className="flex flex-col gap-6">
      <BackLink label={t('back')} />
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">
          <bdi>{detail.fullName}</bdi>
        </h1>
        <bdi dir="ltr" className="text-start text-muted-foreground">
          {detail.email}
        </bdi>
        <span className="text-sm text-muted-foreground">
          {t('lastSignIn', { date: date(detail.lastLoginAt) })}
        </span>
      </div>

      {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}

      <Card className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex flex-1 flex-col gap-1">
          <h2 className="text-sm font-semibold text-muted-foreground">{t('companyRole')}</h2>
          <span className="text-lg font-medium">
            {detail.companyRole ? troles(detail.companyRole as 'worker') : '—'}
          </span>
          {detail.companyRole ? (
            <span className="text-sm text-muted-foreground">
              {troles(`${detail.companyRole}Description` as 'workerDescription')}
            </span>
          ) : null}
        </div>
        {canAssign ? (
          <Button
            variant="secondary"
            onClick={() => {
              setNewRole((detail.companyRole as CompanyRole | null) ?? 'worker');
              setRoleOpen(true);
            }}
          >
            {t('change')}
          </Button>
        ) : null}
      </Card>

      <section className="flex flex-col gap-3" aria-labelledby="project-roles-title">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="project-roles-title" className="text-lg font-semibold">
            {t('projectRoles')}
          </h2>
          {canAssign ? (
            <Button
              variant="secondary"
              onClick={() => {
                setDialog({ editing: null });
              }}
            >
              <FolderPlus aria-hidden className="size-5" />
              {t('addToProject')}
            </Button>
          ) : null}
        </div>
        {detail.projectRoles.length === 0 ? (
          <p className="text-muted-foreground">{t('noProjectRoles')}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {detail.projectRoles.map((role) => roleCard(role, false))}
          </ul>
        )}
        {detail.pastProjectRoles.length > 0 ? (
          <div className="flex flex-col gap-3">
            <Button
              variant="link"
              className="self-start px-0"
              aria-expanded={showPast}
              onClick={() => {
                setShowPast((current) => !current);
              }}
            >
              {t('pastRoles', { count: detail.pastProjectRoles.length })}
            </Button>
            {showPast ? (
              <ul className="flex flex-col gap-3">
                {detail.pastProjectRoles.map((role) => roleCard(role, true))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </section>

      <ConfirmDialog
        open={roleOpen}
        title={t('changeRoleTitle', { name: detail.fullName })}
        body={t('changeRoleBody')}
        confirmLabel={t('change')}
        cancelLabel={tc('cancel')}
        onConfirm={() => void changeRole()}
        onCancel={() => {
          setRoleOpen(false);
        }}
      >
        <label htmlFor="company-role" className="sr-only">
          {t('companyRole')}
        </label>
        <Select
          id="company-role"
          value={newRole}
          onChange={(event) => {
            setNewRole(event.target.value as CompanyRole);
          }}
        >
          {COMPANY_ROLES.map((role) => (
            <option key={role} value={role}>
              {troles(role)}
            </option>
          ))}
        </Select>
        <p className="mt-2 text-sm text-muted-foreground">
          {troles(`${newRole}Description` as 'workerDescription')}
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={removeTarget !== null}
        title={t('removeTitle')}
        body={t('removeBody', {
          name: detail.fullName,
          project: removeTarget?.projectName ?? '',
        })}
        confirmLabel={t('remove')}
        cancelLabel={tc('cancel')}
        tone="danger"
        onConfirm={() => {
          if (removeTarget) void remove(removeTarget);
        }}
        onCancel={() => {
          setRemoveTarget(null);
        }}
      />

      <ProjectRoleDialog
        open={dialog !== null}
        userId={detail.id}
        editing={dialog?.editing ?? null}
        onClose={() => {
          setDialog(null);
        }}
        onSaved={(saved) => {
          setDialog(null);
          onChange(saved);
          setNotice({ tone: 'success', text: t('projectRoleSaved') });
        }}
      />
    </div>
  );
}
