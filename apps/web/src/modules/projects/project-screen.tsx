'use client';

import type { ProjectDto, ProjectStatus } from '@hse/shared';
import { Archive, ArrowRightLeft, Pencil, RotateCcw } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useReadOnly } from '@/modules/billing/use-subscription-state';
import { useDateFormat } from '@/modules/i18n/use-date-format';
import { useErrorMessage } from '@/modules/i18n/use-error-message';
import { KeepOnDeviceSwitch } from '@/modules/offline/keep-on-device-switch';

import { ProjectFormDialog } from './project-form-dialog';
import { useCurrentProject } from './project-context';
import { projectsService } from './projects.service';

/**
 * Project Overview tab (US-016 – US-018, PLT-19): details, status, counts, and the actions the
 * user may take. The header and tabs come from `ProjectShell`.
 */
export function ProjectScreen() {
  const { project, setProject } = useCurrentProject();
  return <ProjectDetails project={project} onChange={setProject} />;
}

function ProjectDetails({
  project,
  onChange,
}: {
  project: ProjectDto;
  onChange: (project: ProjectDto) => void;
}) {
  const t = useTranslations('projects');
  const ts = useTranslations('projectStatus');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const locale = useLocale();
  const { calendarDate, date } = useDateFormat();
  const readOnly = useReadOnly();
  const [editOpen, setEditOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [nextStatus, setNextStatus] = useState<ProjectStatus | null>(null);
  const [note, setNote] = useState('');
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [confirmCode, setConfirmCode] = useState('');
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const countryName = useMemo(
    () => new Intl.DisplayNames([locale], { type: 'region', fallback: 'code' }),
    [locale],
  );

  const can = (permission: string) => !readOnly && project.myPermissions.includes(permission);
  const archived = project.status === 'archived';

  const run = async (action: () => Promise<ProjectDto>, success: string) => {
    setBusy(true);
    setNotice(null);
    try {
      onChange(await action());
      setNotice({ tone: 'success', text: success });
    } catch (error) {
      setNotice({ tone: 'danger', text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  };

  const rows: { label: string; value: string | null; ltr?: boolean }[] = [
    { label: t('clientName'), value: project.clientName },
    { label: t('contractNumber'), value: project.contractNumber, ltr: true },
    {
      label: t('location'),
      value: [project.city, countryName.of(project.countryCode)]
        .filter(Boolean)
        .join(locale.startsWith('ar') ? '، ' : ', '),
    },
    { label: t('startDate'), value: calendarDate(project.startDate) },
    { label: t('expectedEndDate'), value: calendarDate(project.expectedEndDate) },
    { label: t('statusSince'), value: date(project.statusChangedAt) },
  ];

  const tiles = [
    {
      label: t('countAreas'),
      value: project.counts.areas,
      href: `/projects/${project.id}/structure`,
    },
    {
      label: t('countLocations'),
      value: project.counts.locations,
      href: `/projects/${project.id}/structure`,
    },
    {
      label: t('countWorkZones'),
      value: project.counts.workZones,
      href: `/projects/${project.id}/structure`,
    },
    {
      label: t('countMembers'),
      value: project.counts.members,
      href: project.myPermissions.includes('projects.members.view')
        ? `/projects/${project.id}/members`
        : null,
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted-foreground">
        {project.acceptsRecords
          ? t('acceptsRecords')
          : t('noRecords', { status: ts(project.status) })}
      </p>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tiles.map((tile) => {
          const body = (
            <>
              <span className="text-2xl font-semibold">{tile.value}</span>
              <span className="text-sm text-muted-foreground">{tile.label}</span>
            </>
          );
          return (
            <li key={tile.label}>
              {tile.href ? (
                <Link
                  href={tile.href}
                  className="flex min-h-20 flex-col justify-center rounded-xl border border-border p-4 hover:bg-muted"
                >
                  {body}
                </Link>
              ) : (
                <div className="flex min-h-20 flex-col justify-center rounded-xl border border-border p-4">
                  {body}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {archived ? null : <KeepOnDeviceSwitch projectId={project.id} />}

      {archived ? (
        <div role="note" className="rounded-xl bg-inactive p-4 text-white">
          {t('archivedBanner', {
            date: date(project.archivedAt),
            name: project.archivedByName ?? '—',
          })}
        </div>
      ) : null}

      {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}

      {!archived && (can('projects.edit') || project.allowedNextStatuses.length > 0) ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          {can('projects.edit') ? (
            <Button
              variant="secondary"
              onClick={() => {
                setEditOpen(true);
              }}
            >
              <Pencil aria-hidden className="size-5" />
              {t('edit')}
            </Button>
          ) : null}
          {!readOnly && project.allowedNextStatuses.length > 0 ? (
            <Button
              variant="secondary"
              onClick={() => {
                setNextStatus(project.allowedNextStatuses[0] ?? null);
                setNote('');
                setStatusOpen(true);
              }}
            >
              <ArrowRightLeft aria-hidden className="size-5" />
              {t('changeStatus')}
            </Button>
          ) : null}
        </div>
      ) : null}

      <Card className="p-0">
        <dl className="divide-y divide-border">
          {rows.map((row) => (
            <div key={row.label} className="flex flex-col gap-1 px-6 py-4 sm:flex-row sm:gap-4">
              <dt className="text-sm text-muted-foreground sm:w-48">{row.label}</dt>
              <dd className="flex-1">
                {row.value ? <bdi dir={row.ltr ? 'ltr' : undefined}>{row.value}</bdi> : '—'}
              </dd>
            </div>
          ))}
          {project.description ? (
            <div className="flex flex-col gap-1 px-6 py-4">
              <dt className="text-sm text-muted-foreground">{t('description')}</dt>
              <dd className="whitespace-pre-line">{project.description}</dd>
            </div>
          ) : null}
        </dl>
      </Card>

      {can('projects.archive') ? (
        <div className="flex flex-col items-start gap-2 border-t border-border pt-6">
          {archived ? (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setRestoreOpen(true);
              }}
            >
              <RotateCcw aria-hidden className="size-5" />
              {t('restore')}
            </Button>
          ) : (
            <Button
              variant="danger"
              disabled={busy}
              onClick={() => {
                setConfirmCode('');
                setArchiveOpen(true);
              }}
            >
              <Archive aria-hidden className="size-5" />
              {t('archive')}
            </Button>
          )}
        </div>
      ) : null}

      <ProjectFormDialog
        open={editOpen}
        project={project}
        onClose={() => {
          setEditOpen(false);
        }}
        onSaved={(saved) => {
          setEditOpen(false);
          onChange(saved);
          setNotice({ tone: 'success', text: t('saved') });
        }}
      />

      <ConfirmDialog
        open={statusOpen}
        title={t('changeStatusTitle')}
        body={t('currentStatus', { status: ts(project.status) })}
        confirmLabel={t('confirmStatus')}
        cancelLabel={tc('cancel')}
        confirmDisabled={busy || nextStatus === null}
        onConfirm={() => {
          if (!nextStatus) return;
          setStatusOpen(false);
          void run(
            () =>
              projectsService.changeStatus(project.id, {
                version: project.version,
                status: nextStatus,
                note: note.trim() || null,
              }),
            t('statusChanged', { status: ts(nextStatus) }),
          );
        }}
        onCancel={() => {
          setStatusOpen(false);
        }}
      >
        <fieldset className="flex flex-col gap-2">
          <legend className="sr-only">{t('changeStatusTitle')}</legend>
          {project.allowedNextStatuses.map((status) => (
            <label
              key={status}
              className="flex min-h-12 cursor-pointer items-start gap-3 rounded-lg border border-border p-3 has-[:checked]:border-primary"
            >
              <input
                type="radio"
                name="next-status"
                className="mt-1 size-4"
                checked={nextStatus === status}
                onChange={() => {
                  setNextStatus(status);
                }}
              />
              <span className="flex flex-col">
                <span className="font-medium">{ts(status)}</span>
                <span className="text-sm text-muted-foreground">
                  {ts(`${status}Meaning` as 'activeMeaning')}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
        <label htmlFor="status-note" className="mt-4 block text-sm font-medium">
          {t('statusNote')}
        </label>
        <Textarea
          id="status-note"
          rows={2}
          maxLength={500}
          className="mt-2"
          value={note}
          onChange={(event) => {
            setNote(event.target.value);
          }}
        />
      </ConfirmDialog>

      <ConfirmDialog
        open={archiveOpen}
        title={t('archiveTitle', { name: project.name })}
        body={t('archiveBody')}
        confirmLabel={t('archive')}
        cancelLabel={tc('cancel')}
        tone="danger"
        confirmDisabled={busy || confirmCode.trim().toUpperCase() !== project.code}
        onConfirm={() => {
          setArchiveOpen(false);
          void run(() => projectsService.archive(project.id, project.version), t('archived'));
        }}
        onCancel={() => {
          setArchiveOpen(false);
        }}
      >
        <label htmlFor="archive-code" className="block text-sm font-medium">
          {t('typeCode', { code: project.code })}
        </label>
        <Input
          id="archive-code"
          dir="ltr"
          autoComplete="off"
          className="mt-2 font-mono uppercase"
          value={confirmCode}
          onChange={(event) => {
            setConfirmCode(event.target.value);
          }}
        />
      </ConfirmDialog>

      <ConfirmDialog
        open={restoreOpen}
        title={t('restoreTitle')}
        body={t('restoreBody', {
          status: ts(project.statusBeforeArchive ?? 'planning'),
        })}
        confirmLabel={t('restore')}
        cancelLabel={tc('cancel')}
        onConfirm={() => {
          setRestoreOpen(false);
          void run(() => projectsService.restore(project.id, project.version), t('restored'));
        }}
        onCancel={() => {
          setRestoreOpen(false);
        }}
      />
    </div>
  );
}
