import { errorResponse, verifyAccount } from "@/lib/paycrest/server";

export async function POST(request: Request) {
  let body: { institution?: unknown; accountIdentifier?: unknown };
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const { institution, accountIdentifier } = body;
  if (typeof institution !== "string" || typeof accountIdentifier !== "string" || !/^\d{10}$/.test(accountIdentifier)) {
    return Response.json(
      { error: { code: "validation", message: "Enter a 10-digit NUBAN account number." } },
      { status: 422 },
    );
  }
  try {
    return Response.json({ accountName: await verifyAccount(institution, accountIdentifier) });
  } catch (error) {
    return errorResponse(error);
  }
}
