import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { ErrorState, EmptyState } from "./states";
import { ApiError } from "@/lib/api/errors";

describe("ErrorState", () => {
  it("surfaces the backend request_id for support", () => {
    const err = new ApiError({ status: 500, requestId: "req-abc-123" });
    render(<ErrorState error={err} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/req-abc-123/)).toBeInTheDocument();
    expect(screen.getByText(/support can trace it/i)).toBeInTheDocument();
  });

  it("falls back gracefully with no request_id", () => {
    render(<ErrorState error={new Error("boom")} />);
    expect(screen.getByText("boom")).toBeInTheDocument();
    expect(screen.queryByText(/request id/i)).toBeNull();
  });

  it("401 uses the session-expiry message", () => {
    render(<ErrorState error={new ApiError({ status: 401 })} />);
    expect(screen.getByText(/session has expired/i)).toBeInTheDocument();
  });
});

describe("EmptyState", () => {
  it("renders a title and message", () => {
    render(<EmptyState title="None" message="Nothing to show." />);
    expect(screen.getByRole("heading", { name: "None" })).toBeInTheDocument();
    expect(screen.getByText("Nothing to show.")).toBeInTheDocument();
  });
});
