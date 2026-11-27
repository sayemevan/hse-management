'use client';

import { FINDING_SEVERITIES, type FindingPageDto } from '@hse/shared';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useCallback, useState } from 'react';

import { Alert } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import { Select } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { PriorityChip } from '@/modules/actions/action-ui';
import { useLoad } from '@/modules/app/use-load';
import { useDateFormat } from '@/modules/i18n/use-date-format';
import { useErrorMessage } from '@/modules/i18n/use-error-message';
import { useCurrentProject } from '@/modules/projects/project-context';

import { inspectionsService } from './inspections.service';

/** US-039: the project's open findings across inspections. */
export function FindingsScreen() {
  const t = useTranslations('inspections.findings');
  const tf = useTranslations('inspections.findingStatus');
  const tp = useTranslations('actions.priority');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const { calendarDate } = useDateFormat();
  const { project } = useCurrentProject();
  const [severity, setSeverity] = useState('');
  const [overdue, setOverdue] = useState(false);
  const loaded = useLoad(
    useCallback(
      () => inspectionsService.findings(project.id, { severity: severity || undefined, overdue }),
      [project.id, severity, overdue],
    ),
    `${project.id}:${severity}:${String(overdue)}`,
  );
  const page: FindingPageDto | null = loaded.status === 'ready' ? loaded.value : null;
  return (
    <div className="flex flex-col gap-4">
      <Link href={`/projects/${project.id}/inspections`} className="text-sm text-primary underline-offset-4 hover:underline">
        {t('backToInspections')}
      </Link>
      <h2 className="text-lg font-semibold">{t('openTitle')}</h2>
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="finding-severity" className="text-sm font-medium">{t('severity')}</label>
          <Select id="finding-severity" value={severity} onChange={(e) => { setSeverity(e.target.value); }}>
            <option value="">{t('any')}</option>
            {FINDING_SEVERITIES.map((s) => <option key={s} value={s}>{tp(s)}</option>)}
          </Select>
        </div>
        <Checkbox id="finding-overdue" label={t('overdueOnly')} checked={overdue} onChange={(e) => { setOverdue(e.target.checked); }} />
      </div>
      {loaded.status === 'error' ? (
        <Alert tone="danger">{errorMessage(loaded.error)}</Alert>
      ) : !page ? (
        <div className="flex items-center gap-3" role="status"><Spinner />{tc('loading')}</div>
      ) : page.items.length === 0 ? (
        <p className="text-muted-foreground">{t('none')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {page.items.map((f) => (
            <li key={f.id}>
              <Link
                href={`/projects/${project.id}/inspections/${f.inspectionId}#finding-${f.id}`}
                className="flex flex-col gap-1 rounded-xl border border-border p-3 hover:bg-muted/50"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <bdi dir="ltr" className="text-sm font-semibold">{f.inspectionReference}</bdi>
                  <span className="text-sm">{t('number', { number: f.seq })}</span>
                  <PriorityChip priority={f.severity} />
                  <span className="rounded-full border border-border px-2 py-0.5 text-xs">{tf(f.status)}</span>
                </div>
                <p className="text-sm">{f.description}</p>
                <p className="text-sm text-muted-foreground">
                  {[f.placeName, f.responsible?.name, t('due', { date: calendarDate(f.dueOn) })].filter(Boolean).join(' · ')}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
