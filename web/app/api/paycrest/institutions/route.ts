import { errorResponse, getInstitutions } from "@/lib/paycrest/server";

export async function GET() {
  try {
    const institutions = await getInstitutions("NGN");
    const banks = institutions
      .map(({ code, name }) => ({ code, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return Response.json({ banks });
  } catch (error) {
    return errorResponse(error);
  }
}
