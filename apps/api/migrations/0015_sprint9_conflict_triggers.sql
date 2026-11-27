-- Sprint 9 (PLT-30, O-124): conflict copies are kept permanently and are read-only once they
-- leave `open` (resolved, discarded or superseded). D-20: both versions are kept.
CREATE TRIGGER `sync_conflict_closed_read_only`
BEFORE UPDATE ON `sync_conflict`
WHEN OLD.`status` <> 'open'
BEGIN
  SELECT RAISE(ABORT, 'sync_conflict is read-only once resolved');
END;
--> statement-breakpoint
CREATE TRIGGER `sync_conflict_no_delete`
BEFORE DELETE ON `sync_conflict`
BEGIN
  SELECT RAISE(ABORT, 'sync_conflict rows are never deleted');
END;
