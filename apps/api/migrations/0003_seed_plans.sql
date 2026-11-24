-- PLT-06 / D-27 / D-28: the plan catalogue. NULL limits mean unlimited; prices are NULL
-- until the Product Owner sets them (F-02b). 1 GB = 1073741824 bytes.
INSERT INTO `plan` (`id`, `code`, `name_en`, `name_ar`, `max_projects`, `max_users`, `max_storage_bytes`, `monthly_price_halalas`, `annual_price_halalas`, `sort_order`, `is_active`, `created_at`, `updated_at`)
VALUES
  ('00000000-0000-4000-9000-000000000001', 'basic', 'Basic', 'الأساسية', 1, 25, 5368709120, NULL, NULL, 1, 1, 1794355200000, 1794355200000),
  ('00000000-0000-4000-9000-000000000002', 'pro', 'Pro', 'الاحترافية', 5, 100, 53687091200, NULL, NULL, 2, 1, 1794355200000, 1794355200000),
  ('00000000-0000-4000-9000-000000000003', 'enterprise', 'Enterprise', 'المؤسسات', NULL, NULL, 536870912000, NULL, NULL, 3, 1, 1794355200000, 1794355200000);
