import { notFound } from "next/navigation";

import { FulfillmentConsole } from "@/components/work/fulfillment-console";
import { pageMetadata } from "@/lib/i18n/server";

export const generateMetadata = () => pageMetadata("pageTitle.pickConsole");

export default async function PickConsolePage(props: PageProps<"/picking/[id]">) {
  const { id } = await props.params;
  const orderId = Number(id);
  if (!Number.isInteger(orderId) || orderId <= 0) notFound();
  return <FulfillmentConsole orderId={orderId} mode="pick" />;
}
