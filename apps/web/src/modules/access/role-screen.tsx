'use client';

import type { RoleDetailDto, RolePermissionDto } from '@hse/shared';
import { ArrowLeft, Lock } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useCallback, useState } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Spinner } from '@/components/ui/spinner';
import { useLoad } from '@/modules/app/use-load';
import { useAuth } from '@/modules/auth/auth-provider';
import { hasPermission } from '@/modules/auth/require-permission';
import { useReadOnly } from '@/modules/billing/use-subscription-state';
import { useErrorMessage } from '@/modules/i18n/use-error-message';

import { accessService } from './access.service';

interface Notice {
  tone: 'success' | 'danger';
  text: string;
}

/** A role's permissions, grouped by scope and module, with switches (US-009 FR-2 – FR-8). */
export function RoleScreen({ code }: { code: string }) {
  const tc = useTranslations('common');
  const t = useTranslations('rolesAdmin');
  const errorMessage = useErrorMessage();
  const loaded = useLoad(
    useCallback(() => accessService.role(code), [code]),
    code,
  );
  const [override, setOverride] = useState<RoleDetailDto | null>(null);
  // Kept here: the editor remounts with each saved version, the message must survive it.
  const [notice, setNotice] = useState<Notice | null>(null);
  const role = override ?? (loaded.status === 'ready' ? loaded.value : null);

  if (!role) {
    return loaded.status === 'error' ? (
      <div className="flex flex-col items-start gap-3">
        <BackLink label={t('back')} />
        <Alert tone="danger">{errorMessage(loaded.error)}</Alert>
      </div>
    ) : (
      <div className="flex items-center gap-3" role="status">
        <Spinner />
        {tc('loading')}
      </div>
    );
  }
  return (
    <RoleEditor
      key={role.version}
      role={role}
      notice={notice}
      onNotice={setNotice}
      onSaved={setOverride}
    />
  );
}

function BackLink({ label }: { label: string }) {
  return (
    <Link
      href="/settings/roles"
      className="inline-flex items-center gap-2 text-sm font-medium text-primary underline-offset-4 hover:underline"
    >
      <ArrowLeft aria-hidden className="size-4 rtl:-scale-x-100" />
      {label}
    </Link>
  );
}

function RoleEditor({
  role,
  notice,
  onNotice: setNotice,
  onSaved,
}: {
  role: RoleDetailDto;
  notice: Notice | null;
  onNotice: (notice: Notice | null) => void;
  onSaved: (role: RoleDetailDto) => void;
}) {
  const t = useTranslations('rolesAdmin');
  const tp = useTranslations('permissions');
  const troles = useTranslations('roles');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const { user } = useAuth();
  const readOnly = useReadOnly();
  const canEdit = !readOnly && hasPermission(user, 'roles.permissions.edit');
  const [granted, setGranted] = useState(
    () => new Set(role.permissions.filter((item) => item.granted).map((item) => item.code)),
  );
  const [confirm, setConfirm] = useState<'save' | 'reset' | null>(null);
  const [saving, setSaving] = useState(false);

  const changes = role.permissions.filter((item) => granted.has(item.code) !== item.granted);

  const toggle = (item: RolePermissionDto) => {
    if (item.locked || !canEdit) return;
    setGranted((current) => {
      const next = new Set(current);
      if (next.has(item.code)) next.delete(item.code);
      else next.add(item.code);
      return next;
    });
  };

  const run = async (action: () => Promise<RoleDetailDto>, success: string) => {
    setConfirm(null);
    setSaving(true);
    setNotice(null);
    try {
      const saved = await action();
      onSaved(saved);
      setNotice({ tone: 'success', text: success });
    } catch (error) {
      setNotice({ tone: 'danger', text: errorMessage(error) });
    } finally {
      setSaving(false);
    }
  };

  const groups = (['company', 'project'] as const).map((scope) => ({
    scope,
    modules: [
      ...new Set(
        role.permissions.filter((item) => item.scope === scope).map((item) => item.module),
      ),
    ].map((module) => ({
      module,
      items: role.permissions.filter((item) => item.scope === scope && item.module === module),
    })),
  }));

  return (
    <div className="flex flex-col gap-6 pb-24">
      <BackLink label={t('back')} />
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{troles(role.code as 'worker')}</h1>
        <p className="text-muted-foreground">
          {troles(`${role.code}Description` as 'workerDescription')}
        </p>
        <p className="text-sm text-muted-foreground">
          {t('userCount', { count: role.userCount })}
          {' · '}
          {role.companyWide ? t('companyWideHint') : t('projectOnlyHint')}
        </p>
        {canEdit ? null : <p className="text-sm font-medium">{t('viewOnly')}</p>}
      </div>

      {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}

      {groups.map((group) => (
        <section key={group.scope} className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">{t(`scope.${group.scope}`)}</h2>
          {group.modules.map(({ module, items }) => (
            <Card key={module} className="p-0">
              <h3 className="border-b border-border px-4 py-3 text-sm font-semibold text-muted-foreground">
                {tp(`module.${module}` as 'module.projects')}
              </h3>
              <ul className="divide-y divide-border">
                {items.map((item) => {
                  const on = granted.has(item.code);
                  const changed = on !== item.default;
                  const inputId = `perm-${item.code}`;
                  return (
                    <li key={item.code} className="flex items-center gap-3 px-4 py-3">
                      <label htmlFor={inputId} className="flex min-w-0 flex-1 flex-col">
                        <span className="font-medium">
                          {tp(`${item.code}.label` as 'projects.view.label')}
                        </span>
                        <span className="text-sm text-muted-foreground">
                          {tp(`${item.code}.meaning` as 'projects.view.meaning')}
                        </span>
                        {item.locked ? (
                          <span className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
                            <Lock aria-hidden className="size-3" />
                            {t('locked')}
                          </span>
                        ) : changed ? (
                          <span className="mt-1 text-xs font-medium text-warning-foreground">
                            {t('changedFromDefault')}
                          </span>
                        ) : null}
                      </label>
                      <input
                        id={inputId}
                        type="checkbox"
                        role="switch"
                        className="size-6 shrink-0 accent-primary"
                        checked={on}
                        disabled={!canEdit || item.locked || saving}
                        aria-checked={on}
                        onChange={() => {
                          toggle(item);
                        }}
                      />
                    </li>
                  );
                })}
              </ul>
            </Card>
          ))}
        </section>
      ))}

      {canEdit && role.customised && changes.length === 0 ? (
        <Button
          variant="secondary"
          className="self-start"
          disabled={saving}
          onClick={() => {
            setConfirm('reset');
          }}
        >
          {t('reset')}
        </Button>
      ) : null}

      {canEdit && changes.length > 0 ? (
        <div className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-background p-4 shadow-lg">
          <div className="mx-auto flex max-w-5xl flex-col gap-2 sm:flex-row sm:items-center">
            <span className="flex-1 font-medium">{t('unsaved', { count: changes.length })}</span>
            <Button
              variant="secondary"
              disabled={saving}
              onClick={() => {
                setGranted(
                  new Set(role.permissions.filter((item) => item.granted).map((item) => item.code)),
                );
              }}
            >
              {t('discard')}
            </Button>
            <Button
              disabled={saving}
              onClick={() => {
                setConfirm('save');
              }}
            >
              {saving ? <Spinner /> : null}
              {t('save')}
            </Button>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirm === 'save'}
        title={t('saveTitle', { role: troles(role.code as 'worker') })}
        body={t('saveBody', { count: changes.length, users: role.userCount })}
        confirmLabel={t('save')}
        cancelLabel={tc('cancel')}
        onConfirm={() =>
          void run(() => accessService.saveRole(role.code, role.version, [...granted]), t('saved'))
        }
        onCancel={() => {
          setConfirm(null);
        }}
      >
        <ul className="list-disc ps-5 text-sm">
          {changes.map((item) => (
            <li key={item.code}>
              {granted.has(item.code) ? t('willGrant') : t('willRemove')}{' '}
              {tp(`${item.code}.label` as 'projects.view.label')}
            </li>
          ))}
        </ul>
      </ConfirmDialog>

      <ConfirmDialog
        open={confirm === 'reset'}
        title={t('resetTitle')}
        body={t('resetBody', { role: troles(role.code as 'worker') })}
        confirmLabel={t('reset')}
        cancelLabel={tc('cancel')}
        onConfirm={() =>
          void run(() => accessService.resetRole(role.code, role.version), t('resetDone'))
        }
        onCancel={() => {
          setConfirm(null);
        }}
      />
    </div>
  );
}
