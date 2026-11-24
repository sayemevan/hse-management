-- Sprint 7 (approved D-49, D-50). Seven workforce permissions (O-73 – O-77), listed after
-- projects.timeline.view. The platform permissions move down seven places so `sort_order`
-- follows PERMISSIONS in the shared package. Job positions and competencies are seeded per
-- company on first use (T-54), so no list rows are written here.
UPDATE `permission` SET `sort_order` = `sort_order` + 7 WHERE `scope_level` = 'platform';
--> statement-breakpoint
INSERT INTO `permission` (`code`, `module`, `scope_level`, `company_editable`, `sort_order`)
VALUES
  ('projects.workforce.view', 'projects', 'project', 1, 21),
  ('projects.workforce.manage', 'projects', 'project', 1, 22),
  ('workforce.view', 'workforce', 'company', 1, 23),
  ('workforce.manage', 'workforce', 'company', 1, 24),
  ('workforce.contacts.view', 'workforce', 'company', 1, 25),
  ('workforce.personal.view', 'workforce', 'company', 1, 26),
  ('workforce.lists.manage', 'workforce', 'company', 1, 27);
--> statement-breakpoint
INSERT INTO `role_permission` (`role_code`, `permission_code`)
VALUES
  ('company_administrator', 'projects.workforce.view'),
  ('hse_director', 'projects.workforce.view'),
  ('hse_manager', 'projects.workforce.view'),
  ('project_manager', 'projects.workforce.view'),
  ('safety_officer', 'projects.workforce.view'),
  ('site_engineer', 'projects.workforce.view'),
  ('supervisor', 'projects.workforce.view'),
  ('foreman', 'projects.workforce.view'),
  ('inspector', 'projects.workforce.view'),
  ('auditor', 'projects.workforce.view'),
  ('company_administrator', 'projects.workforce.manage'),
  ('hse_director', 'projects.workforce.manage'),
  ('hse_manager', 'projects.workforce.manage'),
  ('project_manager', 'projects.workforce.manage'),
  ('safety_officer', 'projects.workforce.manage'),
  ('company_administrator', 'workforce.view'),
  ('hse_director', 'workforce.view'),
  ('hse_manager', 'workforce.view'),
  ('project_manager', 'workforce.view'),
  ('safety_officer', 'workforce.view'),
  ('site_engineer', 'workforce.view'),
  ('supervisor', 'workforce.view'),
  ('company_administrator', 'workforce.manage'),
  ('hse_director', 'workforce.manage'),
  ('hse_manager', 'workforce.manage'),
  ('safety_officer', 'workforce.manage'),
  ('company_administrator', 'workforce.contacts.view'),
  ('hse_director', 'workforce.contacts.view'),
  ('hse_manager', 'workforce.contacts.view'),
  ('project_manager', 'workforce.contacts.view'),
  ('safety_officer', 'workforce.contacts.view'),
  ('supervisor', 'workforce.contacts.view'),
  ('company_administrator', 'workforce.personal.view'),
  ('hse_director', 'workforce.personal.view'),
  ('hse_manager', 'workforce.personal.view'),
  ('company_administrator', 'workforce.lists.manage'),
  ('hse_director', 'workforce.lists.manage'),
  ('hse_manager', 'workforce.lists.manage');
