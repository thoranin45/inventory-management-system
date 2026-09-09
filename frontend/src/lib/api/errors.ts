import { z } from "zod";

/**
 * Backend ErrorResponse envelope (app/schemas/response.py):
 *   { success: false, message: string, errors: ErrorDetail[], request_id?: string }
 */
export const errorDetailSchema = z.object({
  field: z.string().nullish(),
  message: z.string(),
  error_type: z.string().nullish(),
});

export const errorResponseSchema = z.object({
  success: z.literal(false).optional(),
  message: z.string(),
  errors: z.array(errorDetailSchema).default([]),
  request_id: z.string().nullish(),
});

export type ErrorDetail = z.infer<typeof errorDetailSchema>;

export type ApiErrorKind =
  | "unauthorized" // 401
  | "forbidden" // 403
  | "not_found" // 404
  | "conflict" // 409
  | "validation" // 422
  | "rate_limited" // 429
  | "server" // 5xx
  | "network" // fetch threw / no response
  | "parse" // response body failed schema validation
  | "unknown";

function kindForStatus(status: number): ApiErrorKind {
  switch (status) {
    case 401:
      return "unauthorized";
    case 403:
      return "forbidden";
    case 404:
      return "not_found";
    case 409:
      return "conflict";
    case 422:
      return "validation";
    case 429:
      return "rate_limited";
    default:
      return status >= 500 ? "server" : "unknown";
  }
}

const USER_MESSAGE: Record<ApiErrorKind, string> = {
  unauthorized: "Your session has expired. Please sign in again.",
  forbidden: "You don't have permission to do that.",
  not_found: "That record could not be found.",
  conflict: "That action conflicts with the current state. Refresh and try again.",
  validation: "Some of the submitted values are not valid.",
  rate_limited: "Too many requests. Wait a moment and try again.",
  server: "The server ran into a problem. Support can trace it with the request ID.",
  network: "Could not reach the server. Check your connection and try again.",
  parse: "The server returned an unexpected response.",
  unknown: "Something went wrong.",
};

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number;
  readonly requestId?: string;
  readonly details: ErrorDetail[];
  /** best-effort machine payload from the backend, for forms etc. */
  readonly body?: unknown;

  constructor(init: {
    kind?: ApiErrorKind;
    status?: number;
    message?: string;
    requestId?: string;
    details?: ErrorDetail[];
    body?: unknown;
    cause?: unknown;
  }) {
    const kind = init.kind ?? (init.status ? kindForStatus(init.status) : "unknown");
    super(init.message || USER_MESSAGE[kind]);
    this.name = "ApiError";
    this.kind = kind;
    this.status = init.status ?? 0;
    this.requestId = init.requestId;
    this.details = init.details ?? [];
    this.body = init.body;
    if (init.cause) this.cause = init.cause;
  }

  /** Human-readable line for error UI. */
  get userMessage(): string {
    return this.message || USER_MESSAGE[this.kind];
  }

  static async fromResponse(res: Response): Promise<ApiError> {
    const requestId = res.headers.get("x-request-id") ?? undefined;
    let body: unknown;
    let message: string | undefined;
    let details: ErrorDetail[] = [];
    try {
      body = await res.json();
      const parsed = errorResponseSchema.safeParse(body);
      if (parsed.success) {
        message = parsed.data.message;
        details = parsed.data.errors;
        return new ApiError({
          status: res.status,
          message,
          requestId: parsed.data.request_id ?? requestId,
          details,
          body,
        });
      }
    } catch {
      /* non-JSON body */
    }
    return new ApiError({ status: res.status, message, requestId, details, body });
  }

  static network(cause: unknown): ApiError {
    return new ApiError({ kind: "network", cause });
  }

  static parse(cause: unknown, requestId?: string): ApiError {
    return new ApiError({ kind: "parse", requestId, cause });
  }
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError;
}
