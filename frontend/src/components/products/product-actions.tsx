"use client";

import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { canShowAction, type Role } from "@/lib/auth/permissions";

/**
 * Header affordance for the Products screen. Only admins see it; the backend
 * still enforces `require_admin` on `POST /products`. Edit / deactivate /
 * image / codes all live in the product detail drawer.
 */
export function ProductActions({ role, onNew }: { role: Role; onNew: () => void }) {
  if (!canShowAction(role, "product:create")) return null;
  return (
    <Button variant="primary" onClick={onNew}>
      <Plus aria-hidden className="h-4 w-4" />
      New product
    </Button>
  );
}
