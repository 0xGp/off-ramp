import type { Metadata } from "next";
import { IntentReceipt } from "./intent-receipt";

export const metadata: Metadata = {
  title: "Receipt — MELO",
};

export default async function ReceiptPage({ params }: PageProps<"/intent/[id]/receipt">) {
  const { id } = await params;
  return <IntentReceipt id={id} />;
}
