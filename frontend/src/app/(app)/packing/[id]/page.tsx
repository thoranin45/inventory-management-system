import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { FulfillmentConsole } from "@/components/work/fulfillment-console";

export const metadata: Metadata = { title: "Pack console · Warehouse Console" };

export default async function PackConsolePage(props: PageProps<"/packing/[id]">) {
  const { id } = await props.params;
  const orderId = Number(id);
  if (!Number.isInteger(orderId) || orderId <= 0) notFound();
  return <FulfillmentConsole orderId={orderId} mode="pack" />;
}
