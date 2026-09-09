import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ReceivingConsole } from "@/components/purchase-orders/receiving-console";

export const metadata: Metadata = { title: "Receiving · Warehouse Console" };

export default async function ReceivingPage(props: PageProps<"/purchase-orders/[id]/receive">) {
  const { id } = await props.params;
  const poId = Number(id);
  if (!Number.isInteger(poId) || poId <= 0) notFound();
  return <ReceivingConsole poId={poId} />;
}
