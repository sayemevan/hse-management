import type {
  AddendumActionRequest,
  CausesRequest,
  ClassifySafetyEventRequest,
  CommentDto,
  CommentPageDto,
  CreateWitnessRequest,
  EventTypeRequest,
  InvestigationRequest,
  MySafetyEventsPageDto,
  MySafetyEventTab,
  RaiseRecommendationActionRequest,
  RecommendationRequest,
  ReportSafetyEventRequest,
  RiskMatrixDto,
  RiskMatrixRequest,
  RiskMatrixVersionListItemDto,
  SafetyEventDto,
  SafetyEventPageDto,
  SafetyEventTransitionRequest,
  SafetyList,
  SafetyListItemRequest,
  SafetyPersonInput,
  SafetySettingsDto,
  TimelinePageDto,
  UpdateWitnessRequest,
} from "@hse/shared";

import { authorizedBlob, authorizedRequest } from "@/modules/auth/auth-session";
import { queryString } from "@/modules/inspections/inspections.service";

const enc = encodeURIComponent;
const base = (projectId: string) => `/projects/${enc(projectId)}/safety-events`;
const one = (projectId: string, id: string, suffix = "") =>
  `${base(projectId)}/${enc(id)}${suffix}`;

/** PLT-34: the company risk matrix. */
export const riskMatrixService = {
  async current(): Promise<RiskMatrixDto> {
    return (await authorizedRequest<RiskMatrixDto>("/risk-matrix")).data;
  },
  async save(body: RiskMatrixRequest): Promise<RiskMatrixDto> {
    return (
      await authorizedRequest<RiskMatrixDto>("/risk-matrix", {
        method: "PUT",
        body,
      })
    ).data;
  },
  async reset(size: 4 | 5): Promise<RiskMatrixDto> {
    return (
      await authorizedRequest<RiskMatrixDto>("/risk-matrix/reset", {
        method: "POST",
        body: { size },
      })
    ).data;
  },
  async versions(): Promise<RiskMatrixVersionListItemDto[]> {
    return (
      await authorizedRequest<RiskMatrixVersionListItemDto[]>(
        "/risk-matrix/versions",
      )
    ).data;
  },
  async version(no: number): Promise<RiskMatrixDto> {
    return (
      await authorizedRequest<RiskMatrixDto>(
        `/risk-matrix/versions/${String(no)}`,
      )
    ).data;
  },
};

/** PLT-33: types and the company lists. */
export const safetySettingsService = {
  async get(): Promise<SafetySettingsDto> {
    return (
      await authorizedRequest<SafetySettingsDto>("/safety-event-settings")
    ).data;
  },
  async createType(body: EventTypeRequest): Promise<void> {
    await authorizedRequest("/safety-event-settings/types", {
      method: "POST",
      body,
    });
  },
  async updateType(id: string, body: EventTypeRequest): Promise<void> {
    await authorizedRequest(`/safety-event-settings/types/${enc(id)}`, {
      method: "PATCH",
      body,
    });
  },
  async moveType(id: string, direction: "up" | "down"): Promise<void> {
    await authorizedRequest(`/safety-event-settings/types/${enc(id)}/move`, {
      method: "POST",
      body: { direction },
    });
  },
  async setTypeActive(id: string, active: boolean): Promise<void> {
    await authorizedRequest(
      `/safety-event-settings/types/${enc(id)}/${active ? "reactivate" : "deactivate"}`,
      {
        method: "POST",
      },
    );
  },
  async createItem(
    list: SafetyList,
    body: SafetyListItemRequest,
  ): Promise<void> {
    await authorizedRequest(`/safety-event-settings/lists/${list}`, {
      method: "POST",
      body,
    });
  },
  async updateItem(id: string, body: SafetyListItemRequest): Promise<void> {
    await authorizedRequest(`/safety-event-settings/items/${enc(id)}`, {
      method: "PATCH",
      body,
    });
  },
  async moveItem(id: string, direction: "up" | "down"): Promise<void> {
    await authorizedRequest(`/safety-event-settings/items/${enc(id)}/move`, {
      method: "POST",
      body: { direction },
    });
  },
  async setItemActive(id: string, active: boolean): Promise<void> {
    await authorizedRequest(
      `/safety-event-settings/items/${enc(id)}/${active ? "reactivate" : "deactivate"}`,
      {
        method: "POST",
      },
    );
  },
};

/** PLT-33, US-040 – US-046 (online calls; offline reports go through the outbox). */
export const safetyEventsService = {
  async list(
    projectId: string,
    filters: Record<string, unknown>,
  ): Promise<SafetyEventPageDto> {
    return (
      await authorizedRequest<SafetyEventPageDto>(
        `${base(projectId)}${queryString(filters)}`,
      )
    ).data;
  },
  async mine(tab: MySafetyEventTab): Promise<MySafetyEventsPageDto> {
    return (
      await authorizedRequest<MySafetyEventsPageDto>(
        `/me/safety-events?tab=${tab}`,
      )
    ).data;
  },
  async report(
    projectId: string,
    body: ReportSafetyEventRequest,
  ): Promise<SafetyEventDto> {
    return (
      await authorizedRequest<SafetyEventDto>(base(projectId), {
        method: "POST",
        body,
      })
    ).data;
  },
  async get(projectId: string, id: string): Promise<SafetyEventDto> {
    return (await authorizedRequest<SafetyEventDto>(one(projectId, id))).data;
  },
  async classify(
    projectId: string,
    id: string,
    body: ClassifySafetyEventRequest,
  ): Promise<SafetyEventDto> {
    return (
      await authorizedRequest<SafetyEventDto>(one(projectId, id, "/classify"), {
        method: "POST",
        body,
      })
    ).data;
  },
  async reviewStart(projectId: string, id: string): Promise<void> {
    await authorizedRequest(one(projectId, id, "/review-start"), {
      method: "POST",
    });
  },
  async transition(
    projectId: string,
    id: string,
    body: SafetyEventTransitionRequest,
  ): Promise<SafetyEventDto> {
    return (
      await authorizedRequest<SafetyEventDto>(
        one(projectId, id, "/transitions"),
        { method: "POST", body },
      )
    ).data;
  },
  async setPeople(
    projectId: string,
    id: string,
    people: SafetyPersonInput[],
  ): Promise<void> {
    await authorizedRequest(one(projectId, id, "/people"), {
      method: "PUT",
      body: { people },
    });
  },
  async addWitness(
    projectId: string,
    id: string,
    body: CreateWitnessRequest,
  ): Promise<void> {
    await authorizedRequest(one(projectId, id, "/witnesses"), {
      method: "POST",
      body,
    });
  },
  async updateWitness(
    projectId: string,
    id: string,
    witnessId: string,
    body: UpdateWitnessRequest,
  ): Promise<void> {
    await authorizedRequest(
      one(projectId, id, `/witnesses/${enc(witnessId)}`),
      { method: "PATCH", body },
    );
  },
  async removeWitness(
    projectId: string,
    id: string,
    witnessId: string,
    reason: string,
  ): Promise<void> {
    await authorizedRequest(
      one(projectId, id, `/witnesses/${enc(witnessId)}/remove`),
      {
        method: "POST",
        body: { reason },
      },
    );
  },
  async saveInvestigation(
    projectId: string,
    id: string,
    body: InvestigationRequest,
  ): Promise<SafetyEventDto> {
    return (
      await authorizedRequest<SafetyEventDto>(
        one(projectId, id, "/investigation"),
        { method: "PUT", body },
      )
    ).data;
  },
  async saveCauses(
    projectId: string,
    id: string,
    body: CausesRequest,
  ): Promise<SafetyEventDto> {
    return (
      await authorizedRequest<SafetyEventDto>(
        one(projectId, id, "/investigation/causes"),
        { method: "PUT", body },
      )
    ).data;
  },
  async addRecommendation(
    projectId: string,
    id: string,
    body: RecommendationRequest,
  ): Promise<SafetyEventDto> {
    return (
      await authorizedRequest<SafetyEventDto>(
        one(projectId, id, "/recommendations"),
        { method: "POST", body },
      )
    ).data;
  },
  async raiseAction(
    projectId: string,
    id: string,
    recommendationId: string,
    body: RaiseRecommendationActionRequest,
  ): Promise<SafetyEventDto> {
    return (
      await authorizedRequest<SafetyEventDto>(
        one(projectId, id, `/recommendations/${enc(recommendationId)}/actions`),
        {
          method: "POST",
          body,
        },
      )
    ).data;
  },
  async noAction(
    projectId: string,
    id: string,
    recommendationId: string,
    reason: string,
  ): Promise<SafetyEventDto> {
    return (
      await authorizedRequest<SafetyEventDto>(
        one(
          projectId,
          id,
          `/recommendations/${enc(recommendationId)}/no-action`,
        ),
        {
          method: "POST",
          body: { reason },
        },
      )
    ).data;
  },
  async addendum(
    projectId: string,
    id: string,
    body: AddendumActionRequest,
  ): Promise<SafetyEventDto> {
    return (
      await authorizedRequest<SafetyEventDto>(
        one(projectId, id, "/addendum-actions"),
        { method: "POST", body },
      )
    ).data;
  },
  async uploadSensitive(
    projectId: string,
    id: string,
    file: File,
  ): Promise<void> {
    const form = new FormData();
    form.append("file", file);
    form.append("category", "sensitive");
    await authorizedRequest(one(projectId, id, "/files"), {
      method: "POST",
      body: form,
    });
  },
  async file(projectId: string, id: string, fileId: string): Promise<Blob> {
    return authorizedBlob(one(projectId, id, `/files/${enc(fileId)}`));
  },
  async history(
    projectId: string,
    id: string,
    before?: string | null,
  ): Promise<TimelinePageDto> {
    return (
      await authorizedRequest<TimelinePageDto>(
        one(projectId, id, `/history${queryString({ before })}`),
      )
    ).data;
  },
  async comments(
    projectId: string,
    id: string,
    before?: string | null,
  ): Promise<CommentPageDto> {
    return (
      await authorizedRequest<CommentPageDto>(
        one(projectId, id, `/comments${queryString({ before })}`),
      )
    ).data;
  },
  async addComment(
    projectId: string,
    id: string,
    body: string,
  ): Promise<CommentDto> {
    return (
      await authorizedRequest<CommentDto>(one(projectId, id, "/comments"), {
        method: "POST",
        body: { body },
      })
    ).data;
  },
  async editComment(
    projectId: string,
    id: string,
    commentId: string,
    body: string,
  ): Promise<CommentDto> {
    return (
      await authorizedRequest<CommentDto>(
        one(projectId, id, `/comments/${enc(commentId)}`),
        {
          method: "PATCH",
          body: { body },
        },
      )
    ).data;
  },
};
