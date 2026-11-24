-- Sprint 6 (approved D-46, D-47).
-- 1. Four project permissions (O-59, O-65 – O-67), listed after projects.archive. The platform
--    permissions move down four places so `sort_order` follows PERMISSIONS in the shared package.
UPDATE `permission` SET `sort_order` = `sort_order` + 4 WHERE `scope_level` = 'platform';
--> statement-breakpoint
INSERT INTO `permission` (`code`, `module`, `scope_level`, `company_editable`, `sort_order`)
VALUES
  ('projects.structure.manage', 'projects', 'project', 1, 17),
  ('projects.members.view', 'projects', 'project', 1, 18),
  ('projects.members.manage', 'projects', 'project', 1, 19),
  ('projects.timeline.view', 'projects', 'project', 1, 20);
--> statement-breakpoint
INSERT INTO `role_permission` (`role_code`, `permission_code`)
VALUES
  ('company_administrator', 'projects.structure.manage'),
  ('hse_director', 'projects.structure.manage'),
  ('hse_manager', 'projects.structure.manage'),
  ('project_manager', 'projects.structure.manage'),
  ('safety_officer', 'projects.structure.manage'),
  ('company_administrator', 'projects.members.view'),
  ('hse_director', 'projects.members.view'),
  ('hse_manager', 'projects.members.view'),
  ('project_manager', 'projects.members.view'),
  ('safety_officer', 'projects.members.view'),
  ('site_engineer', 'projects.members.view'),
  ('supervisor', 'projects.members.view'),
  ('auditor', 'projects.members.view'),
  ('company_administrator', 'projects.members.manage'),
  ('hse_director', 'projects.members.manage'),
  ('project_manager', 'projects.members.manage'),
  ('company_administrator', 'projects.timeline.view'),
  ('hse_director', 'projects.timeline.view'),
  ('hse_manager', 'projects.timeline.view'),
  ('project_manager', 'projects.timeline.view'),
  ('safety_officer', 'projects.timeline.view'),
  ('site_engineer', 'projects.timeline.view'),
  ('auditor', 'projects.timeline.view');
--> statement-breakpoint
-- 2. PLT-18 FR-3: the activity timeline is append-only, like the audit log.
CREATE TRIGGER `activity_entry_no_update`
BEFORE UPDATE ON `activity_entry`
BEGIN
  SELECT RAISE(ABORT, 'activity_entry is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `activity_entry_no_delete`
BEFORE DELETE ON `activity_entry`
BEGIN
  SELECT RAISE(ABORT, 'activity_entry is append-only');
END;
--> statement-breakpoint
-- 3. T-44: timelines for Sprint 5 projects, back-filled once from the audit log. The entry
--    keeps the audit entry's id, actor, time and old / new values.
INSERT INTO `activity_entry`
  (`id`, `company_id`, `project_id`, `entity_type`, `entity_id`, `action`, `actor_user_id`,
   `changes`, `snapshot`, `occurred_at`)
SELECT
  a.`id`, a.`company_id`, a.`project_id`, 'project', a.`project_id`, a.`action`, a.`actor_user_id`,
  CASE WHEN a.`action` = 'project.created' THEN NULL
       ELSE json_object('before', json(coalesce(a.`old_value`, '{}')),
                        'after', json(coalesce(a.`new_value`, '{}'))) END,
  json_object('projectCode', p.`code`, 'projectName', p.`name`),
  a.`occurred_at`
FROM `audit_log` a
JOIN `project` p ON p.`id` = a.`project_id`
WHERE a.`action` IN ('project.created', 'project.updated', 'project.status.changed',
                     'project.archived', 'project.restored')
  AND a.`outcome` = 'success';
--> statement-breakpoint
INSERT INTO `activity_entry`
  (`id`, `company_id`, `project_id`, `entity_type`, `entity_id`, `action`, `actor_user_id`,
   `changes`, `snapshot`, `occurred_at`)
SELECT
  a.`id`, a.`company_id`, a.`project_id`, 'user', a.`entity_id`,
  CASE a.`action` WHEN 'user.project_role.added' THEN 'member.added'
                  WHEN 'user.project_role.changed' THEN 'member.changed'
                  ELSE 'member.removed' END,
  a.`actor_user_id`,
  json_object('before', json(coalesce(a.`old_value`, '{}')),
              'after', json(coalesce(a.`new_value`, '{}'))),
  json_object('projectCode', p.`code`, 'projectName', p.`name`, 'memberName', u.`full_name`,
              'roleCode', coalesce(json_extract(a.`new_value`, '$.roleCode'),
                                   json_extract(a.`old_value`, '$.roleCode'))),
  a.`occurred_at`
FROM `audit_log` a
JOIN `project` p ON p.`id` = a.`project_id`
LEFT JOIN `user` u ON u.`id` = a.`entity_id`
WHERE a.`action` IN ('user.project_role.added', 'user.project_role.changed',
                     'user.project_role.removed')
  AND a.`outcome` = 'success';
