'use client';

import type { SwitcherProjectDto } from '@hse/shared';
import { ChevronDown, FolderKanban } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState } from 'react';

import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';

import { ProjectStatusBadge } from './project-status-badge';
import { projectContextService } from './structure.service';

/** O-70: a search box once the list is longer than this. */
const SEARCH_FROM = 8;

/**
 * PLT-19: the header switcher. Shows the code of the project in the URL (T-45) or "Projects";
 * lists the user's non-archived projects, last opened first. It only navigates.
 */
export function ProjectSwitcher() {
  const t = useTranslations('switcher');
  const pathname = usePathname();
  const current = /\/projects\/([0-9a-f-]{36})/.exec(pathname)?.[1] ?? null;
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<SwitcherProjectDto[] | null>(null);
  const [search, setSearch] = useState('');
  const panelId = useId();
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      projectContextService.switcher(search).then(
        (result) => {
          setItems(result.items);
        },
        () => {
          setItems([]);
        },
      );
    }, 200);
    return () => {
      window.clearTimeout(timer);
    };
  }, [open, search]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (
        event instanceof KeyboardEvent
          ? event.key === 'Escape'
          : !container.current?.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  // The code of the project in the URL, from one list loaded with the header.
  const [codes, setCodes] = useState<Record<string, string> | null>(null);
  useEffect(() => {
    projectContextService.switcher().then(
      (result) => {
        setCodes(Object.fromEntries(result.items.map((item) => [item.id, item.code])));
      },
      () => undefined,
    );
  }, [current]);
  const currentCode = current && codes ? codes[current] : undefined;
  // O-70: users who can view no project don't see the switcher.
  if (codes !== null && Object.keys(codes).length === 0 && !current) return null;

  return (
    <div ref={container} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          setItems(null);
          setOpen(!open);
        }}
        className="inline-flex min-h-12 items-center gap-2 rounded-lg px-3 font-medium hover:bg-muted"
      >
        <FolderKanban aria-hidden className="size-5" />
        {currentCode ? (
          <bdi dir="ltr" className="font-mono">
            {currentCode}
          </bdi>
        ) : (
          <span className="sr-only sm:not-sr-only">{t('choose')}</span>
        )}
        <ChevronDown aria-hidden className="size-4" />
      </button>
      {open ? (
        <div
          id={panelId}
          role="region"
          aria-label={t('title')}
          className="fixed inset-x-0 top-14 z-20 max-h-[80dvh] overflow-y-auto border-b border-border bg-background p-3 shadow-xl sm:absolute sm:inset-x-auto sm:end-0 sm:top-full sm:mt-1 sm:w-80 sm:rounded-xl sm:border"
        >
          {(items && items.length > SEARCH_FROM) || search ? (
            <div className="mb-2">
              <label htmlFor="switcher-search" className="sr-only">
                {t('search')}
              </label>
              <Input
                id="switcher-search"
                type="search"
                placeholder={t('search')}
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                }}
              />
            </div>
          ) : null}
          {items === null ? (
            <div className="flex justify-center p-3" role="status">
              <Spinner />
            </div>
          ) : items.length === 0 ? (
            <p className="p-3 text-muted-foreground">{search ? t('noMatch') : t('none')}</p>
          ) : (
            <ul className="flex flex-col">
              {items.map((item) => (
                <li key={item.id}>
                  <Link
                    href={`/projects/${item.id}`}
                    aria-current={item.id === current ? 'page' : undefined}
                    onClick={() => {
                      setOpen(false);
                    }}
                    className="flex min-h-12 items-center gap-2 rounded-lg px-2 hover:bg-muted aria-[current=page]:bg-muted"
                  >
                    <span className="flex flex-1 flex-col">
                      <bdi dir="ltr" className="font-mono text-sm text-muted-foreground">
                        {item.code}
                      </bdi>
                      <bdi>{item.name}</bdi>
                    </span>
                    <ProjectStatusBadge status={item.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-2 border-t border-border pt-2">
            <Link
              href="/projects"
              onClick={() => {
                setOpen(false);
              }}
              className="inline-flex min-h-10 items-center rounded-lg px-2 text-sm font-medium text-primary hover:bg-muted"
            >
              {t('allProjects')}
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
