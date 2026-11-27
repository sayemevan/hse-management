import {
  riskMatrixRequestSchema,
  riskMatrixResetRequestSchema,
} from "@hse/shared";
import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";

import { authenticate } from "../../core/auth/authenticate.middleware";
import type { AppEnv } from "../../core/context/app-context";
import type { TenantCompany } from "../../core/context/tenant";
import { NotFoundError } from "../../core/errors/app-error";
import { requestMeta } from "../../core/http/request-meta";
import { ok } from "../../core/http/response";
import { validate } from "../../core/http/validation";
import { createDatabase } from "../../database/client";
import { permissionResolverFor, validateIdentitySession } from "../identity";
import { RiskMatrixService } from "./risk.service";

const signedIn = authenticate(validateIdentitySession);
const versionParam = z.object({ versionNo: z.coerce.number().int().min(1) });

function tenantOf(c: Context<AppEnv>): TenantCompany {
  const tenant = c.get("tenant");
  if (tenant.kind !== "company") throw new NotFoundError();
  return tenant.company;
}

function service(c: Context<AppEnv>): RiskMatrixService {
  return new RiskMatrixService({
    db: createDatabase(c.env.DB),
    meta: requestMeta(c),
    clock: Date.now,
    resolver: permissionResolverFor(c),
  });
}

/** `/api/v1/risk-matrix` — PLT-34. */
export const riskMatrixRoutes = new Hono<AppEnv>()
  .get("/", signedIn, async (c) =>
    ok(c, await service(c).current(tenantOf(c), c.get("principal"))),
  )
  .put("/", signedIn, validate("json", riskMatrixRequestSchema), async (c) =>
    ok(
      c,
      await service(c).save(
        tenantOf(c),
        c.get("principal"),
        c.req.valid("json"),
      ),
      {
        message: "Risk matrix saved",
      },
    ),
  )
  .post(
    "/reset",
    signedIn,
    validate("json", riskMatrixResetRequestSchema),
    async (c) =>
      ok(
        c,
        await service(c).reset(
          tenantOf(c),
          c.get("principal"),
          c.req.valid("json").size,
        ),
      ),
  )
  .get("/versions", signedIn, async (c) =>
    ok(c, await service(c).versions(tenantOf(c))),
  )
  .get(
    "/versions/:versionNo",
    signedIn,
    validate("param", versionParam),
    async (c) =>
      ok(
        c,
        await service(c).version(
          tenantOf(c),
          c.get("principal"),
          c.req.valid("param").versionNo,
        ),
      ),
  );
