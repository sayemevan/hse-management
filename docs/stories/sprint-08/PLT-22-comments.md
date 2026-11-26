# PLT-22 — Comment Service and Comment Thread

| Field    | Value                                                                                              |
| -------- | -------------------------------------------------------------------------------------------------- |
| Epic     | Platform services (Doc 04 §11); first user Epic 08 — Action Management (Doc 13 §12)                |
| Priority | Must                                                                                               |
| Status   | Approved                                                                                           |
| Sources  | Product Book Doc 04 §11, Doc 13 §12, §18; Master Rules §5–6; D-47 (O-57); T-41, T-63; O-109, O-110 |

## Business Goal

Team members discuss a record where it lives, and the discussion stays as part of its permanent history (Doc 13 §12). One comment service serves every module, so hazards, incidents and inspections later get the same thread without building their own (Doc 04 §11).

## User Story

As an **action owner or reviewer**, I want to discuss the action in a thread on its page, so that questions, agreements and decisions are kept with the action.

## Description

A **platform service** (`apps/api/src/platform/comment`) with one `comment` table. A module enables comments for one record type by registering a **`CommentTarget`** and mounting the thread routes under its own record (T-63). In this sprint the only target is `action`.

```ts
registerCommentTarget({
  entityType: 'action',
  load(c, projectId, entityId) → { projectId, canView, canComment, isLocked, participants } | null,
});
CommentService.list(target, entityId, cursor) / add(uow, …) / edit(uow, …)
```

- `participants` are the user ids told about a new comment (for actions: owner, collaborators, creator — O-109); the author is never told.
- A **locked** record (closed or voided action) shows its thread read-only (O-105).
- Comments are plain text (line breaks kept, links not made clickable in Phase 1), 1–2,000 characters, shown oldest first with the newest at the bottom (O-110).
- The author may **edit** within 15 minutes of posting; the comment shows "edited"; the old text goes to the audit log. No one can delete a comment.

## Actors

Anyone who can view the record and isn't blocked by the target's `canComment` (for actions: everyone with view access, T-65).

## Preconditions

- Signed in on the company's subdomain; can view the record; the company isn't read-only (to post or edit); the project isn't archived.

## User Flow

1. On the action page, the **Comments** section shows the latest 30 comments (author name, role on the project, time) and **Show earlier comments** when there are more.
2. The box at the bottom: type → **Post**. The comment appears at once; others see it on refresh, and participants get a notification.
3. On their own comment within 15 minutes: **Edit** → change → **Save**. After 15 minutes the menu no longer shows Edit.
4. On a closed or voided action: "This action is closed. Comments are read-only." and no box.

## Functional Requirements

The system shall:

1. Store comments with `company_id`, `project_id`, `entity_type`, `entity_id`, `author_id`, `body`, `created_at`, `edited_at`.
2. Check access through the registered target on every list, post and edit; return `404` for a record the caller can't view.
3. List by cursor (`before` = `<createdAt>_<id>`), 30 per page, oldest to newest within the page.
4. Post: trim, validate, write the comment, the audit entry and the participants' notifications in one batch.
5. Edit: only the author, only within 15 minutes of `created_at` (`409 COMMENT_EDIT_WINDOW_PASSED`), only while the record isn't locked; audit old and new text.
6. Refuse posts and edits on locked records (`409 COMMENTS_LOCKED`) and archived projects (`409 PROJECT_ARCHIVED`).
7. Show the author's name as it is now, plus "(no longer on this project)" when they can no longer view it.
8. Rate-limit posting to 30 comments per user per minute (`429 RATE_LIMITED`).

## Validation Rules

| Field | Rule                                 | Message                                                        |
| ----- | ------------------------------------ | -------------------------------------------------------------- |
| Body  | Required, 1–2,000 characters trimmed | "Write a comment." / "Comments can be up to 2,000 characters." |

## Permission Rules

No new permission: comments follow the record's own access, decided by the module's target (T-63).

## Database Impact

New table `comment`:

| Column                     | Type / rule                            |
| -------------------------- | -------------------------------------- |
| `id`                       | UUID v7                                |
| `company_id`               | not null                               |
| `project_id`               | nullable (company-level records later) |
| `entity_type`, `entity_id` | not null                               |
| `author_id`                | FK `user`                              |
| `body`                     | text, not null                         |
| `created_at`, `edited_at`  | `edited_at` nullable                   |

Index: (`entity_type`, `entity_id`, `created_at`, `id`). A trigger rejects DELETE.

## API Requirements

- `GET /api/v1/projects/{projectId}/actions/{actionId}/comments?before=` → `{ comments: [{ id, author: { id, name, projectRole, stillHasAccess }, body, createdAt, editedAt, canEdit }], nextCursor, locked }`.
- `POST …/comments { body }` → `201` with the comment.
- `PATCH …/comments/{commentId} { body }` → the comment.

## UI Requirements

- Comment list and box as a section of the action page; on phone the box stays above the keyboard.
- Author's own comments marked "You"; times relative ("5 minutes ago") with the full date on hover / long press.
- Text in the writer's direction (`dir="auto"` per comment), so Arabic and English comments read correctly side by side.

## Error Handling

| Case                  | Response                         |
| --------------------- | -------------------------------- |
| Empty or too long     | `422 VALIDATION_FAILED`          |
| Edit after 15 minutes | `409 COMMENT_EDIT_WINDOW_PASSED` |
| Not the author        | `403 FORBIDDEN`                  |
| Locked record         | `409 COMMENTS_LOCKED`            |
| Archived project      | `409 PROJECT_ARCHIVED`           |
| Read-only company     | `403 SUBSCRIPTION_READ_ONLY`     |
| Too many posts        | `429 RATE_LIMITED`               |

## Notifications

`action.comment_added` to the target's participants except the author (PLT-23 § Notifications). Several comments on the same action within 10 minutes update the reader's existing unread notification ("3 new comments on RMX-02-ACT-0012") instead of adding one each.

## Audit Requirements

`comment.created` (entity, length), `comment.edited` (old and new text). Comments are not timeline entries.

## Acceptance Criteria

- The owner posts a comment; the creator and collaborators get one notification; the owner gets none.
- The author edits within 15 minutes and the comment shows "edited"; after 15 minutes the API refuses the edit.
- A user who can't view the action gets `404` on the thread.
- On a closed action the thread is visible and the API refuses new comments.
- An Arabic and an English comment display in their own direction on the same page.

## Test Scenarios

- **Positive:** post, list with paging, edit in time, notification grouping.
- **Negative:** empty, too long, edit late, edit someone else's, locked record, archived project, read-only company, another company's or project's action, rate limit.

## Future Improvements

@mentions with notifications (Sprint 19), attachments in comments, reactions, comments on hazards, inspections and incidents (their sprints register a target).
