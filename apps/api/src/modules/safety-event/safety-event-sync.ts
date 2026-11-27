import {
  SAFETY_EVENT_CONFLICT_FIELDS,
  SAFETY_EVENT_ENTITY,
  updateSafetyEventRequestSchema,
} from "@hse/shared";
import { and, eq } from "drizzle-orm";

import type { TenantCompany } from "../../core/context/tenant";
import { NotFoundError, ValidationError } from "../../core/errors/app-error";
import type { SyncEntity, SyncSnapshot } from "../../platform/sync";
import { PermissionResolver } from "../identity";
import { ProjectDirectory } from "../project";
import { SafetyEventContext } from "./safety-event-context";
import { safetyEvent } from "./safety-event.schema";

const JOB_META = {
  requestId: "safety-event-sync",
  ipAddress: null,
  userAgent: null,
};

/** T-90: the reporter's report as a sync entity (conflict review, PLT-30). */
export const safetyEventSyncEntity: SyncEntity = {
  type: SAFETY_EVENT_ENTITY,
  conflictFields: SAFETY_EVENT_CONFLICT_FIELDS,
  async snapshot(db, companyId, entityId): Promise<SyncSnapshot | undefined> {
    const row = await db
      .select()
      .from(safetyEvent)
      .where(
        and(eq(safetyEvent.companyId, companyId), eq(safetyEvent.id, entityId)),
      )
      .get();
    if (!row) return undefined;
    const project = await new ProjectDirectory(db).get(
      companyId,
      row.projectId,
    );
    const { SafetyEventService } = await import("./safety-event.service");
    return new SafetyEventService(
      new SafetyEventContext({
        db,
        meta: JOB_META,
        clock: Date.now,
        resolver: new PermissionResolver(db),
      }),
    ).snapshot(row, project?.code ?? "");
  },
  async prepareUpdate(input) {
    const parsed = updateSafetyEventRequestSchema
      .omit({ baseVersion: true })
      .safeParse(input.values);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues.map((issue) => ({
          path: issue.path.map(String).join("."),
          message: issue.message,
        })),
      );
    }
    const { db, companyId } = input;
    const row = await db
      .select()
      .from(safetyEvent)
      .where(
        and(
          eq(safetyEvent.companyId, companyId),
          eq(safetyEvent.id, input.entityId),
        ),
      )
      .get();
    if (!row) throw new NotFoundError();
    const project = await new ProjectDirectory(db).get(
      companyId,
      row.projectId,
    );
    if (!project) throw new NotFoundError();
    const resolver = new PermissionResolver(db, () => input.now);
    const { SafetyEventService } = await import("./safety-event.service");
    const service = new SafetyEventService(
      new SafetyEventContext({
        db,
        meta: input.meta,
        clock: () => input.now,
        resolver,
      }),
    );
    const tenant = { id: companyId } as TenantCompany;
    const loaded = await service.load(tenant, project, input.principal, row.id);
    if (!service.reporterMayEdit(loaded)) throw new NotFoundError();
    return service.prepareUpdate(
      tenant,
      loaded,
      input.principal,
      parsed.data,
      input.expectVersion,
      undefined,
      input.offline,
    );
  },
};
