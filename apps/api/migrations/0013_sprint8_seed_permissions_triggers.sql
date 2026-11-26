-- Sprint 8 (approved D-52, D-53). Five action permissions (O-107), listed after
-- workforce.lists.manage. The platform permissions move down five places so `sort_order`
-- follows PERMISSIONS in the shared package. Project Managers also verify (D-54). Then the append-only triggers of T-62 and O-110.
UPDATE `permission` SET `sort_order` = `sort_order` + 5 WHERE `scope_level` = 'platform';
--> statement-breakpoint
INSERT INTO `permission` (`code`, `module`, `scope_level`, `company_editable`, `sort_order`)
VALUES
  ('projects.actions.view', 'projects', 'project', 1, 28),
  ('projects.actions.create', 'projects', 'project', 1, 29),
  ('projects.actions.manage', 'projects', 'project', 1, 30),
  ('projects.actions.verify', 'projects', 'project', 1, 31),
  ('projects.actions.close', 'projects', 'project', 1, 32);
--> statement-breakpoint
INSERT INTO `role_permission` (`role_code`, `permission_code`)
VALUES
  ('company_administrator', 'projects.actions.view'),
  ('hse_director', 'projects.actions.view'),
  ('hse_manager', 'projects.actions.view'),
  ('project_manager', 'projects.actions.view'),
  ('safety_officer', 'projects.actions.view'),
  ('site_engineer', 'projects.actions.view'),
  ('supervisor', 'projects.actions.view'),
  ('foreman', 'projects.actions.view'),
  ('inspector', 'projects.actions.view'),
  ('client', 'projects.actions.view'),
  ('consultant', 'projects.actions.view'),
  ('auditor', 'projects.actions.view'),
  ('company_administrator', 'projects.actions.create'),
  ('hse_director', 'projects.actions.create'),
  ('hse_manager', 'projects.actions.create'),
  ('project_manager', 'projects.actions.create'),
  ('safety_officer', 'projects.actions.create'),
  ('site_engineer', 'projects.actions.create'),
  ('supervisor', 'projects.actions.create'),
  ('foreman', 'projects.actions.create'),
  ('inspector', 'projects.actions.create'),
  ('company_administrator', 'projects.actions.manage'),
  ('hse_director', 'projects.actions.manage'),
  ('hse_manager', 'projects.actions.manage'),
  ('project_manager', 'projects.actions.manage'),
  ('safety_officer', 'projects.actions.manage'),
  ('company_administrator', 'projects.actions.verify'),
  ('hse_director', 'projects.actions.verify'),
  ('hse_manager', 'projects.actions.verify'),
  ('project_manager', 'projects.actions.verify'),
  ('safety_officer', 'projects.actions.verify'),
  ('company_administrator', 'projects.actions.close'),
  ('hse_director', 'projects.actions.close'),
  ('hse_manager', 'projects.actions.close'),
  ('project_manager', 'projects.actions.close'),
  ('safety_officer', 'projects.actions.close');
--> statement-breakpoint
CREATE TRIGGER `action_update_no_update`
BEFORE UPDATE ON `action_update`
BEGIN
  SELECT RAISE(ABORT, 'action_update is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `action_update_no_delete`
BEFORE DELETE ON `action_update`
BEGIN
  SELECT RAISE(ABORT, 'action_update is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `comment_no_delete`
BEFORE DELETE ON `comment`
BEGIN
  SELECT RAISE(ABORT, 'comments are never deleted');
END;
