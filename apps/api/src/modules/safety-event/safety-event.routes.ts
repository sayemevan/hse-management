import {
  addendumActionRequestSchema,
  causesRequestSchema,
  classifySafetyEventRequestSchema,
  commentListQuerySchema,
  commentRequestSchema,
  createWitnessRequestSchema,
  eventTypeRequestSchema,
  investigationRequestSchema,
  moveRequestSchema,
  mySafetyEventsQuerySchema,
  raiseRecommendationActionRequestSchema,
  reasonRequestSchema,
  recommendationRequestSchema,
  reportSafetyEventRequestSchema,
  SAFETY_LISTS,
  safetyEventListQuerySchema,
  safetyEventTransitionRequestSchema,
  safetyListItemRequestSchema,
  safetyPeopleRequestSchema,
  timelineQuerySchema,
  updateSafetyEventRequestSchema,
  updateWitnessRequestSchema,
} from "@hse/shared";
import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";

import { authenticate } from "../../core/auth/authenticate.middleware";
import type { AppEnv } from "../../core/context/app-context";
import type { TenantCompany } from "../../core/context/tenant";
import { NotFoundError, ValidationError } from "../../core/errors/app-error";
import { requestMeta } from "../../core/http/request-meta";
import { created, ok } from "../../core/http/response";
import { validate } from "../../core/http/validation";
import { sha256Hex } from "../../core/security/secure-token";
import { createDatabase } from "../../database/client";
import { FILE_CATEGORIES } from "../../platform/file-storage";
import {
  idempotencyClaimOf,
  idempotent,
  offlineMetaOf,
} from "../../platform/sync";
import { permissionResolverFor, validateIdentitySession } from "../identity";
import {
  currentProject,
  ProjectDirectory,
  requireProjectPermission,
} from "../project";
import {
  SafetyEventContext,
  type SafetyEventProject,
} from "./safety-event-context";
import { SafetyEventService } from "./safety-event.service";
import { SafetyEventWorkflow } from "./safety-event-workflow";

const signedIn = authenticate(validateIdentitySession);
const onProject = requireProjectPermission("projects.view");
const idParam = z.object({ id: z.uuid() });
const listParam = z.object({ list: z.enum(SAFETY_LISTS) });
const eventParam = z.object({ id: z.uuid(), eventId: z.uuid() });
const fileParam = eventParam.extend({ fileId: z.uuid() });
const witnessParam = eventParam.extend({ witnessId: z.uuid() });
const recommendationParam = eventParam.extend({ recommendationId: z.uuid() });
const commentParam = eventParam.extend({ commentId: z.uuid() });
const historyQuery = timelineQuerySchema.pick({ before: true });

function tenantOf(c: Context<AppEnv>): TenantCompany {
  const tenant = c.get("tenant");
  if (tenant.kind !== "company") throw new NotFoundError();
  return tenant.company;
}

function service(c: Context<AppEnv>): SafetyEventService {
  return new SafetyEventService(
    new SafetyEventContext({
      db: createDatabase(c.env.DB),
      meta: requestMeta(c),
      clock: Date.now,
      bucket: c.env.FILES,
      resolver: permissionResolverFor(c),
    }),
  );
}

function workflow(c: Context<AppEnv>): SafetyEventWorkflow {
  return new SafetyEventWorkflow(service(c));
}

/** `/api/v1/safety-event-settings` — types, lists, the device pack (PLT-33, US-044). */
export const safetyEventSettingsRoutes = new Hono<AppEnv>()
  .get("/", signedIn, async (c) =>
    ok(c, await service(c).settings.settings(tenantOf(c), c.get("principal"))),
  )
  .get("/offline-pack", signedIn, async (c) => {
    const pack = await service(c).settings.pack(
      tenantOf(c),
      c.get("principal"),
    );
    const etag = `"${(await sha256Hex(JSON.stringify({ types: pack.types, categories: pack.categories }))).slice(0, 32)}"`;
    if (c.req.header("if-none-match") === etag)
      return c.body(null, 304, { ETag: etag });
    c.header("ETag", etag);
    c.header("Cache-Control", "private, no-cache");
    return ok(c, pack);
  })
  .post(
    "/types",
    signedIn,
    validate("json", eventTypeRequestSchema),
    async (c) =>
      created(
        c,
        await service(c).settings.createType(
          tenantOf(c),
          c.get("principal"),
          c.req.valid("json"),
        ),
      ),
  )
  .patch(
    "/types/:id",
    signedIn,
    validate("param", idParam),
    validate("json", eventTypeRequestSchema),
    async (c) =>
      ok(
        c,
        await service(c).settings.updateType(
          tenantOf(c),
          c.get("principal"),
          c.req.valid("param").id,
          c.req.valid("json"),
        ),
      ),
  )
  .post(
    "/types/:id/move",
    signedIn,
    validate("param", idParam),
    validate("json", moveRequestSchema),
    async (c) => {
      await service(c).settings.moveType(
        tenantOf(c),
        c.get("principal"),
        c.req.valid("param").id,
        c.req.valid("json").direction,
      );
      return c.body(null, 204);
    },
  )
  .post(
    "/types/:id/deactivate",
    signedIn,
    validate("param", idParam),
    async (c) =>
      ok(
        c,
        await service(c).settings.setTypeActive(
          tenantOf(c),
          c.get("principal"),
          c.req.valid("param").id,
          false,
        ),
      ),
  )
  .post(
    "/types/:id/reactivate",
    signedIn,
    validate("param", idParam),
    async (c) =>
      ok(
        c,
        await service(c).settings.setTypeActive(
          tenantOf(c),
          c.get("principal"),
          c.req.valid("param").id,
          true,
        ),
      ),
  )
  .post(
    "/lists/:list",
    signedIn,
    validate("param", listParam),
    validate("json", safetyListItemRequestSchema),
    async (c) =>
      created(
        c,
        await service(c).settings.createItem(
          tenantOf(c),
          c.get("principal"),
          c.req.valid("param").list,
          c.req.valid("json"),
        ),
      ),
  )
  .patch(
    "/items/:id",
    signedIn,
    validate("param", idParam),
    validate("json", safetyListItemRequestSchema),
    async (c) =>
      ok(
        c,
        await service(c).settings.updateItem(
          tenantOf(c),
          c.get("principal"),
          c.req.valid("param").id,
          c.req.valid("json"),
        ),
      ),
  )
  .post(
    "/items/:id/move",
    signedIn,
    validate("param", idParam),
    validate("json", moveRequestSchema),
    async (c) => {
      await service(c).settings.moveItem(
        tenantOf(c),
        c.get("principal"),
        c.req.valid("param").id,
        c.req.valid("json").direction,
      );
      return c.body(null, 204);
    },
  )
  .post(
    "/items/:id/deactivate",
    signedIn,
    validate("param", idParam),
    async (c) =>
      ok(
        c,
        await service(c).settings.setItemActive(
          tenantOf(c),
          c.get("principal"),
          c.req.valid("param").id,
          false,
        ),
      ),
  )
  .post(
    "/items/:id/reactivate",
    signedIn,
    validate("param", idParam),
    async (c) =>
      ok(
        c,
        await service(c).settings.setItemActive(
          tenantOf(c),
          c.get("principal"),
          c.req.valid("param").id,
          true,
        ),
      ),
  );

// ---- Idempotent replays (T-69) -------------------------------------------------------------

const replayEvent = idempotent({
  companyIdOf: (c) => tenantOf(c).id,
  read: (c, id) =>
    service(c).detail(tenantOf(c), currentProject(c), c.get("principal"), id),
});

const replayFile = idempotent({
  companyIdOf: (c) => tenantOf(c).id,
  read: (c, linkId) =>
    service(c).fileDto(
      tenantOf(c),
      currentProject(c),
      c.get("principal"),
      c.req.param("eventId") ?? "",
      linkId,
    ),
});

/** `/api/v1/projects/{id}/safety-events` — PLT-33, US-040 – US-046. */
export const projectSafetyEventRoutes = new Hono<AppEnv>()
  .get(
    "/:id/safety-events",
    signedIn,
    onProject,
    validate("query", safetyEventListQuerySchema),
    async (c) =>
      ok(
        c,
        await service(c).list(
          tenantOf(c),
          currentProject(c),
          c.get("principal"),
          c.req.valid("query"),
        ),
      ),
  )
  .post(
    "/:id/safety-events",
    signedIn,
    onProject,
    replayEvent,
    validate("json", reportSafetyEventRequestSchema),
    async (c) => {
      const result = await service(c).create(
        tenantOf(c),
        currentProject(c),
        c.get("principal"),
        c.req.valid("json"),
        idempotencyClaimOf(c),
        offlineMetaOf(c, Date.now()),
      );
      return created(c, result.dto, {
        message: result.replayed ? "Already applied" : "Report sent",
      });
    },
  )
  .get(
    "/:id/safety-events/:eventId",
    signedIn,
    onProject,
    validate("param", eventParam),
    async (c) =>
      ok(
        c,
        await service(c).detail(
          tenantOf(c),
          currentProject(c),
          c.get("principal"),
          c.req.valid("param").eventId,
        ),
      ),
  )
  .patch(
    "/:id/safety-events/:eventId",
    signedIn,
    onProject,
    validate("param", eventParam),
    replayEvent,
    validate("json", updateSafetyEventRequestSchema),
    async (c) =>
      ok(
        c,
        await service(c).update(
          tenantOf(c),
          currentProject(c),
          c.get("principal"),
          c.req.valid("param").eventId,
          c.req.valid("json"),
          idempotencyClaimOf(c),
          offlineMetaOf(c, Date.now()),
        ),
      ),
  )
  .post(
    "/:id/safety-events/:eventId/classify",
    signedIn,
    onProject,
    validate("param", eventParam),
    validate("json", classifySafetyEventRequestSchema),
    async (c) =>
      ok(
        c,
        await workflow(c).classify(
          tenantOf(c),
          currentProject(c),
          c.get("principal"),
          c.req.valid("param").eventId,
          c.req.valid("json"),
        ),
      ),
  )
  .post(
    "/:id/safety-events/:eventId/review-start",
    signedIn,
    onProject,
    validate("param", eventParam),
    async (c) => {
      await workflow(c).reviewStart(
        tenantOf(c),
        currentProject(c),
        c.get("principal"),
        c.req.valid("param").eventId,
      );
      return c.body(null, 204);
    },
  )
  .post(
    "/:id/safety-events/:eventId/transitions",
    signedIn,
    onProject,
    validate("param", eventParam),
    replayEvent,
    validate("json", safetyEventTransitionRequestSchema),
    async (c) =>
      ok(
        c,
        await workflow(c).transition(
          tenantOf(c),
          currentProject(c),
          c.get("principal"),
          c.req.valid("param").eventId,
          c.req.valid("json"),
          idempotencyClaimOf(c),
        ),
      ),
  )
  .post(
    "/:id/safety-events/:eventId/files",
    signedIn,
    onProject,
    validate("param", eventParam),
    replayFile,
    async (c) => {
      const form = await c.req.formData().catch(() => null);
      const file = form?.get("file");
      if (!(file instanceof File))
        throw new ValidationError([{ path: "file", message: "required" }]);
      const category = form?.get("category");
      const witness = form?.get("witnessId");
      const witnessId =
        typeof witness === "string" && witness !== "" ? witness : null;
      if (witnessId !== null && !z.uuid().safeParse(witnessId).success) {
        throw new ValidationError([{ path: "witnessId", message: "invalid" }]);
      }
      return created(
        c,
        await service(c).addFile(
          tenantOf(c),
          currentProject(c),
          c.get("principal"),
          c.req.valid("param").eventId,
          file,
          { sensitive: category === "sensitive", witnessId },
          idempotencyClaimOf(c),
          offlineMetaOf(c, Date.now()),
        ),
      );
    },
  )
  .get(
    "/:id/safety-events/:eventId/files/:fileId",
    signedIn,
    onProject,
    validate("param", fileParam),
    async (c) => {
      const { eventId, fileId } = c.req.valid("param");
      const found = await service(c).openFile(
        tenantOf(c),
        currentProject(c),
        c.get("principal"),
        eventId,
        fileId,
      );
      if (!found) throw new NotFoundError();
      const { opened, sensitive } = found;
      const download = c.req.query("download") === "true";
      const headers: Record<string, string> = {
        "Content-Type": opened.row.contentType,
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${opened.row.fileName}"`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control":
          FILE_CATEGORIES[
            sensitive ? "safety_event_sensitive" : "safety_event_evidence"
          ].cacheControl,
        ETag: opened.etag,
      };
      if (c.req.header("if-none-match") === opened.etag) {
        void opened.body.cancel();
        return c.body(null, 304, headers);
      }
      return c.body(opened.body, 200, {
        ...headers,
        "Content-Length": String(opened.row.sizeBytes),
      });
    },
  )
  .delete(
    "/:id/safety-events/:eventId/files/:fileId",
    signedIn,
    onProject,
    validate("param", fileParam),
    async (c) => {
      const { eventId, fileId } = c.req.valid("param");
      await service(c).removeFile(
        tenantOf(c),
        currentProject(c),
        c.get("principal"),
        eventId,
        fileId,
      );
      return c.body(null, 204);
    },
  )
  .put(
    "/:id/safety-events/:eventId/people",
    signedIn,
    onProject,
    validate("param", eventParam),
    validate("json", safetyPeopleRequestSchema),
    async (c) =>
      ok(
        c,
        await service(c).setPeople(
          tenantOf(c),
          currentProject(c),
          c.get("principal"),
          c.req.valid("param").eventId,
          c.req.valid("json").people,
        ),
      ),
  )
  .post(
    "/:id/safety-events/:eventId/witnesses",
    signedIn,
    onProject,
    validate("param", eventParam),
    validate("json", createWitnessRequestSchema),
    async (c) =>
      created(
        c,
        await service(c).addWitness(
          tenantOf(c),
          currentProject(c),
          c.get("principal"),
          c.req.valid("param").eventId,
          c.req.valid("json"),
        ),
      ),
  )
  .patch(
    "/:id/safety-events/:eventId/witnesses/:witnessId",
    signedIn,
    onProject,
    validate("param", witnessParam),
    validate("json", updateWitnessRequestSchema),
    async (c) => {
      const { eventId, witnessId } = c.req.valid("param");
      return ok(
        c,
        await service(c).updateWitness(
          tenantOf(c),
          currentProject(c),
          c.get("principal"),
          eventId,
          witnessId,
          c.req.valid("json"),
        ),
      );
    },
  )
  .post(
    "/:id/safety-events/:eventId/witnesses/:witnessId/remove",
    signedIn,
    onProject,
    validate("param", witnessParam),
    validate("json", reasonRequestSchema),
    async (c) => {
      const { eventId, witnessId } = c.req.valid("param");
      await service(c).removeWitness(
        tenantOf(c),
        currentProject(c),
        c.get("principal"),
        eventId,
        witnessId,
        c.req.valid("json").reason,
      );
      return c.body(null, 204);
    },
  )
  .put(
    "/:id/safety-events/:eventId/investigation",
    signedIn,
    onProject,
    validate("param", eventParam),
    validate("json", investigationRequestSchema),
    async (c) =>
      ok(
        c,
        await workflow(c).saveInvestigation(
          tenantOf(c),
          currentProject(c),
          c.get("principal"),
          c.req.valid("param").eventId,
          c.req.valid("json"),
        ),
      ),
  )
  .put(
    "/:id/safety-events/:eventId/investigation/causes",
    signedIn,
    onProject,
    validate("param", eventParam),
    validate("json", causesRequestSchema),
    async (c) =>
      ok(
        c,
        await workflow(c).saveCauses(
          tenantOf(c),
          currentProject(c),
          c.get("principal"),
          c.req.valid("param").eventId,
          c.req.valid("json"),
        ),
      ),
  )
  .post(
    "/:id/safety-events/:eventId/recommendations",
    signedIn,
    onProject,
    validate("param", eventParam),
    validate("json", recommendationRequestSchema),
    async (c) =>
      created(
        c,
        await workflow(c).addRecommendation(
          tenantOf(c),
          currentProject(c),
          c.get("principal"),
          c.req.valid("param").eventId,
          c.req.valid("json"),
        ),
      ),
  )
  .patch(
    "/:id/safety-events/:eventId/recommendations/:recommendationId",
    signedIn,
    onProject,
    validate("param", recommendationParam),
    validate("json", recommendationRequestSchema),
    async (c) => {
      const { eventId, recommendationId } = c.req.valid("param");
      return ok(
        c,
        await workflow(c).updateRecommendation(
          tenantOf(c),
          currentProject(c),
          c.get("principal"),
          eventId,
          recommendationId,
          c.req.valid("json"),
        ),
      );
    },
  )
  .post(
    "/:id/safety-events/:eventId/recommendations/:recommendationId/actions",
    signedIn,
    onProject,
    validate("param", recommendationParam),
    validate("json", raiseRecommendationActionRequestSchema),
    async (c) => {
      const { eventId, recommendationId } = c.req.valid("param");
      return created(
        c,
        await workflow(c).raiseAction(
          tenantOf(c),
          currentProject(c),
          c.get("principal"),
          eventId,
          recommendationId,
          c.req.valid("json"),
        ),
      );
    },
  )
  .post(
    "/:id/safety-events/:eventId/recommendations/:recommendationId/no-action",
    signedIn,
    onProject,
    validate("param", recommendationParam),
    validate("json", reasonRequestSchema),
    async (c) => {
      const { eventId, recommendationId } = c.req.valid("param");
      return ok(
        c,
        await workflow(c).noAction(
          tenantOf(c),
          currentProject(c),
          c.get("principal"),
          eventId,
          recommendationId,
          c.req.valid("json").reason,
        ),
      );
    },
  )
  .post(
    "/:id/safety-events/:eventId/addendum-actions",
    signedIn,
    onProject,
    validate("param", eventParam),
    validate("json", addendumActionRequestSchema),
    async (c) =>
      created(
        c,
        await workflow(c).addendumAction(
          tenantOf(c),
          currentProject(c),
          c.get("principal"),
          c.req.valid("param").eventId,
          c.req.valid("json"),
        ),
      ),
  )
  .get(
    "/:id/safety-events/:eventId/history",
    signedIn,
    onProject,
    validate("param", eventParam),
    validate("query", historyQuery),
    async (c) =>
      ok(
        c,
        await service(c).history(
          tenantOf(c),
          currentProject(c),
          c.get("principal"),
          c.req.valid("param").eventId,
          c.req.valid("query").before,
        ),
      ),
  )
  .get(
    "/:id/safety-events/:eventId/comments",
    signedIn,
    onProject,
    validate("param", eventParam),
    validate("query", commentListQuerySchema),
    async (c) =>
      ok(
        c,
        await service(c).comments(
          tenantOf(c),
          currentProject(c),
          c.get("principal"),
          c.req.valid("param").eventId,
          c.req.valid("query").before,
        ),
      ),
  )
  .post(
    "/:id/safety-events/:eventId/comments",
    signedIn,
    onProject,
    validate("param", eventParam),
    validate("json", commentRequestSchema),
    async (c) =>
      created(
        c,
        await service(c).addComment(
          tenantOf(c),
          currentProject(c),
          c.get("principal"),
          c.req.valid("param").eventId,
          c.req.valid("json").body,
        ),
      ),
  )
  .patch(
    "/:id/safety-events/:eventId/comments/:commentId",
    signedIn,
    onProject,
    validate("param", commentParam),
    validate("json", commentRequestSchema),
    async (c) => {
      const { eventId, commentId } = c.req.valid("param");
      return ok(
        c,
        await service(c).editComment(
          tenantOf(c),
          currentProject(c),
          c.get("principal"),
          eventId,
          commentId,
          c.req.valid("json").body,
        ),
      );
    },
  );

/** `/api/v1/me/safety-events` — My reports. */
export const safetyEventMeRoutes = new Hono<AppEnv>().get(
  "/safety-events",
  signedIn,
  validate("query", mySafetyEventsQuerySchema),
  async (c) => {
    const tenant = tenantOf(c);
    const principal = c.get("principal");
    const db = createDatabase(c.env.DB);
    const resolver = permissionResolverFor(c);
    return ok(
      c,
      await service(c).mine(
        tenant,
        principal,
        c.req.valid("query"),
        async (ids) => {
          const access = await resolver.projectAccess(
            principal.userId,
            tenant.id,
            "projects.view",
          );
          const facts = await new ProjectDirectory(db).getMany(tenant.id, ids);
          const result = new Map<string, SafetyEventProject>();
          for (const [id, project] of facts) {
            if (project.status === "archived") continue;
            if (!access.allProjects && !access.projectIds.includes(id))
              continue;
            result.set(id, { id, code: project.code, status: project.status });
          }
          return result;
        },
      ),
    );
  },
);
