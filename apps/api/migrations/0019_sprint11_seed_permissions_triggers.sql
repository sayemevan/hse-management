-- Sprint 11 (approved D-62, D-63). Eight safety event and risk permissions (O-168), listed after
-- projects.inspections.approve. The platform permissions move down eight places so `sort_order`
-- follows PERMISSIONS in the shared package. Then: safety events and their records are never
-- deleted (Doc 11 §17), and risk matrix versions never change (T-87).
UPDATE `permission` SET `sort_order` = `sort_order` + 8 WHERE `scope_level` = 'platform';
--> statement-breakpoint
INSERT INTO `permission` (`code`, `module`, `scope_level`, `company_editable`, `sort_order`)
VALUES
  ('safety_events.settings.manage', 'safety_events', 'company', 1, 38),
  ('risk.matrix.manage', 'risk', 'company', 1, 39),
  ('projects.safety_events.report', 'projects', 'project', 1, 40),
  ('projects.safety_events.view', 'projects', 'project', 1, 41),
  ('projects.safety_events.manage', 'projects', 'project', 1, 42),
  ('projects.safety_events.investigate', 'projects', 'project', 1, 43),
  ('projects.safety_events.close', 'projects', 'project', 1, 44),
  ('projects.safety_events.sensitive.view', 'projects', 'project', 1, 45);
--> statement-breakpoint
INSERT INTO `role_permission` (`role_code`, `permission_code`)
VALUES
  ('company_administrator', 'safety_events.settings.manage'),
  ('hse_director', 'safety_events.settings.manage'),
  ('hse_manager', 'safety_events.settings.manage'),
  ('company_administrator', 'risk.matrix.manage'),
  ('hse_director', 'risk.matrix.manage'),
  ('hse_manager', 'risk.matrix.manage'),
  ('company_administrator', 'projects.safety_events.report'),
  ('hse_director', 'projects.safety_events.report'),
  ('hse_manager', 'projects.safety_events.report'),
  ('project_manager', 'projects.safety_events.report'),
  ('safety_officer', 'projects.safety_events.report'),
  ('site_engineer', 'projects.safety_events.report'),
  ('supervisor', 'projects.safety_events.report'),
  ('foreman', 'projects.safety_events.report'),
  ('inspector', 'projects.safety_events.report'),
  ('worker', 'projects.safety_events.report'),
  ('client', 'projects.safety_events.report'),
  ('consultant', 'projects.safety_events.report'),
  ('company_administrator', 'projects.safety_events.view'),
  ('hse_director', 'projects.safety_events.view'),
  ('hse_manager', 'projects.safety_events.view'),
  ('project_manager', 'projects.safety_events.view'),
  ('safety_officer', 'projects.safety_events.view'),
  ('site_engineer', 'projects.safety_events.view'),
  ('supervisor', 'projects.safety_events.view'),
  ('foreman', 'projects.safety_events.view'),
  ('inspector', 'projects.safety_events.view'),
  ('client', 'projects.safety_events.view'),
  ('consultant', 'projects.safety_events.view'),
  ('auditor', 'projects.safety_events.view'),
  ('company_administrator', 'projects.safety_events.manage'),
  ('hse_director', 'projects.safety_events.manage'),
  ('hse_manager', 'projects.safety_events.manage'),
  ('project_manager', 'projects.safety_events.manage'),
  ('safety_officer', 'projects.safety_events.manage'),
  ('company_administrator', 'projects.safety_events.investigate'),
  ('hse_director', 'projects.safety_events.investigate'),
  ('hse_manager', 'projects.safety_events.investigate'),
  ('project_manager', 'projects.safety_events.investigate'),
  ('safety_officer', 'projects.safety_events.investigate'),
  ('site_engineer', 'projects.safety_events.investigate'),
  ('supervisor', 'projects.safety_events.investigate'),
  ('company_administrator', 'projects.safety_events.close'),
  ('hse_director', 'projects.safety_events.close'),
  ('hse_manager', 'projects.safety_events.close'),
  ('project_manager', 'projects.safety_events.close'),
  ('safety_officer', 'projects.safety_events.close'),
  ('company_administrator', 'projects.safety_events.sensitive.view'),
  ('hse_director', 'projects.safety_events.sensitive.view'),
  ('hse_manager', 'projects.safety_events.sensitive.view'),
  ('project_manager', 'projects.safety_events.sensitive.view'),
  ('safety_officer', 'projects.safety_events.sensitive.view');
--> statement-breakpoint
CREATE TRIGGER `safety_event_no_delete` BEFORE DELETE ON `safety_event`
BEGIN
  SELECT RAISE(ABORT, 'safety events are never deleted');
END;
--> statement-breakpoint
CREATE TRIGGER `safety_event_person_no_delete` BEFORE DELETE ON `safety_event_person`
BEGIN
  SELECT RAISE(ABORT, 'safety event records are never deleted');
END;
--> statement-breakpoint
CREATE TRIGGER `safety_event_witness_no_delete` BEFORE DELETE ON `safety_event_witness`
BEGIN
  SELECT RAISE(ABORT, 'safety event records are never deleted');
END;
--> statement-breakpoint
CREATE TRIGGER `safety_event_investigation_no_delete` BEFORE DELETE ON `safety_event_investigation`
BEGIN
  SELECT RAISE(ABORT, 'safety event records are never deleted');
END;
--> statement-breakpoint
CREATE TRIGGER `safety_event_cause_no_delete` BEFORE DELETE ON `safety_event_cause`
BEGIN
  SELECT RAISE(ABORT, 'safety event records are never deleted');
END;
--> statement-breakpoint
CREATE TRIGGER `safety_event_recommendation_no_delete` BEFORE DELETE ON `safety_event_recommendation`
BEGIN
  SELECT RAISE(ABORT, 'safety event records are never deleted');
END;
--> statement-breakpoint
CREATE TRIGGER `safety_event_file_no_delete` BEFORE DELETE ON `safety_event_file`
BEGIN
  SELECT RAISE(ABORT, 'safety event records are never deleted');
END;
--> statement-breakpoint
CREATE TRIGGER `risk_matrix_version_immutable` BEFORE UPDATE ON `risk_matrix_version`
BEGIN
  SELECT RAISE(ABORT, 'risk matrix versions never change');
END;
--> statement-breakpoint
CREATE TRIGGER `risk_matrix_version_no_delete` BEFORE DELETE ON `risk_matrix_version`
BEGIN
  SELECT RAISE(ABORT, 'risk matrix versions never change');
END;
