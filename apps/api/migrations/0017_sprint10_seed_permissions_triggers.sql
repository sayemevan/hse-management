-- Sprint 10 (approved D-59, D-60). Five inspection permissions (O-149), listed after
-- projects.actions.close. The platform permissions move down five places so `sort_order`
-- follows PERMISSIONS in the shared package. Then T-76: published template versions never change.
UPDATE `permission` SET `sort_order` = `sort_order` + 5 WHERE `scope_level` = 'platform';
--> statement-breakpoint
INSERT INTO `permission` (`code`, `module`, `scope_level`, `company_editable`, `sort_order`)
VALUES
  ('inspections.templates.manage', 'inspections', 'company', 1, 33),
  ('projects.inspections.view', 'projects', 'project', 1, 34),
  ('projects.inspections.conduct', 'projects', 'project', 1, 35),
  ('projects.inspections.manage', 'projects', 'project', 1, 36),
  ('projects.inspections.approve', 'projects', 'project', 1, 37);
--> statement-breakpoint
INSERT INTO `role_permission` (`role_code`, `permission_code`)
VALUES
  ('company_administrator', 'inspections.templates.manage'),
  ('hse_director', 'inspections.templates.manage'),
  ('hse_manager', 'inspections.templates.manage'),
  ('company_administrator', 'projects.inspections.view'),
  ('hse_director', 'projects.inspections.view'),
  ('hse_manager', 'projects.inspections.view'),
  ('project_manager', 'projects.inspections.view'),
  ('safety_officer', 'projects.inspections.view'),
  ('site_engineer', 'projects.inspections.view'),
  ('supervisor', 'projects.inspections.view'),
  ('foreman', 'projects.inspections.view'),
  ('inspector', 'projects.inspections.view'),
  ('client', 'projects.inspections.view'),
  ('consultant', 'projects.inspections.view'),
  ('auditor', 'projects.inspections.view'),
  ('company_administrator', 'projects.inspections.conduct'),
  ('hse_director', 'projects.inspections.conduct'),
  ('hse_manager', 'projects.inspections.conduct'),
  ('project_manager', 'projects.inspections.conduct'),
  ('safety_officer', 'projects.inspections.conduct'),
  ('site_engineer', 'projects.inspections.conduct'),
  ('supervisor', 'projects.inspections.conduct'),
  ('foreman', 'projects.inspections.conduct'),
  ('inspector', 'projects.inspections.conduct'),
  ('company_administrator', 'projects.inspections.manage'),
  ('hse_director', 'projects.inspections.manage'),
  ('hse_manager', 'projects.inspections.manage'),
  ('project_manager', 'projects.inspections.manage'),
  ('safety_officer', 'projects.inspections.manage'),
  ('company_administrator', 'projects.inspections.approve'),
  ('hse_director', 'projects.inspections.approve'),
  ('hse_manager', 'projects.inspections.approve'),
  ('project_manager', 'projects.inspections.approve'),
  ('safety_officer', 'projects.inspections.approve');
--> statement-breakpoint
CREATE TRIGGER `inspection_template_version_immutable`
BEFORE UPDATE OF `content`, `version_no`, `template_id` ON `inspection_template_version`
WHEN OLD.`state` <> 'draft'
BEGIN
  SELECT RAISE(ABORT, 'published template versions never change');
END;
--> statement-breakpoint
CREATE TRIGGER `inspection_template_version_no_delete`
BEFORE DELETE ON `inspection_template_version`
WHEN OLD.`state` <> 'draft'
BEGIN
  SELECT RAISE(ABORT, 'published template versions never change');
END;
