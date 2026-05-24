/**
 * GET /api/whatsapp/accounts
 * List WhatsApp accounts connected to the caller's active organization.
 * Tokens are NEVER returned.
 */
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { listForUser } from "@/lib/whatsapp/service";
import { UnauthorizedError, toApiError } from "@/lib/whatsapp/errors";

export async function GET() {
  try {
    const user = await getSessionUser();
    if (!user) throw new UnauthorizedError();

    const accounts = await listForUser(user.id);
    return NextResponse.json({ accounts });
  } catch (err) {
    const { status, body } = toApiError(err);
    return NextResponse.json(body, { status });
  }
}
