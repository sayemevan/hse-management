import {
  type ActionDto,
  addIsoDays,
  type MySafetyEventsPageDto,
  type RiskMatrixDto,
  type SafetyEventDto,
  type SafetyEventPageDto,
  type SafetySettingsDto,
  type SafetySettingsPackDto,
  type TimelinePageDto,
  zonedIsoDate,
} from "@hse/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadConfig } from "../../src/config/config";
import { Logger } from "../../src/core/logging/logger";
import { createDatabase } from "../../src/database/client";
import { safetyEventDueJob } from "../../src/modules/safety-event";
import type { JobContext } from "../../src/platform/jobs";
import type { TestClient } from "../support/http";
import { projectHelpers } from "../support/projects";
import type { SeededCompany } from "../support/seed";
import { type IntegrationEnv, startIntegrationEnv } from "../support/test-env";

let harness: IntegrationEnv;
const { company, signedIn, createProject, giveProjectRole, makeReadOnly } =
  projectHelpers(() => harness);

beforeAll(async () => {
  harness = await startIntegrationEnv();
});
afterAll(async () => {
  await harness.dispose();
});

const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49,
  0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06,
  0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
]);
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const today = () => zonedIsoDate(Date.now(), "Asia/Riyadh");

interface Person {
  id: string;
  client: TestClient;
}

type Role =
  "safety_officer" | "site_engineer" | "supervisor" | "worker" | "client";

interface Team {
  target: SeededCompany;
  projectId: string;
  projectCode: string;
  admin: Person;
  manager: Person;
  officer: Person;
  engineer: Person;
  supervisor: Person;
  worker: Person;
  client: Person;
  settings: SafetySettingsDto;
}

async function team(): Promise<Team> {
  const target = await company();
  const { account: ca, client: admin } = await signedIn(
    target,
    "company_administrator",
  );
  const project = await createProject(admin);
  const member = async (role: Role) => {
    const { account, client } = await signedIn(target, role);
    await giveProjectRole(account.id, target, project.id, role);
    return { id: account.id, client };
  };
  const { account: hm, client: manager } = await signedIn(
    target,
    "hse_manager",
  );
  const settings = await admin.call<SafetySettingsDto>(
    "GET",
    "/safety-event-settings",
  );
  expect(settings.status, JSON.stringify(settings.body.error)).toBe(200);
  return {
    target,
    projectId: project.id,
    projectCode: project.code,
    admin: { id: ca.id, client: admin },
    manager: { id: hm.id, client: manager },
    officer: await member("safety_officer"),
    engineer: await member("site_engineer"),
    supervisor: await member("supervisor"),
    worker: await member("worker"),
    client: await member("client"),
    settings: settings.body.data,
  };
}

function typeId(t: Team, nameEn: string): string {
  const found = t.settings.types.find((type) => type.nameEn === nameEn);
  if (!found) throw new Error(`no type ${nameEn}`);
  return found.id;
}

function listItem(
  t: Team,
  list: "category" | "immediate_cause" | "root_cause",
  index = 0,
): string {
  const found = t.settings.lists[list][index];
  if (!found) throw new Error(`no ${list} item`);
  return found.id;
}

function base(t: Team): string {
  return `/projects/${t.projectId}/safety-events`;
}

function offline(
  key: string = crypto.randomUUID(),
  capturedAt = new Date(),
): Record<string, string> {
  return {
    "Idempotency-Key": key,
    "X-Captured-At": capturedAt.toISOString(),
    "X-Device-Id": "device-test-0001",
  };
}

async function report(
  t: Team,
  who: Person,
  overrides: Record<string, unknown> = {},
): Promise<SafetyEventDto> {
  const result = await who.client.call<SafetyEventDto>("POST", base(t), {
    body: {
      typeId: typeId(t, "Unsafe Condition"),
      title: "Missing edge protection, level 3",
      description: "The east side of the level 3 slab has no edge protection.",
      occurredAt: Date.now() - HOUR_MS,
      reportedSeverity: "high",
      ...overrides,
    },
  });
  expect(result.status, JSON.stringify(result.body.error)).toBe(201);
  return result.body.data;
}

async function get(who: Person, t: Team, id: string) {
  return who.client.call<SafetyEventDto>("GET", `${base(t)}/${id}`);
}

async function classify(
  who: Person,
  t: Team,
  id: string,
  body: Record<string, unknown>,
) {
  return who.client.call<SafetyEventDto>("POST", `${base(t)}/${id}/classify`, {
    body,
  });
}

async function move(
  who: Person,
  t: Team,
  id: string,
  body: Record<string, unknown>,
) {
  return who.client.call<SafetyEventDto>(
    "POST",
    `${base(t)}/${id}/transitions`,
    { body },
  );
}

async function photo(
  who: Person,
  t: Team,
  id: string,
  headers: Record<string, string> = {},
  category = "evidence",
) {
  const form = new FormData();
  form.append("file", new File([PNG], "photo.png", { type: "image/png" }));
  form.append("category", category);
  const response = await who.client.raw("POST", `${base(t)}/${id}/files`, {
    body: form,
    headers,
  });
  return {
    status: response.status,
    replayed: response.headers.get("Idempotent-Replayed") === "true",
    body: await response.json<{ error?: { code: string } }>(),
  };
}

async function count(sql: string, ...values: unknown[]): Promise<number> {
  const row = await harness.env.DB.prepare(sql)
    .bind(...values)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

function jobContext(clock: () => number = Date.now): JobContext {
  return {
    db: createDatabase(harness.env.DB),
    env: harness.env,
    config: loadConfig(harness.env),
    logger: new Logger("error"),
    clock,
    runId: "test-run",
  };
}

/** Reports a hazard and classifies it High with a rating: investigation required (O-159). */
async function reviewedHigh(t: Team): Promise<SafetyEventDto> {
  const event = await report(t, t.worker);
  const reviewed = await classify(t.officer, t, event.id, {
    categoryIds: [listItem(t, "category")],
    severity: "high",
    risk: { likelihood: 4, consequence: 4 },
  });
  expect(reviewed.status, JSON.stringify(reviewed.body.error)).toBe(200);
  return reviewed.body.data;
}

/** Fills and completes an investigation led by the engineer, with one action raised. */
async function investigate(
  t: Team,
  id: string,
): Promise<{ dto: SafetyEventDto; actionId: string }> {
  let dto = (await get(t.engineer, t, id)).body.data;
  const saved = await t.engineer.client.call<SafetyEventDto>(
    "PUT",
    `${base(t)}/${id}/investigation`,
    {
      body: {
        sequenceOfEvents:
          "07:40 rigging started; 07:55 the barrier was removed for a delivery.",
        lessonsLearned:
          "Edge protection must be replaced immediately after deliveries.",
        baseVersion: dto.investigation?.version,
      },
    },
  );
  expect(saved.status, JSON.stringify(saved.body.error)).toBe(200);
  dto = saved.body.data;
  for (const [kind, list] of [
    ["immediate", "immediate_cause"],
    ["root", "root_cause"],
  ] as const) {
    const causes = await t.engineer.client.call<SafetyEventDto>(
      "PUT",
      `${base(t)}/${id}/investigation/causes`,
      {
        body: {
          kind,
          items: [
            {
              categoryId: listItem(t, list),
              description: "No edge protection on the east side",
              whys:
                kind === "root"
                  ? ["Removed for a delivery", "Nobody was responsible"]
                  : [],
            },
          ],
          baseVersion: dto.investigation?.version,
        },
      },
    );
    expect(causes.status, JSON.stringify(causes.body.error)).toBe(200);
    dto = causes.body.data;
  }
  const rec = await t.engineer.client.call<SafetyEventDto>(
    "POST",
    `${base(t)}/${id}/recommendations`,
    {
      body: { kind: "corrective", description: "Reinstall edge protection" },
    },
  );
  expect(rec.status, JSON.stringify(rec.body.error)).toBe(201);
  const recommendation = rec.body.data.recommendations?.[0];
  const raised = await t.engineer.client.call<SafetyEventDto>(
    "POST",
    `${base(t)}/${id}/recommendations/${recommendation?.id ?? ""}/actions`,
    {
      body: {
        title: "Reinstall edge protection level 3",
        ownerId: t.supervisor.id,
        dueOn: addIsoDays(today(), 2),
        priority: "medium",
      },
    },
  );
  expect(raised.status, JSON.stringify(raised.body.error)).toBe(201);
  const actionId = raised.body.data.recommendations?.[0]?.actions[0]?.id ?? "";
  const completed = await move(t.engineer, t, id, {
    to: "complete_investigation",
  });
  expect(completed.status, JSON.stringify(completed.body.error)).toBe(200);
  return { dto: completed.body.data, actionId };
}

async function closeAction(t: Team, actionId: string): Promise<void> {
  const done = await t.supervisor.client.call(
    "POST",
    `/projects/${t.projectId}/actions/${actionId}/transitions`,
    {
      body: {
        transition: "complete",
        note: "Edge protection reinstated on level 3",
      },
    },
  );
  expect(done.status, JSON.stringify(done.body.error)).toBe(200);
  const closed = await t.officer.client.call(
    "POST",
    `/projects/${t.projectId}/actions/${actionId}/transitions`,
    {
      body: { transition: "verify_and_close", method: "site_visit" },
    },
  );
  expect(closed.status, JSON.stringify(closed.body.error)).toBe(200);
}

// ---- Settings and the risk matrix (PLT-33, PLT-34) -------------------------------------------

describe("PLT-34 risk matrix", () => {
  it("creates the default 5×5 on first read and saves new versions", async () => {
    const t = await team();
    const first = await t.worker.client.call<RiskMatrixDto>(
      "GET",
      "/risk-matrix",
    );
    expect(first.status).toBe(200);
    expect(first.body.data.versionNo).toBe(1);
    expect(first.body.data.size).toBe(5);
    expect(
      first.body.data.bands.map(
        (b) => `${b.key}:${String(b.min)}-${String(b.max)}`,
      ),
    ).toEqual(["low:1-4", "medium:5-9", "high:10-16", "critical:20-25"]);
    expect(first.body.data.canManage).toBe(false);
    const gap = structuredClone(first.body.data);
    gap.bands[2] = { ...gap.bands[2]!, min: 13 };
    const refused = await t.admin.client.call("PUT", "/risk-matrix", {
      body: { ...gap },
    });
    expect(refused.status).toBe(422);
    expect(refused.body.error?.code).toBe("RISK_MATRIX_INVALID");
    expect(
      (
        await t.worker.client.call("POST", "/risk-matrix/reset", {
          body: { size: 4 },
        })
      ).status,
    ).toBe(403);
    const reset = await t.admin.client.call<RiskMatrixDto>(
      "POST",
      "/risk-matrix/reset",
      { body: { size: 4 } },
    );
    expect(reset.body.data.versionNo).toBe(2);
    expect(reset.body.data.size).toBe(4);
    const versions = await t.admin.client.call<unknown[]>(
      "GET",
      "/risk-matrix/versions",
    );
    expect(versions.body.data).toHaveLength(2);
    await expect(
      harness.env.DB.prepare(
        "UPDATE risk_matrix_version SET size = 3 WHERE company_id = ?",
      )
        .bind(t.target.id)
        .run(),
    ).rejects.toThrow();
  });

  it("keeps an event rating on the version it was made with", async () => {
    const t = await team();
    const event = await reviewedHigh(t);
    expect(event.risk?.score).toBe(16);
    expect(event.risk?.bandKey).toBe("high");
    await t.admin.client.call("POST", "/risk-matrix/reset", {
      body: { size: 4 },
    });
    const after = (await get(t.officer, t, event.id)).body.data;
    expect(after.risk).toMatchObject({
      matrixVersion: 1,
      score: 16,
      bandKey: "high",
    });
  });
});

describe("PLT-33 settings", () => {
  it("seeds ten types, eleven categories and the cause lists once; the pack has an ETag", async () => {
    const t = await team();
    expect(t.settings.types).toHaveLength(10);
    expect(t.settings.lists.category).toHaveLength(11);
    expect(t.settings.lists.root_cause).toHaveLength(7);
    await t.manager.client.call("GET", "/safety-event-settings");
    expect(
      await count(
        "SELECT count(*) AS n FROM safety_event_type WHERE company_id = ?",
        t.target.id,
      ),
    ).toBe(10);
    const pack = await t.worker.client.raw(
      "GET",
      "/safety-event-settings/offline-pack",
    );
    expect(pack.status).toBe(200);
    const etag = pack.headers.get("ETag") ?? "";
    const body = await pack.json<{ data: SafetySettingsPackDto }>();
    expect(
      body.data.types.find((x) => x.nameEn === "Lost Time Injury")?.minSeverity,
    ).toBe("high");
    const again = await t.worker.client.raw(
      "GET",
      "/safety-event-settings/offline-pack",
      { headers: { "If-None-Match": etag } },
    );
    expect(again.status).toBe(304);
  });

  it("managers add types and list items; names are unique in both languages; the family is locked once used", async () => {
    const t = await team();
    const created = await t.admin.client.call<{ id: string }>(
      "POST",
      "/safety-event-settings/types",
      {
        body: {
          nameEn: "Dropped Object",
          family: "near_miss",
          investigation: "by_severity",
          riskRating: "required",
        },
      },
    );
    expect(created.status, JSON.stringify(created.body.error)).toBe(201);
    const dupe = await t.admin.client.call(
      "POST",
      "/safety-event-settings/lists/category",
      { body: { nameEn: "FIRE" } },
    );
    expect(dupe.body.error?.code).toBe("LIST_ITEM_NAME_TAKEN");
    expect(
      (
        await t.officer.client.call(
          "POST",
          "/safety-event-settings/lists/category",
          { body: { nameEn: "Noise" } },
        )
      ).status,
    ).toBe(403);
    await report(t, t.worker, {
      typeId: created.body.data.id,
      potentialOutcome: "Someone below could have been struck.",
      reportedSeverity: "medium",
    });
    const locked = await t.admin.client.call(
      "PATCH",
      `/safety-event-settings/types/${created.body.data.id}`,
      {
        body: {
          nameEn: "Dropped Object",
          family: "hazard",
          investigation: "by_severity",
        },
      },
    );
    expect(locked.body.error?.code).toBe("SAFETY_EVENT_FAMILY_LOCKED");
  });
});

// ---- Reporting (US-040 – US-042) ------------------------------------------------------------

describe("US-040 – US-042 reporting", () => {
  it("a worker reports a hazard with photos and sees it in My reports; others only through permissions", async () => {
    const t = await team();
    const event = await report(t, t.worker, {
      categoryIds: [listItem(t, "category")],
      witnesses: [{ name: "Khalid Saeed", contact: "0500000000" }],
    });
    expect(event.reference).toBe(`${t.projectCode}-EVT-0001`);
    expect(event.status).toBe("reported");
    expect(event.canEditReport).toBe(true);
    expect((await photo(t.worker, t, event.id)).status).toBe(201);
    const mine = await t.worker.client.call<MySafetyEventsPageDto>(
      "GET",
      "/me/safety-events?tab=reported",
    );
    expect(mine.body.data.items.map((i) => i.id)).toEqual([event.id]);
    // The worker has no view permission: the project list holds only their own events.
    const second = await report(t, t.officer, {
      title: "Oil spill near the gate",
    });
    const list = await t.worker.client.call<SafetyEventPageDto>("GET", base(t));
    expect(list.body.data.items.map((i) => i.id)).toEqual([event.id]);
    expect((await get(t.worker, t, second.id)).status).toBe(404);
    expect(second.reference).toBe(`${t.projectCode}-EVT-0002`);
    // High report: managers and the HSE leads were told in the same batch.
    expect(
      await count(
        "SELECT count(*) AS n FROM notification WHERE type = 'safety_event.high_reported' AND entity_id = ? AND recipient_user_id = ?",
        event.id,
        t.manager.id,
      ),
    ).toBe(1);
  });

  it("applies the type rules: minimum severity, near-miss outcome, injured person, time", async () => {
    const t = await team();
    const lti = await t.worker.client.call("POST", base(t), {
      body: {
        typeId: typeId(t, "Lost Time Injury"),
        title: "Hand injury at the rebar yard",
        description: "Worker cut his hand while cutting rebar ties.",
        occurredAt: Date.now() - HOUR_MS,
        reportedSeverity: "medium",
        people: [
          {
            name: "Ahmed Saleh",
            role: "injured",
            injuryNature: "cut",
            bodyPart: "hand",
            treatment: "medical_treatment",
          },
        ],
      },
    });
    expect(lti.body.error?.code).toBe("SAFETY_EVENT_SEVERITY_BELOW_MINIMUM");
    const noOutcome = await t.worker.client.call("POST", base(t), {
      body: {
        typeId: typeId(t, "Near Miss"),
        title: "Load dropped near rigger",
        description: "A sling slipped and the load dropped 1 m.",
        occurredAt: Date.now() - HOUR_MS,
        reportedSeverity: "high",
      },
    });
    expect(noOutcome.status).toBe(422);
    const noInjured = await t.worker.client.call("POST", base(t), {
      body: {
        typeId: typeId(t, "First Aid Case"),
        title: "Cut finger in the workshop",
        description: "A worker cut his finger on a sheet edge.",
        occurredAt: Date.now() - HOUR_MS,
        reportedSeverity: "low",
      },
    });
    expect(noInjured.status).toBe(422);
    const future = await t.worker.client.call("POST", base(t), {
      body: {
        typeId: typeId(t, "Hazard"),
        title: "Loose cable on stairs",
        description: "A cable is lying loose across the stairs.",
        occurredAt: Date.now() + HOUR_MS,
        reportedSeverity: "low",
      },
    });
    expect(future.body.error?.code).toBe("SAFETY_EVENT_TIME_INVALID");
    const late = await report(t, t.worker, {
      occurredAt: Date.now() - 3 * DAY_MS,
    });
    expect(late.reportedLate).toBe(true);
    expect((await t.client.client.call("GET", base(t))).status).toBe(200);
  });

  it("a critical incident alerts the company administrators; a client sees no injury details", async () => {
    const t = await team();
    const fatality = await report(t, t.supervisor, {
      typeId: typeId(t, "Fatality"),
      title: "Fall from scaffold",
      description: "A worker fell from the level 4 scaffold.",
      reportedSeverity: "critical",
      people: [
        {
          name: "Name withheld",
          role: "injured",
          injuryNature: "fracture",
          bodyPart: "multiple",
          treatment: "hospitalised",
        },
      ],
    });
    expect(
      await count(
        "SELECT count(*) AS n FROM notification WHERE type = 'safety_event.critical_reported' AND entity_id = ? AND recipient_user_id = ?",
        fatality.id,
        t.admin.id,
      ),
    ).toBe(1);
    const asClient = (await get(t.client, t, fatality.id)).body.data;
    expect(asClient.people).toBeNull();
    expect(asClient.injuredCount).toBe(1);
    const asOfficer = (await get(t.officer, t, fatality.id)).body.data;
    expect(asOfficer.people?.[0]?.injuryNature).toBe("fracture");
    const history = await t.client.client.call<TimelinePageDto>(
      "GET",
      `${base(t)}/${fatality.id}/history`,
    );
    expect(
      history.body.data.items.some(
        (i) => i.action === "safety_event.person_changed",
      ),
    ).toBe(false);
    expect(
      (await photo(t.client, t, fatality.id, {}, "sensitive")).status,
    ).toBe(403);
    expect(
      (await photo(t.officer, t, fatality.id, {}, "sensitive")).status,
    ).toBe(201);
    const generic = (await get(t.officer, t, fatality.id)).body.data.files.find(
      (f) => f.sensitive,
    );
    expect(
      (await t.officer.client.raw("GET", `/files/${generic?.fileId ?? ""}`))
        .status,
    ).toBe(404);
    expect(
      (await get(t.client, t, fatality.id)).body.data.files.some(
        (f) => f.sensitive,
      ),
    ).toBe(false);
  });
});

// ---- Offline (T-90) ------------------------------------------------------------------------

describe("T-90 offline reporting", () => {
  it("a report and its photo sent twice are applied once; edits after review start are refused", async () => {
    const t = await team();
    const id = crypto.randomUUID();
    const key = crypto.randomUUID();
    const body = JSON.stringify({
      id,
      typeId: typeId(t, "Hazard"),
      title: "Open trench without barrier",
      description: "Trench near gate 2 has no barrier.",
      occurredAt: Date.now() - HOUR_MS,
      reportedSeverity: "medium",
    });
    const send = () =>
      t.worker.client.raw("POST", base(t), {
        body,
        headers: { "content-type": "application/json", ...offline(key) },
      });
    expect((await send()).status).toBe(201);
    const replay = await send();
    expect(replay.headers.get("Idempotent-Replayed")).toBe("true");
    expect(
      await count("SELECT count(*) AS n FROM safety_event WHERE id = ?", id),
    ).toBe(1);
    expect(
      await count(
        "SELECT count(*) AS n FROM audit_log WHERE entity_id = ? AND action = 'safety_event.reported'",
        id,
      ),
    ).toBe(1);
    const photoKey = crypto.randomUUID();
    expect((await photo(t.worker, t, id, offline(photoKey))).status).toBe(201);
    expect((await photo(t.worker, t, id, offline(photoKey))).replayed).toBe(
      true,
    );
    expect(
      await count(
        "SELECT count(*) AS n FROM safety_event_file WHERE event_id = ?",
        id,
      ),
    ).toBe(1);
    const dto = (await get(t.worker, t, id)).body.data;
    expect(dto.offline).toBe(true);

    // A stale offline edit of the same field conflicts.
    const edit1 = await t.worker.client.call("PATCH", `${base(t)}/${id}`, {
      body: { title: "Open trench, no barrier", baseVersion: 1 },
    });
    expect(edit1.status).toBe(200);
    const stale = await t.worker.client.raw("PATCH", `${base(t)}/${id}`, {
      body: JSON.stringify({
        title: "Trench without a barrier",
        baseVersion: 1,
      }),
      headers: { "content-type": "application/json", ...offline() },
    });
    expect(stale.status).toBe(409);
    expect((await stale.json<{ error: { code: string } }>()).error.code).toBe(
      "SYNC_CONFLICT",
    );

    // Review starts: an offline edit is refused; a photo captured before review start is accepted.
    const capturedBefore = new Date();
    await t.officer.client.call("POST", `${base(t)}/${id}/review-start`);
    const locked = await t.worker.client.raw("PATCH", `${base(t)}/${id}`, {
      body: JSON.stringify({
        description: "Trench near gate 2 has no barrier at all.",
      }),
      headers: { "content-type": "application/json", ...offline() },
    });
    expect((await locked.json<{ error: { code: string } }>()).error.code).toBe(
      "SAFETY_EVENT_LOCKED",
    );
    expect(
      (
        await photo(
          t.worker,
          t,
          id,
          offline(
            crypto.randomUUID(),
            new Date(capturedBefore.getTime() - 60000),
          ),
        )
      ).status,
    ).toBe(201);
    expect(
      (
        await photo(
          t.worker,
          t,
          id,
          offline(crypto.randomUUID(), new Date(Date.now() + 1000)),
        )
      ).body.error?.code,
    ).toBe("SAFETY_EVENT_LOCKED");
  });
});

// ---- Review, investigation, witnesses, closure (US-043 – US-046) ---------------------------

describe("US-043 – US-046 workflow", () => {
  it("runs report → review (High) → investigation → action closed → Verification → closed", async () => {
    const t = await team();
    const reviewed = await reviewedHigh(t);
    expect(reviewed.investigationRequired).toBe(true);
    expect(reviewed.transitions).not.toContain("act");
    const skipped = await move(t.officer, t, reviewed.id, {
      to: "act",
      actions: [
        { title: "Put up barrier", ownerId: t.supervisor.id, dueOn: today() },
      ],
    });
    expect(skipped.body.error?.code).toBe(
      "SAFETY_EVENT_INVESTIGATION_REQUIRED",
    );
    expect(
      (
        await move(t.officer, t, reviewed.id, {
          to: "close",
          summary: "Nothing more to do here.",
        })
      ).body.error?.code,
    ).toBe("SAFETY_EVENT_INVESTIGATION_REQUIRED");
    const notEligible = await move(t.officer, t, reviewed.id, {
      to: "assign",
      leadId: t.worker.id,
    });
    expect(notEligible.body.error?.code).toBe(
      "SAFETY_EVENT_INVESTIGATOR_NOT_ELIGIBLE",
    );
    const assigned = await move(t.officer, t, reviewed.id, {
      to: "assign",
      leadId: t.engineer.id,
      memberIds: [t.supervisor.id],
    });
    expect(assigned.status, JSON.stringify(assigned.body.error)).toBe(200);
    expect(assigned.body.data.status).toBe("under_investigation");
    expect(assigned.body.data.investigation?.dueOn).toBe(
      addIsoDays(today(), 14),
    );

    // Witnesses: the team records a statement; a client sees the name only.
    const witness = await t.engineer.client.call<{ id: string }>(
      "POST",
      `${base(t)}/${reviewed.id}/witnesses`,
      {
        body: {
          name: "Khalid Saeed",
          company: "Al-Bina Contracting",
          contact: "khalid@example.com",
        },
      },
    );
    expect(witness.status, JSON.stringify(witness.body.error)).toBe(201);
    const statement = await t.engineer.client.call(
      "PATCH",
      `${base(t)}/${reviewed.id}/witnesses/${witness.body.data.id}`,
      {
        body: {
          statement: "I saw the barrier being removed for the delivery truck.",
        },
      },
    );
    expect(statement.status, JSON.stringify(statement.body.error)).toBe(200);
    const asClient = (await get(t.client, t, reviewed.id)).body.data;
    const seen = asClient.witnesses.find((w) => w.id === witness.body.data.id);
    expect(seen).toMatchObject({
      name: "Khalid Saeed",
      contact: null,
      statement: null,
      hasStatement: true,
      restricted: true,
    });

    const incomplete = await move(t.engineer, t, reviewed.id, {
      to: "complete_investigation",
    });
    expect(incomplete.body.error?.code).toBe(
      "SAFETY_EVENT_INVESTIGATION_INCOMPLETE",
    );
    expect(
      (
        await move(t.supervisor, t, reviewed.id, {
          to: "complete_investigation",
        })
      ).status,
    ).toBe(403);

    const { dto, actionId } = await investigate(t, reviewed.id);
    expect(dto.status).toBe("corrective_action");
    const action = await t.supervisor.client.call<ActionDto>(
      "GET",
      `/projects/${t.projectId}/actions/${actionId}`,
    );
    expect(action.body.data.source.label).toBe(
      `${t.projectCode}-EVT-0001 · Recommendation 1`,
    );
    // After completion, the witness statement is read-only.
    const lockedStatement = await t.engineer.client.call(
      "PATCH",
      `${base(t)}/${reviewed.id}/witnesses/${witness.body.data.id}`,
      {
        body: { statement: "Changed my mind." },
      },
    );
    expect(lockedStatement.body.error?.code).toBe("SAFETY_EVENT_LOCKED");

    await closeAction(t, actionId);
    const verification = (await get(t.officer, t, reviewed.id)).body.data;
    expect(verification.status).toBe("verification");
    expect(verification.recommendations?.[0]?.status).toBe("resolved");
    expect(
      await count(
        "SELECT count(*) AS n FROM notification WHERE type = 'safety_event.verification_ready' AND entity_id = ? AND recipient_user_id = ?",
        reviewed.id,
        t.manager.id,
      ),
    ).toBe(1);

    // The lead can't close while another closer exists (O-174).
    await giveProjectRole(
      t.engineer.id,
      t.target,
      t.projectId,
      "safety_officer",
    );
    expect(
      (
        await move(t.engineer, t, reviewed.id, {
          to: "close",
          summary: "Closed by the investigator.",
        })
      ).body.error?.code,
    ).toBe("SAFETY_EVENT_SELF_CLOSURE");
    const closed = await move(t.manager, t, reviewed.id, {
      to: "close",
      summary: "Edge protection reinstated; daily inspection now checks it.",
    });
    expect(closed.status, JSON.stringify(closed.body.error)).toBe(200);
    expect(closed.body.data.status).toBe("closed");

    const mine = await t.worker.client.call<MySafetyEventsPageDto>(
      "GET",
      "/me/safety-events?tab=reported",
    );
    expect(mine.body.data.items[0]?.status).toBe("closed");
    const reporterView = (await get(t.worker, t, reviewed.id)).body.data;
    expect(reporterView.closureSummary).toContain("Edge protection reinstated");
    expect(reporterView.investigation).toBeNull();
    expect(
      await count(
        "SELECT count(*) AS n FROM notification WHERE type = 'safety_event.closed' AND entity_id = ? AND recipient_user_id = ?",
        reviewed.id,
        t.worker.id,
      ),
    ).toBe(1);
    // Read-only after closure.
    expect(
      (
        await t.engineer.client.call(
          "POST",
          `${base(t)}/${reviewed.id}/witnesses`,
          { body: { name: "Late witness" } },
        )
      ).body.error?.code,
    ).toBe("SAFETY_EVENT_LOCKED");
    expect(
      (
        await t.worker.client.call(
          "POST",
          `${base(t)}/${reviewed.id}/comments`,
          { body: { body: "Thanks!" } },
        )
      ).status,
    ).toBe(409);
  });

  it("a medium hazard goes straight to actions; voiding the action re-opens the event", async () => {
    const t = await team();
    const event = await report(t, t.worker, { reportedSeverity: "medium" });
    await classify(t.officer, t, event.id, {
      categoryIds: [listItem(t, "category")],
      severity: "medium",
      risk: { likelihood: 2, consequence: 3 },
    });
    const acted = await move(t.officer, t, event.id, {
      to: "act",
      actions: [
        {
          title: "Put up barrier tape",
          ownerId: t.supervisor.id,
          dueOn: today(),
          priority: "medium",
        },
        {
          title: "Brief the crew on edges",
          ownerId: t.engineer.id,
          dueOn: addIsoDays(today(), 3),
          priority: "low",
        },
      ],
    });
    expect(acted.status, JSON.stringify(acted.body.error)).toBe(200);
    expect(acted.body.data.status).toBe("corrective_action");
    const refs =
      acted.body.data.recommendations?.flatMap((r) =>
        r.actions.map((a) => a.reference),
      ) ?? [];
    expect(refs).toEqual([
      `${t.projectCode}-ACT-0001`,
      `${t.projectCode}-ACT-0002`,
    ]);
    const voidedEvent = await move(t.officer, t, event.id, {
      to: "void",
      kind: "reported_in_error",
      reason: "Wrong project",
    });
    expect(voidedEvent.body.error?.code).toBe("SAFETY_EVENT_OPEN_ACTIONS");
    const [first, second] = acted.body.data.recommendations ?? [];
    await closeAction(t, first?.actions[0]?.id ?? "");
    expect((await get(t.officer, t, event.id)).body.data.status).toBe(
      "corrective_action",
    );
    const voided = await t.officer.client.call(
      "POST",
      `/projects/${t.projectId}/actions/${second?.actions[0]?.id ?? ""}/void`,
      {
        body: { reason: "Raised by mistake, duplicate" },
      },
    );
    expect(voided.status, JSON.stringify(voided.body.error)).toBe(200);
    const after = (await get(t.officer, t, event.id)).body.data;
    expect(after.recommendations?.[1]?.status).toBe("open");
    const noAction = await t.officer.client.call<SafetyEventDto>(
      "POST",
      `${base(t)}/${event.id}/recommendations/${second?.id ?? ""}/no-action`,
      { body: { reason: "Covered by the toolbox talk" } },
    );
    expect(noAction.status, JSON.stringify(noAction.body.error)).toBe(200);
    expect(noAction.body.data.status).toBe("verification");
  });

  it("closes a low hazard from review with no further action; refuses self-review when others can review", async () => {
    const t = await team();
    const own = await report(t, t.officer, { reportedSeverity: "low" });
    expect(own.canClassify).toBe(false);
    expect(
      (
        await classify(t.officer, t, own.id, {
          categoryIds: [listItem(t, "category")],
          severity: "low",
        })
      ).status,
    ).toBe(403);
    const event = await report(t, t.worker, { reportedSeverity: "low" });
    const missing = await move(t.officer, t, event.id, {
      to: "close",
      summary: "Barrier replaced on the spot.",
    });
    expect(missing.status).toBe(422);
    await classify(t.officer, t, event.id, {
      categoryIds: [listItem(t, "category")],
      severity: "low",
      risk: { likelihood: 1, consequence: 2 },
    });
    const closed = await move(t.officer, t, event.id, {
      to: "close",
      summary: "Barrier replaced on the spot by the reporter; checked.",
    });
    expect(closed.status, JSON.stringify(closed.body.error)).toBe(200);
    expect(closed.body.data.closureKind).toBe("no_further_action");
  });

  it("two reviewers deciding at once: one wins", async () => {
    const t = await team();
    const event = await report(t, t.worker, { reportedSeverity: "low" });
    await classify(t.officer, t, event.id, {
      categoryIds: [listItem(t, "category")],
      severity: "low",
      risk: { likelihood: 1, consequence: 1 },
    });
    const [a, b] = await Promise.all([
      move(t.officer, t, event.id, {
        to: "close",
        summary: "Closed by the first reviewer.",
      }),
      move(t.manager, t, event.id, {
        to: "void",
        kind: "not_safety_event",
        reason: "Not a safety event",
      }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
  });
});

// ---- Platform rules ------------------------------------------------------------------------

describe("PLT-33 platform rules", () => {
  it("events are never deleted; places in use stay; read-only companies are refused", async () => {
    const t = await team();
    const area = await t.admin.client.call<{ id: string }>(
      "POST",
      `/projects/${t.projectId}/places`,
      {
        body: { level: "area", name: "Block A" },
      },
    );
    const event = await report(t, t.worker, {
      place: { areaId: area.body.data.id },
    });
    await expect(
      harness.env.DB.prepare("DELETE FROM safety_event WHERE id = ?")
        .bind(event.id)
        .run(),
    ).rejects.toThrow();
    expect(
      (
        await t.admin.client.call(
          "DELETE",
          `/projects/${t.projectId}/places/${area.body.data.id}`,
        )
      ).body.error?.code,
    ).toBe("PLACE_IN_USE");
    await makeReadOnly(t.target);
    const refused = await t.worker.client.call("POST", base(t), {
      body: {
        typeId: typeId(t, "Hazard"),
        title: "Loose cable",
        description: "Cable across the walkway.",
        occurredAt: Date.now(),
        reportedSeverity: "low",
      },
    });
    expect(refused.body.error?.code).toBe("SUBSCRIPTION_READ_ONLY");
  });

  it("the daily job sends the overdue and review-waiting notices once", async () => {
    const t = await team();
    const reviewed = await reviewedHigh(t);
    await move(t.officer, t, reviewed.id, {
      to: "assign",
      leadId: t.engineer.id,
      dueOn: today(),
    });
    await report(t, t.worker, {
      reportedSeverity: "low",
      title: "Unreviewed hazard report",
    });
    const later = () => Date.now() + 2 * DAY_MS;
    await safetyEventDueJob.run(jobContext(later));
    await safetyEventDueJob.run(jobContext(later));
    expect(
      await count(
        "SELECT count(*) AS n FROM notification WHERE type = 'safety_event.investigation_overdue' AND entity_id = ? AND recipient_user_id = ?",
        reviewed.id,
        t.engineer.id,
      ),
    ).toBe(1);
    expect(
      await count(
        "SELECT count(*) AS n FROM notification WHERE type = 'safety_event.review_waiting' AND recipient_user_id = ?",
        t.officer.id,
      ),
    ).toBe(1);
  });
});
