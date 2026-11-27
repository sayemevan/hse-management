'use client';

import { COMMENT_LIMITS, type CommentDto, type CommentPageDto } from '@hse/shared';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/modules/auth/auth-provider';
import { useReadOnly } from '@/modules/billing/use-subscription-state';
import { useErrorMessage } from '@/modules/i18n/use-error-message';
import { useRelativeTime } from '@/modules/notifications/use-notification-text';

import { actionsService } from './actions.service';

/** The calls of one record's thread (actions by default; inspections in Sprint 10). */
export interface CommentApi {
  comments: (before: string | null) => Promise<CommentPageDto>;
  add: (body: string) => Promise<CommentDto>;
  edit: (commentId: string, body: string) => Promise<CommentDto>;
}

/** PLT-22: the comment thread of a record, oldest first, box at the bottom. */
export function CommentThread({
  projectId,
  actionId,
  api,
}: {
  projectId: string;
  actionId: string;
  api?: CommentApi;
}) {
  const calls: CommentApi = useMemo(
    () =>
      api ?? {
        comments: (before) => actionsService.comments(projectId, actionId, before),
        add: (body) => actionsService.addComment(projectId, actionId, body),
        edit: (commentId, body) => actionsService.editComment(projectId, actionId, commentId, body),
      },
    [api, projectId, actionId],
  );
  const t = useTranslations('comments');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const readOnly = useReadOnly();
  const relative = useRelativeTime();
  const { user } = useAuth();
  const [comments, setComments] = useState<CommentDto[] | null>(null);
  const [before, setBefore] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [body, setBody] = useState('');
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);

  const load = useCallback(
    (cursor: string | null) => {
      calls.comments(cursor).then(
        (page) => {
          setComments((current) =>
            cursor && current ? [...page.comments, ...current] : page.comments,
          );
          setBefore(page.nextBefore);
          setLocked(page.locked);
        },
        (failure: unknown) => {
          setError(errorMessage(failure));
          setComments((current) => current ?? []);
        },
      );
    },
    [calls, errorMessage],
  );

  useEffect(() => {
    load(null);
  }, [load]);

  const post = () => {
    const text = body.trim();
    if (!text) {
      setError(t('empty'));
      return;
    }
    setPosting(true);
    setError(null);
    calls
      .add(text)
      .then(
        (comment) => {
          setComments((current) => [...(current ?? []), comment]);
          setBody('');
        },
        (failure: unknown) => {
          setError(errorMessage(failure));
        },
      )
      .finally(() => {
        setPosting(false);
      });
  };

  const saveEdit = () => {
    if (!editing) return;
    calls.edit(editing.id, editing.body.trim()).then(
      (comment) => {
        setComments((current) => (current ?? []).map((c) => (c.id === comment.id ? comment : c)));
        setEditing(null);
      },
      (failure: unknown) => {
        setError(errorMessage(failure));
      },
    );
  };

  if (!comments) {
    return (
      <div className="flex items-center gap-3" role="status">
        <Spinner />
        {tc('loading')}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {before ? (
        <Button
          variant="secondary"
          className="w-fit"
          onClick={() => {
            load(before);
          }}
        >
          {t('earlier')}
        </Button>
      ) : null}
      {comments.length === 0 ? <p className="text-muted-foreground">{t('none')}</p> : null}
      <ul className="flex flex-col gap-3">
        {comments.map((comment) => {
          const mine = comment.author.id === user?.id;
          return (
            <li key={comment.id} className="rounded-xl border border-border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="font-medium">
                  {mine ? t('you') : comment.author.name}
                  {comment.author.stillHasAccess ? null : (
                    <span className="ms-1 text-muted-foreground">{t('leftProject')}</span>
                  )}
                </span>
                <span className="text-muted-foreground">
                  {relative(comment.createdAt)}
                  {comment.editedAt ? ` · ${t('edited')}` : ''}
                </span>
              </div>
              {editing?.id === comment.id ? (
                <div className="mt-2 flex flex-col gap-2">
                  <Textarea
                    aria-label={t('edit')}
                    dir="auto"
                    value={editing.body}
                    maxLength={COMMENT_LIMITS.bodyMax}
                    onChange={(event) => {
                      setEditing({ id: comment.id, body: event.target.value });
                    }}
                  />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={saveEdit}>
                      {t('save')}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setEditing(null);
                      }}
                    >
                      {tc('cancel')}
                    </Button>
                  </div>
                </div>
              ) : (
                <p dir="auto" className="mt-1 whitespace-pre-wrap break-words">
                  {comment.body}
                </p>
              )}
              {comment.canEdit && !readOnly && editing?.id !== comment.id ? (
                <button
                  type="button"
                  className="mt-1 min-h-10 text-sm font-medium text-primary"
                  onClick={() => {
                    setEditing({ id: comment.id, body: comment.body });
                  }}
                >
                  {t('edit')}
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {locked ? (
        <Alert tone="info">{t('locked')}</Alert>
      ) : readOnly ? null : (
        <div className="sticky bottom-0 flex flex-col gap-2 bg-background pb-2">
          <label htmlFor="comment-body" className="text-sm font-medium">
            {t('write')}
          </label>
          <Textarea
            id="comment-body"
            dir="auto"
            rows={3}
            value={body}
            maxLength={COMMENT_LIMITS.bodyMax}
            onChange={(event) => {
              setBody(event.target.value);
            }}
          />
          <Button className="w-fit" onClick={post} disabled={posting}>
            {posting ? <Spinner /> : null}
            {t('post')}
          </Button>
        </div>
      )}
    </div>
  );
}
