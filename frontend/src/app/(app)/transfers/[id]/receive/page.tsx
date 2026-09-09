import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { TransferReceivingConsole } from "@/components/transfers/transfer-receiving-console";

export const metadata: Metadata = { title: "Transfer receiving · Warehouse Console" };

export default async function TransferReceivingPage(props: PageProps<"/transfers/[id]/receive">) {
  const { id } = await props.params;
  const transferId = Number(id);
  if (!Number.isInteger(transferId) || transferId <= 0) notFound();
  return <TransferReceivingConsole transferId={transferId} />;
}
