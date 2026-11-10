import type { LucideIcon } from "lucide-react";
import {
  Ban,
  Circle,
  CircleCheck,
  CircleDashed,
  CircleDot,
  CircleMinus,
  CircleX,
  Clock,
  Info,
  ListChecks,
  Package,
  PackageCheck,
  PencilLine,
  Send,
  TriangleAlert,
  Truck,
} from "lucide-react";

import type { MessageKey } from "@/lib/i18n/translate";

export type Tone = "neutral" | "info" | "accent" | "success" | "warning" | "danger";

/**
 * Canonical backend status values the UI knows (R2.6). Matching is exact on
 * the API value — display text is never parsed. Tones are the pre-R2
 * mappings, unchanged; R2 adds a translated label and an icon (frozen
 * showroom icons where it defines one). Adjustment-request statuses keep the
 * neutral tone they always had.
 */
export const CANONICAL_STATUS = {
  DRAFT: { tone: "neutral", icon: PencilLine, labelKey: "status.DRAFT" },
  CONFIRMED: { tone: "info", icon: CircleCheck, labelKey: "status.CONFIRMED" },
  PICKING: { tone: "info", icon: ListChecks, labelKey: "status.PICKING" },
  PACKING: { tone: "info", icon: Package, labelKey: "status.PACKING" },
  READY_TO_SHIP: { tone: "accent", icon: Send, labelKey: "status.READY_TO_SHIP" },
  IN_TRANSIT: { tone: "accent", icon: Truck, labelKey: "status.IN_TRANSIT" },
  SHIPPED: { tone: "success", icon: Truck, labelKey: "status.SHIPPED" },
  PARTIALLY_RECEIVED: { tone: "warning", icon: CircleDashed, labelKey: "status.PARTIALLY_RECEIVED" },
  RECEIVED: { tone: "success", icon: PackageCheck, labelKey: "status.RECEIVED" },
  COMPLETED: { tone: "success", icon: CircleCheck, labelKey: "status.COMPLETED" },
  CANCELLED: { tone: "danger", icon: Ban, labelKey: "status.CANCELLED" },
  PENDING: { tone: "neutral", icon: Clock, labelKey: "status.PENDING" },
  APPROVED: { tone: "neutral", icon: CircleCheck, labelKey: "status.APPROVED" },
  REJECTED: { tone: "neutral", icon: CircleX, labelKey: "status.REJECTED" },
  active: { tone: "success", icon: CircleCheck, labelKey: "status.active" },
  inactive: { tone: "neutral", icon: CircleMinus, labelKey: "status.inactive" },
} as const satisfies Record<string, { tone: Tone; icon: LucideIcon; labelKey: MessageKey }>;

export type CanonicalStatus = keyof typeof CANONICAL_STATUS;

export function isCanonicalStatus(status: string): status is CanonicalStatus {
  return Object.prototype.hasOwnProperty.call(CANONICAL_STATUS, status);
}

/** Icon for a caller-supplied tone (custom labels such as "Attention"). */
export const TONE_ICON: Record<Tone, LucideIcon> = {
  neutral: Circle,
  info: Info,
  accent: CircleDot,
  success: CircleCheck,
  warning: TriangleAlert,
  danger: CircleX,
};

/** Unknown value: shown as-is (humanized), neutral; never guessed from text. */
export function humanizeStatus(status: string): string {
  return status.replace(/_/g, " ").toLowerCase();
}
