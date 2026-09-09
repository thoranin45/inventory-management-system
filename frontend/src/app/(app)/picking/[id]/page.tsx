import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { FulfillmentConsole } from "@/components/work/fulfillment-console";

export const metadata: Metadata = { title: "Pick console · Warehouse Console" };

export default async function PickConsolePage(props: PageProps<"/picking/[id]">) {
  const { id } = await props.params;
  const orderId = Number(id);
  if (!Number.isInteger(orderId) || orderId <= 0) notFound();
  return <FulfillmentConsole orderId={orderId} mode="pick" />;
}
