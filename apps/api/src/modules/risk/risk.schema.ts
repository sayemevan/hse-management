import type { RiskBand, RiskLevel } from "@hse/shared";
import {
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { primaryKey } from "../../database/columns";

const timestamp = (name: string) => integer(name, { mode: "timestamp_ms" });

/** PLT-34 (T-87): immutable company matrix versions; the current one is the highest number. */
export const riskMatrixVersion = sqliteTable(
  "risk_matrix_version",
  {
    ...primaryKey(),
    companyId: text("company_id").notNull(),
    versionNo: integer("version_no").notNull(),
    size: integer("size").notNull(),
    likelihood: text("likelihood", { mode: "json" })
      .$type<RiskLevel[]>()
      .notNull(),
    consequence: text("consequence", { mode: "json" })
      .$type<RiskLevel[]>()
      .notNull(),
    bands: text("bands", { mode: "json" }).$type<RiskBand[]>().notNull(),
    createdAt: timestamp("created_at").notNull(),
    createdBy: text("created_by"),
  },
  (table) => [
    uniqueIndex("risk_matrix_version_unique").on(
      table.companyId,
      table.versionNo,
    ),
  ],
);

export type RiskMatrixVersionRow = typeof riskMatrixVersion.$inferSelect;
