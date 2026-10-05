import type { NextRequest } from "next/server";
import { errorResponse, getSellRate, PAYOUT_NETWORK } from "@/lib/paycrest/server";

export async function GET(request: NextRequest) {
  const amount = request.nextUrl.searchParams.get("amount") ?? "";
  if (!/^\d+(\.\d{1,6})?$/.test(amount)) {
    return Response.json({ error: { code: "validation", message: "amount must be a USDC decimal string." } }, { status: 422 });
  }
  try {
    const sell = await getSellRate(amount, "NGN");
    return Response.json({
      rate: sell.rate,
      providerIds: sell.providerIds ?? [],
      payoutNetwork: PAYOUT_NETWORK,
      fetchedAt: Date.now(),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
