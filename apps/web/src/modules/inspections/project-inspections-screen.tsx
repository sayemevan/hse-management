'use client';

import {
  addIsoDays,
  type InspectionCountsDto,
  type InspectionPageDto,
  type TemplateSummaryDto,
  zonedIsoDate,
} from '@hse/shared';
import { CalendarPlus, Play } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useId, useState } from 'react';

import { FormField } from '@/components/form/form-field';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { PersonSelect } from '@/modules/actions/person-select';
import { useLoad } from '@/modules/app/use-load';
import { useReadOnly } from '@/modules/billing/use-subscription-state';
import { useErrorMessage } from '@/modules/i18n/use-error-message';
import { useCurrentProject } from '@/modules/projects/project-context';
import { useCompany } from '@/modules/tenant/tenant-provider';
import { FormDialog } from '@/modules/workforce/workforce-ui';
import { cn } from '@/utils/cn';

import { InspectionCard, useLocalized } from './inspection-ui';
import { inspectionsService, templatesService } from './inspections.service';

const CHIPS = ['today', 'overdue', 'in_progress', 'to_review'] as const;
const COUNT_OF: Record<(typeof CHIPS)[number], keyof InspectionCountsDto> = {
  today: 'today',
  overdue: 'overdue',
  in_progress: 'inProgress',
  to_review: 'toReview',
};

/** US-033: the project's Inspections tab — counts as filters, cards, plan and start. */
export function ProjectInspectionsScreen() {
  const t = useTranslations('inspections');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const readOnly = useReadOnly();
  const { project } = useCurrentProject();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [pages, setPages] = useState<InspectionPageDto[]>([]);
  const [planning, setPlanning] = useState(false);
  const [version, setVersion] = useState(0);
  const filter = params.get('filter') ?? '';
  const cancelled = params.get('cancelled') === 'true';
  const key = `${params.toString()}#${String(version)}`;

  const setParams = useCallback(
    (changes: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [name, value] of Object.entries(changes)) {
        if (value) next.set(name, value);
        else next.delete(name);
      }
      setPages([]);
      router.replace(`${pathname}${next.size > 0 ? `?${next.toString()}` : ''}`);
    },
    [params, pathname, router],
  );

  const loaded = useLoad(
    useCallback(
      () =>
        inspectionsService.list(project.id, {
          filter: filter || undefined,
          cancelled,
        }),
      // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` covers the filters
      [project.id, key],
    ),
    `${project.id}?${key}`,
  );
  const first = loaded.status === 'ready' ? loaded.value : null;
  const items = first ? [first, ...pages].flatMap((page) => page.items) : [];
  const total = first?.total ?? 0;

  const loadMore = () => {
    inspectionsService
      .list(project.id, { filter: filter || undefined, cancelled, offset: items.length })
      .then((page) => {
        setPages((current) => [...current, page]);
      }, () => undefined);
  };

  const canPlan = Boolean(first?.canPlan) && !readOnly && project.acceptsRecords;
  const canStart = Boolean(first?.canStart) && !readOnly && project.acceptsRecords;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {canStart ? (
          <Link
            href={`/inspections/start?project=${project.id}`}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-primary px-5 font-medium text-white hover:bg-primary/90"
          >
            <Play aria-hidden className="size-5" />
            {t('start')}
          </Link>
        ) : null}
        {canPlan ? (
          <Button variant="secondary" onClick={() => { setPlanning(true); }}>
            <CalendarPlus aria-hidden className="size-5" />
            {t('plan.title')}
          </Button>
        ) : null}
      </div>

      {!project.acceptsRecords && (first?.canStart ?? false) ? <Alert tone="info">{t('notAccepting')}</Alert> : null}

      <div className="flex flex-wrap gap-2" role="group" aria-label={t('show')}>
        {CHIPS.map((chip) => {
          const pressed = filter === chip;
          return (
            <button
              key={chip}
              type="button"
              aria-pressed={pressed}
              onClick={() => { setParams({ filter: pressed ? null : chip }); }}
              className={cn(
                'inline-flex min-h-10 items-center gap-2 rounded-full border px-4 text-sm font-medium',
                pressed ? 'border-primary bg-primary text-white' : 'border-border hover:bg-muted',
              )}
            >
              {t(`chips.${chip}`)}
              {first ? <span className="rounded-full bg-background/20 px-1.5 tabular-nums">{first.counts[COUNT_OF[chip]]}</span> : null}
            </button>
          );
        })}
        <Link
          href={`/projects/${project.id}/inspections/findings`}
          className="inline-flex min-h-10 items-center gap-2 rounded-full border border-border px-4 text-sm font-medium hover:bg-muted"
        >
          {t('chips.open_findings')}
          {first ? <span className="tabular-nums">{first.counts.openFindings}</span> : null}
        </Link>
      </div>
      <Checkbox
        id="show-cancelled"
        label={t('showCancelled')}
        checked={cancelled}
        onChange={(event) => { setParams({ cancelled: event.target.checked ? 'true' : null }); }}
      />

      {loaded.status === 'error' ? (
        <Alert tone="danger">{errorMessage(loaded.error)}</Alert>
      ) : !first ? (
        <div className="flex items-center gap-3" role="status">
          <Spinner />
          {tc('loading')}
        </div>
      ) : items.length === 0 ? (
        <p className="text-muted-foreground">{t('empty')}</p>
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {items.map((item) => (
              <InspectionCard key={item.id} item={item} href={`/projects/${project.id}/inspections/${item.id}`} />
            ))}
          </ul>
          {items.length < total ? (
            <Button variant="secondary" onClick={loadMore}>
              {t('loadMore')}
            </Button>
          ) : null}
        </>
      )}

      {planning ? (
        <PlanDialog
          projectId={project.id}
          onClose={() => { setPlanning(false); }}
          onPlanned={() => {
            setPlanning(false);
            setPages([]);
            setVersion((v) => v + 1);
          }}
        />
      ) : null}
    </div>
  );
}

/** US-033: plan an inspection for an inspector (Draft). */
function PlanDialog({ projectId, onClose, onPlanned }: { projectId: string; onClose: () => void; onPlanned: () => void }) {
  const t = useTranslations('inspections.plan');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const company = useCompany();
  const pick = useLocalized();
  const templateId = useId();
  const inspectorId = useId();
  const dateId = useId();
  const noteId = useId();
  const [templates, setTemplates] = useState<TemplateSummaryDto[]>([]);
  const [template, setTemplate] = useState('');
  const [inspector, setInspector] = useState('');
  const today = zonedIsoDate(Date.now(), company?.timeZone ?? 'UTC');
  const [plannedOn, setPlannedOn] = useState(addIsoDays(today, 1));
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    templatesService.list({ status: 'active' }).then(
      (list) => { setTemplates(list.items.filter((item) => item.currentVersionId)); },
      (failure: unknown) => { setError(errorMessage(failure)); },
    );
  }, [errorMessage]);
  return (
    <FormDialog
      open
      title={t('title')}
      error={error}
      saving={saving}
      submitLabel={t('submit')}
      cancelLabel={tc('cancel')}
      onClose={onClose}
      onSubmit={() => {
        if (!template || !inspector) {
          setError(t('required'));
          return;
        }
        setSaving(true);
        inspectionsService
          .create(projectId, { mode: 'plan', templateId: template, inspectorId: inspector, plannedOn, note: note.trim() || null })
          .then(onPlanned, (failure: unknown) => { setError(errorMessage(failure)); })
          .finally(() => { setSaving(false); });
      }}
    >
      <FormField id={templateId} label={t('template')}>
        <Select id={templateId} value={template} onChange={(e) => { setTemplate(e.target.value); }}>
          <option value="">{t('chooseTemplate')}</option>
          {templates.map((item) => (
            <option key={item.id} value={item.id}>{pick({ en: item.nameEn, ar: item.nameAr })}</option>
          ))}
        </Select>
      </FormField>
      <FormField id={inspectorId} label={t('inspector')}>
        <PersonSelect id={inspectorId} projectId={projectId} value={inspector} onChange={(id) => { setInspector(id); }} />
      </FormField>
      <FormField id={dateId} label={t('plannedOn')}>
        <Input id={dateId} type="date" min={today} value={plannedOn} onChange={(e) => { setPlannedOn(e.target.value); }} />
      </FormField>
      <FormField id={noteId} label={t('note')}>
        <Textarea id={noteId} value={note} maxLength={2000} onChange={(e) => { setNote(e.target.value); }} />
      </FormField>
    </FormDialog>
  );
}
