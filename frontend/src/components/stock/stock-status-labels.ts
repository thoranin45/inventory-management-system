import type { MessageKey } from "@/lib/i18n/translate";
import type { StockStatusKey } from "@/lib/stock-status";

/** Dictionary key of each derived stock status (the wording lives in the dictionaries). */
export function statusLabelKey(key: StockStatusKey | "all"): MessageKey {
  switch (key) {
    case "all":
      return "stock.statusAll";
    case "inactive":
      return "stock.statusInactive";
    case "expired":
      return "stock.statusExpired";
    case "out_of_stock":
      return "stock.statusOutOfStock";
    case "near_expiry":
      return "stock.statusNearExpiry";
    case "low_stock":
      return "stock.statusLowStock";
    case "in_stock":
      return "stock.statusInStock";
  }
}
