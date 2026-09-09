import { z } from "zod";

/** POST /api/v1/auth/token  and  /api/v1/auth/login  -> { access_token, token_type } */
export const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string().default("bearer"),
});
export type TokenResponse = z.infer<typeof tokenResponseSchema>;

/** GET /api/v1/auth/me -> UserMe (app/schemas/user_schema.py) */
export const userMeSchema = z.object({
  id: z.number(),
  username: z.string().nullable().default(null),
  role: z.string().nullable().default(null),
  is_active: z.boolean().default(true),
});
export type UserMe = z.infer<typeof userMeSchema>;

/** Login form contract (client). */
export const loginInputSchema = z.object({
  username: z.string().trim().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});
export type LoginInput = z.infer<typeof loginInputSchema>;
