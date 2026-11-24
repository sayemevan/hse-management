'use client';

import type { ProjectMemberDto } from '@hse/shared';
import { MoreVertical, UserPlus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useState } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { useLoad } from '@/modules/app/use-load';
import { useReadOnly } from '@/modules/billing/use-subscription-state';
import { useDateFormat } from '@/modules/i18n/use-date-format';
import { useErrorMessage } from '@/modules/i18n/use-error-message';
import { cn } from '@/utils/cn';

import { AddMembersDialog, EditMemberDialog } from './add-members-dialog';
import { useCurrentProject } from './project-context';
import { membersService } from './structure.service';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Members tab (US-022): the project team, company-wide access, past members. */
export function MembersScreen() {
  const t = useTranslations('members');
  const troles = useTranslations('roles');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const { calendarDate } = useDateFormat();
  const { project, reload: reloadProject } = useCurrentProject();
  const readOnly = useReadOnly();
  const [showPast, setShowPast] = useState(false);
  // The page's "now" for the "ends soon" colour; fixed while the page is open.
  const [now] = useState(() => Date.now());
  const [search, setSearch] = useState('');
  const loaded = useLoad(
    useCallback(() => membersService.list(project.id, showPast), [project.id, showPast]),
    `${project.id}:${String(showPast)}`,
  );
  const canManage =
    !readOnly &&
    project.status !== 'archived' &&
    project.myPermissions.includes('projects.members.manage');
  const roles = useLoad(
    useCallback(
      () =>
        canManage
          ? membersService.candidates(project.id, '').then((result) => result.assignableRoles)
          : Promise.resolve([]),
      [canManage, project.id],
    ),
    `${project.id}:roles:${String(canManage)}`,
  );
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<ProjectMemberDto | null>(null);
  const [removing, setRemoving] = useState<ProjectMemberDto | null>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  const refresh = () => {
    loaded.reload();
    reloadProject();
  };

  const needle = search.trim().toLocaleLowerCase();
  const matches = (name: string, email: string | null) =>
    !needle ||
    name.toLocaleLowerCase().includes(needle) ||
    (email ?? '').toLowerCase().includes(needle);

  const stateLabel = (member: ProjectMemberDto) => {
    if (member.state === 'ended') return { text: t('stateEnded'), tone: 'bg-inactive text-white' };
    if (member.state === 'scheduled') {
      return {
        text: t('stateStarts', { date: calendarDate(member.validFrom) }),
        tone: 'bg-info-surface text-info-foreground',
      };
    }
    if (member.validUntil) {
      const soon = Date.parse(`${member.validUntil}T23:59:59Z`) - now < 14 * DAY_MS;
      return {
        text: t('stateEnds', { date: calendarDate(member.validUntil) }),
        tone: soon
          ? 'bg-warning-surface text-warning-foreground'
          : 'bg-success-surface text-success-foreground',
      };
    }
    return { text: t('stateActive'), tone: 'bg-success-surface text-success-foreground' };
  };

  const data = loaded.status === 'ready' ? loaded.value : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-1 flex-col gap-2 sm:max-w-sm">
          <label htmlFor="member-filter" className="text-sm font-medium">
            {t('search')}
          </label>
          <Input
            id="member-filter"
            type="search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
            }}
          />
        </div>
        {canManage ? (
          <Button
            onClick={() => {
              setAdding(true);
            }}
          >
            <UserPlus aria-hidden className="size-5" />
            {t('addMembers')}
          </Button>
        ) : null}
      </div>
      <Checkbox
        id="show-past"
        label={t('showPast')}
        checked={showPast}
        onChange={(event) => {
          setShowPast(event.target.checked);
        }}
      />
      {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}

      {loaded.status === 'error' ? (
        <Alert tone="danger">{errorMessage(loaded.error)}</Alert>
      ) : !data ? (
        <div className="flex items-center gap-3" role="status">
          <Spinner />
          {tc('loading')}
        </div>
      ) : (
        <>
          <section className="flex flex-col gap-2" aria-labelledby="team-heading">
            <h2 id="team-heading" className="text-lg font-semibold">
              {t('team', { count: data.team.length })}
            </h2>
            {data.team.length === 0 ? (
              <p className="text-muted-foreground">{t('emptyTeam')}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {data.team
                  .filter((member) => matches(member.user.fullName, member.user.email))
                  .map((member) => (
                    <MemberCard
                      key={member.assignmentId}
                      member={member}
                      role={troles(member.roleCode as 'worker')}
                      state={stateLabel(member)}
                      onEdit={setEditing}
                      onRemove={setRemoving}
                    />
                  ))}
              </ul>
            )}
          </section>
          <section className="flex flex-col gap-2" aria-labelledby="wide-heading">
            <h2 id="wide-heading" className="text-lg font-semibold">
              {t('companyWide')}
            </h2>
            <p className="text-sm text-muted-foreground">{t('companyWideHint')}</p>
            <ul className="flex flex-col gap-2">
              {data.companyWide
                .filter((row) => matches(row.user.fullName, row.user.email))
                .map((row) => (
                  <li
                    key={row.user.id}
                    className="flex flex-col gap-1 rounded-xl border border-border p-4"
                  >
                    <bdi className="font-medium">{row.user.fullName}</bdi>
                    <span className="text-sm text-muted-foreground">
                      {troles(row.companyRoleCode as 'worker')} · {t('allProjects')}
                    </span>
                  </li>
                ))}
            </ul>
          </section>
          {showPast ? (
            <section className="flex flex-col gap-2" aria-labelledby="past-heading">
              <h2 id="past-heading" className="text-lg font-semibold">
                {t('past')}
              </h2>
              {data.past.length === 0 ? (
                <p className="text-muted-foreground">{t('emptyPast')}</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {data.past.map((member) => (
                    <MemberCard
                      key={member.assignmentId}
                      member={member}
                      role={troles(member.roleCode as 'worker')}
                      state={stateLabel(member)}
                      onEdit={setEditing}
                      onRemove={setRemoving}
                    />
                  ))}
                </ul>
              )}
            </section>
          ) : null}
        </>
      )}

      <AddMembersDialog
        open={adding}
        projectId={project.id}
        onClose={() => {
          setAdding(false);
        }}
        onSaved={(count) => {
          setAdding(false);
          setNotice({ tone: 'success', text: t('added', { count }) });
          refresh();
        }}
      />
      <EditMemberDialog
        projectId={project.id}
        member={editing}
        assignableRoles={roles.status === 'ready' ? roles.value : []}
        onClose={() => {
          setEditing(null);
        }}
        onSaved={() => {
          setEditing(null);
          setNotice({ tone: 'success', text: t('saved') });
          refresh();
        }}
      />
      <ConfirmDialog
        open={removing !== null}
        title={t('removeTitle')}
        body={t('removeBody', {
          name: removing?.user.fullName ?? '',
          project: project.code,
        })}
        confirmLabel={t('remove')}
        cancelLabel={tc('cancel')}
        tone="danger"
        onConfirm={() => {
          const member = removing;
          setRemoving(null);
          if (!member) return;
          membersService.remove(project.id, member.assignmentId).then(
            () => {
              setNotice({ tone: 'success', text: t('removed', { name: member.user.fullName }) });
              refresh();
            },
            (error: unknown) => {
              setNotice({ tone: 'danger', text: errorMessage(error) });
            },
          );
        }}
        onCancel={() => {
          setRemoving(null);
        }}
      />
    </div>
  );
}

function MemberCard({
  member,
  role,
  state,
  onEdit,
  onRemove,
}: {
  member: ProjectMemberDto;
  role: string;
  state: { text: string; tone: string };
  onEdit: (member: ProjectMemberDto) => void;
  onRemove: (member: ProjectMemberDto) => void;
}) {
  const t = useTranslations('members');
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <li className="flex items-start gap-3 rounded-xl border border-border p-4">
      <div className="flex flex-1 flex-col gap-1">
        <bdi className="font-medium">{member.user.fullName}</bdi>
        <span className="text-sm text-muted-foreground">{role}</span>
        {member.user.email ? (
          <bdi dir="ltr" className="text-sm text-muted-foreground">
            {member.user.email}
            {member.user.phone ? ` · ${member.user.phone}` : ''}
          </bdi>
        ) : null}
        <span className={cn('w-fit rounded-full px-2 text-xs font-medium', state.tone)}>
          {state.text}
        </span>
      </div>
      {member.manageable ? (
        <div className="relative">
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={t('actionsFor', { name: member.user.fullName })}
            onClick={() => {
              setMenuOpen(!menuOpen);
            }}
            className="inline-flex min-h-12 min-w-12 items-center justify-center rounded-lg hover:bg-muted"
          >
            <MoreVertical aria-hidden className="size-5" />
          </button>
          {menuOpen ? (
            <ul
              role="menu"
              className="absolute end-0 top-full z-10 mt-1 w-44 rounded-xl border border-border bg-background py-1 shadow-xl"
            >
              <li role="none">
                <button
                  type="button"
                  role="menuitem"
                  className="flex min-h-12 w-full items-center px-4 text-start hover:bg-muted"
                  onClick={() => {
                    setMenuOpen(false);
                    onEdit(member);
                  }}
                >
                  {t('change')}
                </button>
              </li>
              <li role="none">
                <button
                  type="button"
                  role="menuitem"
                  className="flex min-h-12 w-full items-center px-4 text-start text-danger hover:bg-muted"
                  onClick={() => {
                    setMenuOpen(false);
                    onRemove(member);
                  }}
                >
                  {t('remove')}
                </button>
              </li>
            </ul>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
