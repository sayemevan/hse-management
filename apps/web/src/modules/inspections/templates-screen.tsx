'use client';

import type { InspectionCategoryDto, TemplateSummaryDto } from '@hse/shared';
import { ArrowDown, ArrowUp, Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useId, useState } from 'react';

import { FormField } from '@/components/form/form-field';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { useLoad } from '@/modules/app/use-load';
import { useReadOnly } from '@/modules/billing/use-subscription-state';
import { useErrorMessage } from '@/modules/i18n/use-error-message';
import { FormDialog } from '@/modules/workforce/workforce-ui';
import { cn } from '@/utils/cn';

import { useLocalized } from './inspection-ui';
import { templatesService } from './inspections.service';

/** US-031: Settings → Inspection templates, with the categories list (O-141). */
export function TemplatesScreen() {
  const t = useTranslations('inspections.templates');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const readOnly = useReadOnly();
  const router = useRouter();
  const pick = useLocalized();
  const [tab, setTab] = useState<'active' | 'retired' | 'categories'>('active');
  const [version, setVersion] = useState(0);
  const [creating, setCreating] = useState(false);

  const loaded = useLoad(
    useCallback(
      () => Promise.all([templatesService.list(), templatesService.categories()]),
      // eslint-disable-next-line react-hooks/exhaustive-deps -- `version` reloads
      [version],
    ),
    String(version),
  );
  if (loaded.status === 'error') return <Alert tone="danger">{errorMessage(loaded.error)}</Alert>;
  if (loaded.status !== 'ready') {
    return (
      <div className="flex items-center gap-3" role="status">
        <Spinner />
        {tc('loading')}
      </div>
    );
  }
  const [{ items, canManage }, categories] = loaded.value;
  const shown = items.filter((item) => item.status === (tab === 'retired' ? 'retired' : 'active'));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        {canManage && !readOnly ? (
          <Button
            onClick={() => {
              setCreating(true);
            }}
          >
            <Plus aria-hidden className="size-5" />
            {t('new')}
          </Button>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2" role="tablist">
        {(['active', 'retired', 'categories'] as const).map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={tab === name}
            onClick={() => {
              setTab(name);
            }}
            className={cn(
              'inline-flex min-h-10 items-center rounded-full border px-4 text-sm font-medium',
              tab === name ? 'border-primary bg-primary text-white' : 'border-border hover:bg-muted',
            )}
          >
            {t(`tabs.${name}`)}
          </button>
        ))}
      </div>

      {tab === 'categories' ? (
        <CategoriesPanel
          categories={categories}
          canManage={canManage && !readOnly}
          onChanged={() => {
            setVersion((v) => v + 1);
          }}
        />
      ) : shown.length === 0 ? (
        <p className="text-muted-foreground">{t('empty')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {shown.map((item) => (
            <TemplateRow key={item.id} item={item} pick={pick} />
          ))}
        </ul>
      )}

      <CreateTemplateDialog
        open={creating}
        categories={categories.filter((c) => c.active)}
        onClose={() => {
          setCreating(false);
        }}
        onCreated={(id) => {
          router.push(`/settings/inspection-templates/${id}`);
        }}
      />
    </div>
  );
}

function TemplateRow({ item, pick }: { item: TemplateSummaryDto; pick: ReturnType<typeof useLocalized> }) {
  const t = useTranslations('inspections.templates');
  return (
    <li>
      <Link
        href={`/settings/inspection-templates/${item.id}`}
        className="flex flex-col gap-1 rounded-xl border border-border bg-card p-4 hover:bg-muted/50"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{pick({ en: item.nameEn, ar: item.nameAr })}</span>
          {item.currentVersionNo ? (
            <span className="rounded-full border border-border px-2 py-0.5 text-xs">
              {t('versionChip', { version: item.currentVersionNo })}
            </span>
          ) : (
            <span className="rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-xs">
              {t('notPublished')}
            </span>
          )}
          {item.hasDraft && item.currentVersionNo ? (
            <span className="rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-xs">
              {t('draftChanges')}
            </span>
          ) : null}
          {item.status === 'retired' ? (
            <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-xs">{t('retired')}</span>
          ) : null}
        </div>
        <p className="text-sm text-muted-foreground">
          {pick({ en: item.category.nameEn, ar: item.category.nameAr })} · {t('itemCount', { count: item.itemCount })}
        </p>
      </Link>
    </li>
  );
}

function CreateTemplateDialog({
  open,
  categories,
  onClose,
  onCreated,
}: {
  open: boolean;
  categories: InspectionCategoryDto[];
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const t = useTranslations('inspections.templates');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const pick = useLocalized();
  const nameId = useId();
  const nameArId = useId();
  const categoryId = useId();
  const [nameEn, setNameEn] = useState('');
  const [nameAr, setNameAr] = useState('');
  const [category, setCategory] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  return (
    <FormDialog
      open={open}
      title={t('new')}
      error={error}
      saving={saving}
      submitLabel={t('create')}
      cancelLabel={tc('cancel')}
      onClose={onClose}
      onSubmit={() => {
        if (!nameEn.trim() && !nameAr.trim()) {
          setError(t('nameRequired'));
          return;
        }
        if (!category) {
          setError(t('categoryRequired'));
          return;
        }
        setSaving(true);
        setError(null);
        templatesService
          .create({ nameEn: nameEn.trim() || null, nameAr: nameAr.trim() || null, categoryId: category })
          .then(
            (created) => {
              onCreated(created.id);
            },
            (failure: unknown) => {
              setError(errorMessage(failure));
            },
          )
          .finally(() => {
            setSaving(false);
          });
      }}
    >
      <FormField id={nameId} label={t('nameEn')}>
        <Input id={nameId} value={nameEn} onChange={(e) => { setNameEn(e.target.value); }} maxLength={120} />
      </FormField>
      <FormField id={nameArId} label={t('nameAr')}>
        <Input id={nameArId} dir="rtl" value={nameAr} onChange={(e) => { setNameAr(e.target.value); }} maxLength={120} />
      </FormField>
      <FormField id={categoryId} label={t('category')}>
        <Select id={categoryId} value={category} onChange={(e) => { setCategory(e.target.value); }}>
          <option value="">{t('chooseCategory')}</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {pick({ en: c.nameEn, ar: c.nameAr })}
            </option>
          ))}
        </Select>
      </FormField>
    </FormDialog>
  );
}

function CategoriesPanel({
  categories,
  canManage,
  onChanged,
}: {
  categories: InspectionCategoryDto[];
  canManage: boolean;
  onChanged: () => void;
}) {
  const t = useTranslations('inspections.categories');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const pick = useLocalized();
  const [editing, setEditing] = useState<InspectionCategoryDto | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = (task: Promise<unknown>) => {
    setError(null);
    task.then(onChanged, (failure: unknown) => {
      setError(errorMessage(failure));
    });
  };
  return (
    <div className="flex flex-col gap-3">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {canManage ? (
        <div>
          <Button
            variant="secondary"
            onClick={() => {
              setEditing('new');
            }}
          >
            <Plus aria-hidden className="size-5" />
            {t('add')}
          </Button>
        </div>
      ) : null}
      <ul className="flex flex-col gap-2">
        {categories.map((category, index) => (
          <li key={category.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-border p-3">
            <span className="flex-1 font-medium">{pick({ en: category.nameEn, ar: category.nameAr })}</span>
            {!category.active ? (
              <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-xs">{t('inactive')}</span>
            ) : null}
            <span className="text-sm text-muted-foreground">{t('templates', { count: category.templateCount })}</span>
            {canManage ? (
              <div className="flex gap-1">
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={t('moveUp')}
                  disabled={index === 0}
                  onClick={() => {
                    run(templatesService.moveCategory(category.id, 'up'));
                  }}
                >
                  <ArrowUp aria-hidden className="size-5" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={t('moveDown')}
                  disabled={index === categories.length - 1}
                  onClick={() => {
                    run(templatesService.moveCategory(category.id, 'down'));
                  }}
                >
                  <ArrowDown aria-hidden className="size-5" />
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setEditing(category);
                  }}
                >
                  {tc('edit')}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    run(templatesService.setCategoryActive(category.id, !category.active));
                  }}
                >
                  {category.active ? t('deactivate') : t('reactivate')}
                </Button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {editing ? (
        <CategoryDialog
          category={editing === 'new' ? null : editing}
          onClose={() => {
            setEditing(null);
          }}
          onSaved={() => {
            setEditing(null);
            onChanged();
          }}
        />
      ) : null}
    </div>
  );
}

function CategoryDialog({
  category,
  onClose,
  onSaved,
}: {
  category: InspectionCategoryDto | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations('inspections.categories');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const enId = useId();
  const arId = useId();
  const [nameEn, setNameEn] = useState(category?.nameEn ?? '');
  const [nameAr, setNameAr] = useState(category?.nameAr ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  return (
    <FormDialog
      open
      title={category ? t('edit') : t('add')}
      error={error}
      saving={saving}
      submitLabel={tc('save')}
      cancelLabel={tc('cancel')}
      onClose={onClose}
      onSubmit={() => {
        setSaving(true);
        const body = { nameEn: nameEn.trim() || null, nameAr: nameAr.trim() || null };
        (category ? templatesService.updateCategory(category.id, body) : templatesService.createCategory(body))
          .then(onSaved, (failure: unknown) => {
            setError(errorMessage(failure));
          })
          .finally(() => {
            setSaving(false);
          });
      }}
    >
      <FormField id={enId} label={t('nameEn')}>
        <Input id={enId} value={nameEn} onChange={(e) => { setNameEn(e.target.value); }} maxLength={80} />
      </FormField>
      <FormField id={arId} label={t('nameAr')}>
        <Input id={arId} dir="rtl" value={nameAr} onChange={(e) => { setNameAr(e.target.value); }} maxLength={80} />
      </FormField>
    </FormDialog>
  );
}
