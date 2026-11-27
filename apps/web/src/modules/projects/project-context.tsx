'use client';

import type { ProjectDto } from '@hse/shared';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { Alert } from '@/components/ui/alert';
import { Spinner } from '@/components/ui/spinner';
import { useLoad } from '@/modules/app/use-load';
import { useAuth } from '@/modules/auth/auth-provider';
import { useErrorMessage } from '@/modules/i18n/use-error-message';
import { projectOpened } from '@/modules/offline/offline-profile';
import { cn } from '@/utils/cn';

import { ProjectStatusBadge } from './project-status-badge';
import { projectsService } from './projects.service';
import { projectContextService } from './structure.service';

interface CurrentProject {
  project: ProjectDto;
  /** Replace the project after a change (the server's answer). */
  setProject: (project: ProjectDto) => void;
  /** Fetch it again (counts, permissions). */
  reload: () => void;
}

const ProjectContext = createContext<CurrentProject | null>(null);

/**
 * PLT-19 FR-7: the project of the current URL and the caller's permissions on it, for every
 * screen under `/projects/{id}/…` (T-45). Later modules use it too.
 */
export function useCurrentProject(): CurrentProject {
  const value = useContext(ProjectContext);
  if (!value) throw new Error('useCurrentProject() outside a project page');
  return value;
}

function BackLink({ label }: { label: string }) {
  return (
    <Link
      href="/projects"
      className="inline-flex items-center gap-2 text-sm font-medium text-primary underline-offset-4 hover:underline"
    >
      <ArrowLeft aria-hidden className="size-4 rtl:-scale-x-100" />
      {label}
    </Link>
  );
}

/** Loads the project once for all its tabs and shows its header and tab bar (PLT-19). */
export function ProjectShell({ id, children }: { id: string; children: ReactNode }) {
  const t = useTranslations('projects');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const loaded = useLoad(
    useCallback(() => projectsService.get(id), [id]),
    id,
  );
  const [override, setOverride] = useState<ProjectDto | null>(null);
  const project = override?.id === id ? override : loaded.status === 'ready' ? loaded.value : null;
  // Refresh in place: the tabs stay mounted (and keep their filters) until the new data arrives.
  const reload = useCallback(() => {
    projectsService.get(id).then(setOverride, () => undefined);
  }, [id]);

  // PLT-19 FR-3: remember the last project opened (fire-and-forget).
  // PLT-26: and keep its offline pack on the device (the last 3 opened, plus pinned ones).
  const userId = useAuth().user?.id;
  useEffect(() => {
    if (loaded.status !== 'ready') return;
    void projectContextService.rememberLastProject(id).catch(() => undefined);
    if (userId) void projectOpened(userId, id).catch(() => undefined);
  }, [id, loaded.status, userId]);

  const value = useMemo<CurrentProject | null>(
    () =>
      project
        ? {
            project,
            setProject: setOverride,
            reload,
          }
        : null,
    [project, reload],
  );

  if (!value) {
    if (loaded.status === 'error') {
      return (
        <div className="flex flex-col items-start gap-3">
          <BackLink label={t('back')} />
          <Alert tone="danger">{errorMessage(loaded.error)}</Alert>
        </div>
      );
    }
    return (
      <div className="flex items-center gap-3" role="status">
        <Spinner />
        {tc('loading')}
      </div>
    );
  }

  return (
    <ProjectContext.Provider value={value}>
      <div className="flex flex-col gap-6">
        <BackLink label={t('back')} />
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <bdi dir="ltr" className="font-mono text-muted-foreground">
              {value.project.code}
            </bdi>
            <ProjectStatusBadge status={value.project.status} />
          </div>
          <h1 className="text-2xl font-semibold">
            <bdi>{value.project.name}</bdi>
          </h1>
        </div>
        <ProjectTabs project={value.project} />
        {children}
      </div>
    </ProjectContext.Provider>
  );
}

function ProjectTabs({ project }: { project: ProjectDto }) {
  const t = useTranslations('projectTabs');
  const pathname = usePathname();
  const base = `/projects/${project.id}`;
  const tabs = [
    { href: base, label: t('overview'), show: true },
    { href: `${base}/structure`, label: t('structure'), show: true },
    {
      href: `${base}/members`,
      label: t('members'),
      show: project.myPermissions.includes('projects.members.view'),
    },
    {
      href: `${base}/workforce`,
      label: t('workforce'),
      show: project.myPermissions.includes('projects.workforce.view'),
    },
    // Sprint 8 (PLT-24): everyone on the project sees the tab; its contents follow T-65.
    { href: `${base}/actions`, label: t('actions'), show: true, prefix: true },
    {
      href: `${base}/timeline`,
      label: t('timeline'),
      show: project.myPermissions.includes('projects.timeline.view'),
    },
  ].filter((tab) => tab.show);
  return (
    <nav aria-label={t('label')} className="-mx-4 overflow-x-auto px-4">
      <ul className="flex min-w-max border-b border-border">
        {tabs.map((tab) => {
          const active =
            pathname.endsWith(tab.href) || ('prefix' in tab && pathname.startsWith(`${tab.href}/`));
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'inline-flex min-h-12 items-center border-b-2 px-4 font-medium',
                  active ? 'border-primary text-primary' : 'border-transparent hover:bg-muted',
                )}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
