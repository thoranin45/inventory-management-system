import Image from "next/image";

import { cn } from "@/lib/utils";

import akMark from "../../../public/brand/akkrathara-logo.png";

/**
 * The single source of the AKKRATHARA brand lockup. Login and the app shell
 * both render this so there is one place to change the mark or wordmark.
 *
 * The supplied logo has a baked dark background — it is used verbatim (a
 * transparent/optimised variant is a separate future task), shown inside a
 * rounded tile so it reads on both the light and dark app themes.
 */
export function BrandMark({
  variant = "full",
  className,
}: {
  /** "full" = mark + AKKRATHARA wordmark · "compact" = mark only */
  variant?: "full" | "compact";
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-[9px]", className)}>
      <span className="grid flex-none place-items-center overflow-hidden rounded-[var(--r-sm)]">
        <Image
          src={akMark}
          alt="AKKRATHARA"
          width={26}
          height={26}
          priority
          className="h-[26px] w-[26px] object-cover"
        />
      </span>
      {variant === "full" ? (
        <span className="text-[15px] font-semibold tracking-[0.02em]">AKKRATHARA</span>
      ) : null}
    </span>
  );
}
