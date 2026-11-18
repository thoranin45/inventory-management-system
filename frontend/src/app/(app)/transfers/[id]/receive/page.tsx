import { notFound } from "next/navigation";

import { TransferReceivingConsole } from "@/components/transfers/transfer-receiving-console";
import { pageMetadata } from "@/lib/i18n/server";

export const generateMetadata = () => pageMetadata("pageTitle.transferReceive");

export default async function TransferReceivingPage(props: PageProps<"/transfers/[id]/receive">) {
  const { id } = await props.params;
  const transferId = Number(id);
  if (!Number.isInteger(transferId) || transferId <= 0) notFound();
  return <TransferReceivingConsole transferId={transferId} />;
}
