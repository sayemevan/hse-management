'use client';

import { PLACE_CHILD_LEVEL, type PlaceDto, type PlaceLevel } from '@hse/shared';
import { ChevronDown, MoreVertical, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useState } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Spinner } from '@/components/ui/spinner';
import { useLoad } from '@/modules/app/use-load';
import { useReadOnly } from '@/modules/billing/use-subscription-state';
import { useErrorMessage } from '@/modules/i18n/use-error-message';
import { cn } from '@/utils/cn';

import { PlaceFormDialog, type PlaceFormTarget } from './place-form-dialog';
import { useCurrentProject } from './project-context';
import { placesService } from './structure.service';

function descendants(place: PlaceDto): { locations: number; workZones: number } {
  let locations = 0;
  let workZones = 0;
  for (const child of place.children) {
    if (child.active) {
      if (child.level === 'location') locations += 1;
      if (child.level === 'work_zone') workZones += 1;
    }
    const below = descendants(child);
    locations += below.locations;
    workZones += below.workZones;
  }
  return { locations, workZones };
}

/** Structure tab: the Areas → Locations → Work Zones tree (US-019 – US-021). */
export function StructureScreen() {
  const t = useTranslations('structure');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const { project, reload: reloadProject } = useCurrentProject();
  const readOnly = useReadOnly();
  const [showInactive, setShowInactive] = useState(false);
  const loaded = useLoad(
    useCallback(() => placesService.tree(project.id, showInactive), [project.id, showInactive]),
    `${project.id}:${String(showInactive)}`,
  );
  const [form, setForm] = useState<PlaceFormTarget | null>(null);
  const [deactivating, setDeactivating] = useState<PlaceDto | null>(null);
  const [deleting, setDeleting] = useState<PlaceDto | null>(null);
  const [notice, setNotice] = useState<{
    tone: 'success' | 'danger' | 'info';
    text: string;
  } | null>(null);
  const archived = project.status === 'archived';
  const canManage =
    !readOnly && !archived && project.myPermissions.includes('projects.structure.manage');

  const refresh = () => {
    loaded.reload();
    reloadProject();
  };

  const run = async (action: () => Promise<void>, success: string | null) => {
    setNotice(null);
    try {
      await action();
      if (success) setNotice({ tone: 'success', text: success });
      refresh();
    } catch (error) {
      setNotice({ tone: 'danger', text: errorMessage(error) });
    }
  };

  const askDelete = (place: PlaceDto) => {
    if (place.children.length > 0) {
      setNotice({ tone: 'info', text: t(`hasChildren.${place.level}`, { name: place.name }) });
      return;
    }
    setDeleting(place);
  };

  const areas = loaded.status === 'ready' ? loaded.value.areas : null;

  return (
    <div className="flex flex-col gap-4">
      {archived ? (
        <div role="note" className="rounded-xl bg-inactive p-4 text-white">
          {t('archivedNote')}
        </div>
      ) : null}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Checkbox
          id="show-inactive"
          label={t('showInactive')}
          checked={showInactive}
          onChange={(event) => {
            setShowInactive(event.target.checked);
          }}
        />
        {canManage ? (
          <Button
            onClick={() => {
              setForm({ mode: 'create', level: 'area', parent: null });
            }}
          >
            <Plus aria-hidden className="size-5" />
            {t('addArea')}
          </Button>
        ) : null}
      </div>
      {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}

      {loaded.status === 'error' ? (
        <Alert tone="danger">{errorMessage(loaded.error)}</Alert>
      ) : areas === null ? (
        <div className="flex items-center gap-3" role="status">
          <Spinner />
          {tc('loading')}
        </div>
      ) : areas.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-6 text-muted-foreground">
          {t('empty')}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {areas.map((area, index) => (
            <PlaceNode
              key={area.id}
              place={area}
              first={index === 0}
              last={index === areas.length - 1}
              canManage={canManage}
              onAdd={(parent, level) => {
                setForm({ mode: 'create', level, parent });
              }}
              onEdit={(place) => {
                setForm({ mode: 'edit', place });
              }}
              onMove={(place, direction) =>
                void run(() => placesService.move(project.id, place.id, direction), null)
              }
              onDeactivate={setDeactivating}
              onReactivate={(place) =>
                void run(
                  () => placesService.reactivate(project.id, place.id),
                  t('reactivated', { name: place.name }),
                )
              }
              onDelete={askDelete}
            />
          ))}
        </ul>
      )}

      <PlaceFormDialog
        projectId={project.id}
        target={form}
        onClose={() => {
          setForm(null);
        }}
        onSaved={() => {
          setForm(null);
          setNotice({ tone: 'success', text: t('saved') });
          refresh();
        }}
      />

      <ConfirmDialog
        open={deactivating !== null}
        title={t('deactivateTitle', { name: deactivating?.name ?? '' })}
        body={
          deactivating
            ? t('deactivateBody', {
                name: deactivating.name,
                ...descendants(deactivating),
              })
            : ''
        }
        confirmLabel={t('deactivate')}
        cancelLabel={tc('cancel')}
        tone="danger"
        onConfirm={() => {
          const place = deactivating;
          setDeactivating(null);
          if (place) {
            void run(
              () => placesService.deactivate(project.id, place.id),
              t('deactivated', { name: place.name }),
            );
          }
        }}
        onCancel={() => {
          setDeactivating(null);
        }}
      />

      <ConfirmDialog
        open={deleting !== null}
        title={t('deleteTitle', { name: deleting?.name ?? '' })}
        body={t('deleteBody')}
        confirmLabel={t('delete')}
        cancelLabel={tc('cancel')}
        tone="danger"
        onConfirm={() => {
          const place = deleting;
          setDeleting(null);
          if (!place) return;
          void run(
            () => placesService.remove(project.id, place.id),
            t('deleted', { name: place.name }),
          );
        }}
        onCancel={() => {
          setDeleting(null);
        }}
      />
    </div>
  );
}

function PlaceNode({
  place,
  first,
  last,
  canManage,
  onAdd,
  onEdit,
  onMove,
  onDeactivate,
  onReactivate,
  onDelete,
}: {
  place: PlaceDto;
  first: boolean;
  last: boolean;
  canManage: boolean;
  onAdd: (parent: PlaceDto, level: PlaceLevel) => void;
  onEdit: (place: PlaceDto) => void;
  onMove: (place: PlaceDto, direction: 'up' | 'down') => void;
  onDeactivate: (place: PlaceDto) => void;
  onReactivate: (place: PlaceDto) => void;
  onDelete: (place: PlaceDto) => void;
}) {
  const t = useTranslations('structure');
  const [expanded, setExpanded] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const childLevel = PLACE_CHILD_LEVEL[place.level];
  const childCount = place.children.length;

  const actions = [
    {
      label: t('edit'),
      run: () => {
        onEdit(place);
      },
      show: true,
    },
    {
      label: t('moveUp'),
      run: () => {
        onMove(place, 'up');
      },
      show: !first,
    },
    {
      label: t('moveDown'),
      run: () => {
        onMove(place, 'down');
      },
      show: !last,
    },
    {
      label: childLevel ? t(`add.${childLevel}`) : '',
      run: () => {
        if (childLevel) onAdd(place, childLevel);
      },
      show: Boolean(childLevel) && place.active,
    },
    {
      label: place.active ? t('deactivate') : t('reactivate'),
      run: () => {
        if (place.active) onDeactivate(place);
        else onReactivate(place);
      },
      show: true,
    },
    {
      label: t('delete'),
      run: () => {
        onDelete(place);
      },
      show: true,
    },
  ].filter((action) => action.show);

  return (
    <li
      className={cn(
        'rounded-xl border border-border',
        place.level === 'area' ? 'bg-background' : 'border-dashed',
      )}
    >
      <div className="flex items-center gap-2 p-2">
        {childCount > 0 ? (
          <button
            type="button"
            aria-expanded={expanded}
            aria-label={
              expanded ? t('collapse', { name: place.name }) : t('expand', { name: place.name })
            }
            onClick={() => {
              setExpanded(!expanded);
            }}
            className="inline-flex min-h-12 min-w-12 items-center justify-center rounded-lg hover:bg-muted"
          >
            <ChevronDown
              aria-hidden
              className={cn('size-5 transition-transform', !expanded && '-rotate-90 rtl:rotate-90')}
            />
          </button>
        ) : (
          <span className="min-w-12" aria-hidden />
        )}
        <div className="flex flex-1 flex-col">
          <span className={cn('font-medium', !place.active && 'text-muted-foreground')}>
            {place.code ? (
              <bdi dir="ltr" className="font-mono">
                {place.code}
              </bdi>
            ) : null}
            {place.code ? ' · ' : ''}
            <bdi>{place.name}</bdi>
          </span>
          <span className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            {t(`level.${place.level}`)}
            {childLevel ? ` · ${t(`childCount.${childLevel}`, { count: childCount })}` : ''}
            {!place.active ? (
              <span className="rounded-full bg-inactive px-2 text-xs font-medium text-white">
                {t('inactive')}
              </span>
            ) : null}
          </span>
        </div>
        {canManage ? (
          <div className="relative">
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label={t('actionsFor', { name: place.name })}
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
                className="absolute end-0 top-full z-10 mt-1 w-56 rounded-xl border border-border bg-background py-1 shadow-xl"
                onKeyDown={(event) => {
                  if (event.key === 'Escape') setMenuOpen(false);
                }}
              >
                {actions.map((action) => (
                  <li key={action.label} role="none">
                    <button
                      type="button"
                      role="menuitem"
                      className="flex min-h-12 w-full items-center px-4 text-start hover:bg-muted"
                      onClick={() => {
                        setMenuOpen(false);
                        action.run();
                      }}
                    >
                      {action.label}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
      {expanded && childCount > 0 ? (
        <ul className="flex flex-col gap-2 px-2 pb-2 ps-6">
          {place.children.map((child, index) => (
            <PlaceNode
              key={child.id}
              place={child}
              first={index === 0}
              last={index === childCount - 1}
              canManage={canManage}
              onAdd={onAdd}
              onEdit={onEdit}
              onMove={onMove}
              onDeactivate={onDeactivate}
              onReactivate={onReactivate}
              onDelete={onDelete}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}
