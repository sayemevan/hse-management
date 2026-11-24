'use client';

import type { PlaceDto, PlaceLevel, PlaceSelection } from '@hse/shared';
import { MapPin } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/utils/cn';

import { placesService } from './structure.service';

interface FlatPlace {
  place: PlaceDto;
  path: PlaceDto[];
}

function flatten(places: PlaceDto[], parents: PlaceDto[] = []): FlatPlace[] {
  return places.flatMap((place) => {
    const path = [...parents, place];
    return [{ place, path }, ...flatten(place.children, path)];
  });
}

function selectionOf(path: PlaceDto[]): PlaceSelection {
  const idOf = (level: PlaceLevel) => path.find((item) => item.level === level)?.id ?? null;
  return { areaId: idOf('area'), locationId: idOf('location'), workZoneId: idOf('work_zone') };
}

const SEPARATOR = ' › ';

/**
 * US-021 FR-3: the one place picker every form uses (O-56). Optional unless `required` names a
 * level; the user may stop at any level and the parents are always filled. Only active places
 * are offered; a place already on a record keeps showing (marked inactive).
 */
export function PlacePicker({
  projectId,
  value,
  onChange,
  required,
  inactiveLabel,
  id,
}: {
  projectId: string;
  value: PlaceSelection;
  onChange: (value: PlaceSelection) => void;
  required?: PlaceLevel;
  /** The path of an inactive place already on the record, shown as it is. */
  inactiveLabel?: string;
  id?: string;
}) {
  const t = useTranslations('placePicker');
  const generated = useId();
  const fieldId = id ?? generated;
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [tree, setTree] = useState<PlaceDto[] | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    placesService.tree(projectId, false).then(
      (result) => {
        setTree(result.areas);
      },
      () => {
        setTree([]);
      },
    );
  }, [projectId]);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  const flat = useMemo(() => (tree ? flatten(tree) : []), [tree]);
  const chosenId = value.workZoneId ?? value.locationId ?? value.areaId ?? null;
  const chosen = flat.find((item) => item.place.id === chosenId);
  const label = chosen
    ? chosen.path.map((item) => item.name).join(SEPARATOR)
    : chosenId && inactiveLabel
      ? `${inactiveLabel} ${t('inactive')}`
      : null;

  const needle = search.trim().toLocaleLowerCase();
  const visible = needle
    ? flat.filter(
        (item) =>
          item.place.name.toLocaleLowerCase().includes(needle) ||
          (item.place.code ?? '').toLowerCase().includes(needle),
      )
    : flat;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          id={fieldId}
          variant="secondary"
          onClick={() => {
            setSearch('');
            setOpen(true);
          }}
        >
          <MapPin aria-hidden className="size-5" />
          {label ? <bdi>{label}</bdi> : required ? t('whereRequired') : t('where')}
        </Button>
        {label && !required ? (
          <Button
            variant="ghost"
            onClick={() => {
              onChange({ areaId: null, locationId: null, workZoneId: null });
            }}
          >
            {t('clear')}
          </Button>
        ) : null}
      </div>
      <dialog
        ref={dialog}
        aria-label={t('title')}
        onCancel={(event) => {
          event.preventDefault();
          setOpen(false);
        }}
        className="m-0 h-dvh max-h-none w-full max-w-none bg-background p-0 text-foreground backdrop:bg-black/40 sm:m-auto sm:h-auto sm:max-h-[80dvh] sm:w-[calc(100%-2rem)] sm:max-w-lg sm:rounded-xl sm:border sm:border-border"
      >
        <div className="flex h-full flex-col gap-3 p-4">
          <h2 className="text-lg font-semibold">{t('title')}</h2>
          <label htmlFor={`${fieldId}-search`} className="sr-only">
            {t('search')}
          </label>
          <Input
            id={`${fieldId}-search`}
            type="search"
            placeholder={t('search')}
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
            }}
          />
          <div className="min-h-0 flex-1 overflow-y-auto">
            {tree === null ? (
              <div className="flex justify-center p-4" role="status">
                <Spinner />
              </div>
            ) : visible.length === 0 ? (
              <p className="p-4 text-muted-foreground">{t('none')}</p>
            ) : (
              <ul role="tree" aria-label={t('title')} className="flex flex-col">
                {visible.map((item) => (
                  <li
                    key={item.place.id}
                    role="treeitem"
                    aria-selected={item.place.id === chosenId}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        onChange(selectionOf(item.path));
                        setOpen(false);
                      }}
                      className={cn(
                        'flex min-h-14 w-full flex-col justify-center rounded-lg px-3 text-start hover:bg-muted',
                        item.place.id === chosenId && 'bg-muted',
                      )}
                      style={
                        needle
                          ? undefined
                          : {
                              paddingInlineStart: `${String(0.75 + (item.path.length - 1) * 1.25)}rem`,
                            }
                      }
                    >
                      <span className="font-medium">
                        {item.place.code ? (
                          <bdi dir="ltr" className="font-mono">{`${item.place.code} · `}</bdi>
                        ) : null}
                        <bdi>{item.place.name}</bdi>
                      </span>
                      {needle && item.path.length > 1 ? (
                        <span className="text-sm text-muted-foreground">
                          {item.path.map((step) => step.name).join(SEPARATOR)}
                        </span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <Button
            variant="secondary"
            onClick={() => {
              setOpen(false);
            }}
          >
            {t('done')}
          </Button>
        </div>
      </dialog>
    </div>
  );
}
