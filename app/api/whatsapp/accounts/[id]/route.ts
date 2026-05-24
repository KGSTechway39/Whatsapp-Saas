/**
 * DELETE /api/whatsapp/accounts/:id
 * Soft-disconnects an account: marks status='disconnected' and clears the
 * encrypted token. History (campaigns, messages) is preserved.
 */
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { disconnectForUser } from "@/lib/whatsapp/service";
import { UnauthorizedError, toApiError } from "@/lib/whatsapp/errors";
import { logger } from "@/lib/logger";

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await getSessionUser();
    if (!user) throw new UnauthorizedError();

    await disconnectForUser(user.id, params.id);

    logger.info("WhatsApp account disconnected", { userId: user.id, accountId: params.id });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const { status, body } = toApiError(err);
    return NextResponse.json(body, { status });
  }
}
