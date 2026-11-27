import {
  defaultRiskMatrix,
  generateId,
  type RiskMatrix,
  type RiskMatrixDto,
  type RiskMatrixRequest,
  type RiskMatrixSize,
  type RiskMatrixVersionListItemDto,
  riskMatrixRequestSchema,
  validateRiskMatrix,
} from "@hse/shared";
import { and, desc, eq } from "drizzle-orm";
import type { z } from "zod";

import type { Principal } from "../../core/auth/principal";
import type { TenantCompany } from "../../core/context/tenant";
import { ForbiddenError, NotFoundError } from "../../core/errors/app-error";
import type { RequestMeta } from "../../core/http/request-meta";
import type { Database } from "../../database/client";
import { UnitOfWork } from "../../database/unit-of-work";
import { AuditLogService } from "../../platform/audit-log";
import { type PermissionResolver, userSummaries } from "../identity";
import { RiskMatrixInvalidError } from "./risk.errors";
import { riskMatrixVersion, type RiskMatrixVersionRow } from "./risk.schema";

const MANAGE = "risk.matrix.manage";

export interface RiskMatrixVersion extends RiskMatrix {
  versionNo: number;
}

function toMatrix(row: RiskMatrixVersionRow): RiskMatrixVersion {
  return {
    versionNo: row.versionNo,
    size: row.size as RiskMatrixSize,
    likelihood: row.likelihood,
    consequence: row.consequence,
    bands: row.bands,
  };
}

function isUnique(error: unknown): boolean {
  const message = String(
    (error as { message?: unknown } | null)?.message ?? error,
  );
  return message.includes("UNIQUE") && message.includes("risk_matrix_version");
}

/**
 * What other modules may know about the company's risk matrix (T-87, T-35). The first read
 * creates version 1 with the O-160 defaults.
 */
export class RiskMatrixDirectory {
  constructor(
    private readonly db: Database,
    private readonly clock: () => number = Date.now,
  ) {}

  private async latest(
    companyId: string,
  ): Promise<RiskMatrixVersionRow | undefined> {
    return this.db
      .select()
      .from(riskMatrixVersion)
      .where(eq(riskMatrixVersion.companyId, companyId))
      .orderBy(desc(riskMatrixVersion.versionNo))
      .limit(1)
      .get();
  }

  async currentRow(companyId: string): Promise<RiskMatrixVersionRow> {
    const found = await this.latest(companyId);
    if (found) return found;
    const defaults = defaultRiskMatrix(5);
    try {
      await this.db
        .insert(riskMatrixVersion)
        .values({
          id: generateId(),
          companyId,
          versionNo: 1,
          size: defaults.size,
          likelihood: defaults.likelihood,
          consequence: defaults.consequence,
          bands: defaults.bands,
          createdAt: new Date(this.clock()),
          createdBy: null,
        })
        .run();
    } catch (error) {
      if (!isUnique(error)) throw error;
    }
    const created = await this.latest(companyId);
    if (!created) throw new Error("Risk matrix could not be created");
    return created;
  }

  async current(companyId: string): Promise<RiskMatrixVersion> {
    return toMatrix(await this.currentRow(companyId));
  }

  async version(
    companyId: string,
    versionNo: number,
  ): Promise<RiskMatrixVersion | null> {
    const row = await this.db
      .select()
      .from(riskMatrixVersion)
      .where(
        and(
          eq(riskMatrixVersion.companyId, companyId),
          eq(riskMatrixVersion.versionNo, versionNo),
        ),
      )
      .get();
    return row ? toMatrix(row) : null;
  }
}

export interface RiskDeps {
  db: Database;
  meta: RequestMeta;
  clock: () => number;
  resolver: PermissionResolver;
}

/** PLT-34: read, save as a new version, reset, version history. */
export class RiskMatrixService {
  private readonly directory: RiskMatrixDirectory;
  private readonly audit: AuditLogService;

  constructor(private readonly deps: RiskDeps) {
    this.directory = new RiskMatrixDirectory(deps.db, deps.clock);
    this.audit = new AuditLogService(deps.db, deps.meta, deps.clock);
  }

  private async canManage(
    tenant: TenantCompany,
    principal: Principal,
  ): Promise<boolean> {
    return (
      await this.deps.resolver.companyPermissions(principal.userId, tenant.id)
    ).has(MANAGE);
  }

  private async dto(
    tenant: TenantCompany,
    principal: Principal,
    row: RiskMatrixVersionRow,
  ): Promise<RiskMatrixDto> {
    const names = await userSummaries(
      this.deps.db,
      row.createdBy ? [row.createdBy] : [],
    );
    return {
      ...toMatrix(row),
      createdAt: row.createdAt.getTime(),
      createdByName: row.createdBy
        ? (names.get(row.createdBy)?.fullName ?? null)
        : null,
      canManage: await this.canManage(tenant, principal),
    };
  }

  /** Every signed-in user of the company may read the matrix (it holds no personal data). */
  async current(
    tenant: TenantCompany,
    principal: Principal,
  ): Promise<RiskMatrixDto> {
    return this.dto(
      tenant,
      principal,
      await this.directory.currentRow(tenant.id),
    );
  }

  async versions(
    tenant: TenantCompany,
  ): Promise<RiskMatrixVersionListItemDto[]> {
    await this.directory.currentRow(tenant.id);
    const rows = await this.deps.db
      .select()
      .from(riskMatrixVersion)
      .where(eq(riskMatrixVersion.companyId, tenant.id))
      .orderBy(desc(riskMatrixVersion.versionNo))
      .all();
    const names = await userSummaries(
      this.deps.db,
      rows.flatMap((r) => (r.createdBy ? [r.createdBy] : [])),
    );
    return rows.map((row) => ({
      versionNo: row.versionNo,
      size: row.size as RiskMatrixSize,
      createdAt: row.createdAt.getTime(),
      createdByName: row.createdBy
        ? (names.get(row.createdBy)?.fullName ?? null)
        : null,
    }));
  }

  async version(
    tenant: TenantCompany,
    principal: Principal,
    versionNo: number,
  ): Promise<RiskMatrixDto> {
    const row = await this.deps.db
      .select()
      .from(riskMatrixVersion)
      .where(
        and(
          eq(riskMatrixVersion.companyId, tenant.id),
          eq(riskMatrixVersion.versionNo, versionNo),
        ),
      )
      .get();
    if (!row) throw new NotFoundError();
    return this.dto(tenant, principal, row);
  }

  async save(
    tenant: TenantCompany,
    principal: Principal,
    input: z.output<typeof riskMatrixRequestSchema> | RiskMatrixRequest,
    reset = false,
  ): Promise<RiskMatrixDto> {
    if (!(await this.canManage(tenant, principal))) throw new ForbiddenError();
    const parsed = riskMatrixRequestSchema.parse(input);
    const matrix: RiskMatrix = {
      size: parsed.size,
      likelihood: parsed.likelihood,
      consequence: parsed.consequence,
      bands: parsed.bands,
    };
    const issues = validateRiskMatrix(matrix);
    if (issues.length > 0) throw new RiskMatrixInvalidError(issues);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const current = await this.directory.currentRow(tenant.id);
      const id = generateId();
      const versionNo = current.versionNo + 1;
      try {
        await new UnitOfWork(this.deps.db)
          .add(
            this.deps.db.insert(riskMatrixVersion).values({
              id,
              companyId: tenant.id,
              versionNo,
              size: matrix.size,
              likelihood: matrix.likelihood,
              consequence: matrix.consequence,
              bands: matrix.bands,
              createdAt: new Date(this.deps.clock()),
              createdBy: principal.userId,
            }),
            this.audit.entry({
              action: reset ? "risk_matrix.reset" : "risk_matrix.saved",
              actorUserId: principal.userId,
              companyId: tenant.id,
              entityType: "risk_matrix",
              entityId: id,
              newValue: {
                versionNo,
                size: matrix.size,
                bands: matrix.bands.map(
                  (b) => `${b.key}:${String(b.min)}-${String(b.max)}`,
                ),
              },
            }),
          )
          .commit();
        return this.version(tenant, principal, versionNo);
      } catch (error) {
        if (!isUnique(error)) throw error;
      }
    }
    throw new Error("Risk matrix could not be saved");
  }

  async reset(
    tenant: TenantCompany,
    principal: Principal,
    size: RiskMatrixSize,
  ): Promise<RiskMatrixDto> {
    return this.save(tenant, principal, defaultRiskMatrix(size), true);
  }
}
