import type { Metadata } from "next";
import { IntentTracker } from "./intent-tracker";

export const metadata: Metadata = {
  title: "Cash-out status — MELO",
};

export default async function IntentPage({ params }: PageProps<"/intent/[id]">) {
  const { id } = await params;
  return <IntentTracker id={id} />;
}
