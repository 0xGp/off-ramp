import { createHttpApi } from "./http-client";
import { createMockApi } from "./mock-api";
import type { MeloApi } from "./types";

const baseUrl = process.env.NEXT_PUBLIC_MELO_API_URL;

/** The single seam between UI and backend. Set NEXT_PUBLIC_MELO_API_URL to use the real API. */
export const api: MeloApi = baseUrl ? createHttpApi(baseUrl) : createMockApi();

export * from "./types";
export * from "./errors";
