'use client';

import { WORKFORCE_LISTS, type WorkforceList, type WorkforceListItemDto } from '@hse/shared';
import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useState } from 'react';

import { FormField } from '@/components/form/form-field';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { useLoad } from '@/modules/app/use-load';
import { useReadOnly } from '@/modules/billing/use-subscription-state';
import { useErrorMessage } from '@/modules/i18n/use-error-message';
import { ApiClientError } from '@/services/api-client';
import { cn } from '@/utils/cn';

import { workforceService } from './workforce.service';
import { FormDialog, RowMenu, usePositionName } from './workforce-ui';

/** PLT-21: Settings → Workforce lists (job positions and competencies). */
export function WorkforceListsScreen() {
  const t = useTranslations('workforce.lists');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const readOnly = useReadOnly();
  const name = usePositionName();
  const [list, setList] = useState<WorkforceList>('job_position');
  const [inactive, setInactive] = useState(false);
  const [editing, setEditing] = useState<WorkforceListItemDto | 'new' | null>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const loaded = useLoad(
    useCallback(() => workforceService.listItems(list, inactive), [list, inactive]),
    `${list}:${String(inactive)}`,
  );

  const act = (
    item: WorkforceListItemDto,
    action: 'deactivate' | 'reactivate' | 'up' | 'down' | 'delete',
  ) => {
    workforceService.listItemAction(list, item.id, action).then(
      () => {
        setNotice(
          action === 'up' || action === 'down'
            ? null
            : { tone: 'success', text: t(`done.${action}`) },
        );
        loaded.reload();
      },
      (failure: unknown) => {
        if (failure instanceof ApiClientError && failure.code === 'LIST_ITEM_IN_USE') {
          setNotice({
            tone: 'danger',
            text: t('inUse', { name: name(item), count: Number(failure.params.usage ?? 0) }),
          });
        } else setNotice({ tone: 'danger', text: errorMessage(failure) });
      },
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-muted-foreground">{t('intro')}</p>
      </div>
      <nav aria-label={t('title')} className="flex border-b border-border">
        {WORKFORCE_LISTS.map((value) => (
          <button
            key={value}
            type="button"
            aria-current={list === value ? 'page' : undefined}
            onClick={() => {
              setList(value);
              setNotice(null);
            }}
            className={cn(
              'inline-flex min-h-12 items-center border-b-2 px-4 font-medium',
              list === value ? 'border-primary text-primary' : 'border-transparent hover:bg-muted',
            )}
          >
            {t(`names.${value}`)}
          </button>
        ))}
      </nav>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Checkbox
          id="list-inactive"
          label={t('showInactive')}
          checked={inactive}
          onChange={(event) => {
            setInactive(event.target.checked);
          }}
        />
        {!readOnly ? (
          <Button
            onClick={() => {
              setEditing('new');
            }}
          >
            <Plus aria-hidden className="size-5" />
            {t(`add.${list}`)}
          </Button>
        ) : null}
      </div>
      {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}
      {loaded.status === 'error' ? (
        <Alert tone="danger">{errorMessage(loaded.error)}</Alert>
      ) : loaded.status === 'loading' ? (
        <div className="flex items-center gap-3" role="status">
          <Spinner />
          {tc('loading')}
        </div>
      ) : (
        <ol className="flex flex-col gap-2">
          {loaded.value.map((item, index) => (
            <li
              key={item.id}
              className="flex items-center gap-3 rounded-xl border border-border p-4"
            >
              <div className="flex flex-1 flex-col gap-1">
                <span className="font-medium">{name(item)}</span>
                <span className="text-sm text-muted-foreground">
                  {t('usage', { count: item.usage ?? 0 })}
                  {item.active ? '' : ` · ${t('inactive')}`}
                </span>
              </div>
              {readOnly ? null : (
                <RowMenu
                  label={t('actionsFor', { name: name(item) })}
                  items={[
                    {
                      label: t('rename'),
                      onSelect: () => {
                        setEditing(item);
                      },
                    },
                    ...(index > 0
                      ? [
                          {
                            label: t('moveUp'),
                            onSelect: () => {
                              act(item, 'up');
                            },
                          },
                        ]
                      : []),
                    ...(index < loaded.value.length - 1
                      ? [
                          {
                            label: t('moveDown'),
                            onSelect: () => {
                              act(item, 'down');
                            },
                          },
                        ]
                      : []),
                    item.active
                      ? {
                          label: t('deactivate'),
                          onSelect: () => {
                            act(item, 'deactivate');
                          },
                        }
                      : {
                          label: t('reactivate'),
                          onSelect: () => {
                            act(item, 'reactivate');
                          },
                        },
                    {
                      label: t('delete'),
                      danger: true,
                      onSelect: () => {
                        act(item, 'delete');
                      },
                    },
                  ]}
                />
              )}
            </li>
          ))}
        </ol>
      )}
      <ItemDialog
        list={list}
        item={editing}
        onClose={() => {
          setEditing(null);
        }}
        onSaved={() => {
          setEditing(null);
          setNotice({ tone: 'success', text: t('saved') });
          loaded.reload();
        }}
      />
    </div>
  );
}

function ItemDialog({
  list,
  item,
  onClose,
  onSaved,
}: {
  list: WorkforceList;
  item: WorkforceListItemDto | 'new' | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations('workforce.lists');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const positionName = usePositionName();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState<typeof item>(null);
  if (item !== shown) {
    setShown(item);
    setValue(item && item !== 'new' ? positionName(item) : '');
    setError(null);
  }
  return (
    <FormDialog
      open={item !== null}
      title={item === 'new' ? t(`add.${list}`) : t('rename')}
      error={error}
      submitLabel={t('save')}
      cancelLabel={tc('cancel')}
      onClose={onClose}
      onSubmit={() => {
        if (value.trim().length < 2) {
          setError(t('nameRequired'));
          return;
        }
        const request =
          item === 'new' || item === null
            ? workforceService.addListItem(list, value.trim())
            : workforceService.renameListItem(list, item.id, value.trim());
        request.then(onSaved, (failure: unknown) => {
          setError(errorMessage(failure));
        });
      }}
    >
      <FormField id="list-item-name" label={t('name')} required requiredLabel={tc('required')}>
        <Input
          id="list-item-name"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
          }}
        />
      </FormField>
    </FormDialog>
  );
}
