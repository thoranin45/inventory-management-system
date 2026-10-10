import { z } from "zod";

import { apiEnvelope } from "./common";

export const warehouseLocationSchema = z.object({
  id: z.number(),
  location_code: z.string(),
  location_name: z.string().nullable(),
  location_type: z.string().nullable(),
  is_active: z.boolean(),
});

export const warehouseSchema = z.object({
  id: z.number(),
  warehouse_code: z.string(),
  warehouse_name: z.string(),
  warehouse_type: z.string().nullable(),
  is_active: z.boolean(),
  locations: z.array(warehouseLocationSchema),
});
export type Warehouse = z.infer<typeof warehouseSchema>;

export const warehouseListEnvelope = apiEnvelope(z.array(warehouseSchema));
