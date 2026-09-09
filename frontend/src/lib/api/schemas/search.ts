import { z } from "zod";
import { apiEnvelope } from "./common";

/** GET /api/v1/search?q=  (app/services/search_service.py) */
export const searchResultSchema = z.object({
  type: z.string(),
  id: z.union([z.number(), z.string()]),
  label: z.string(),
  sublabel: z.string().nullish(),
  status: z.string().nullish(),
  url_hint: z.string().nullish(),
});
export type SearchResult = z.infer<typeof searchResultSchema>;

export const searchResponseSchema = z.object({
  query: z.string(),
  results: z.array(searchResultSchema),
  truncated: z.boolean().default(false),
});
export type SearchResponse = z.infer<typeof searchResponseSchema>;
export const searchResponseEnvelope = apiEnvelope(searchResponseSchema);
