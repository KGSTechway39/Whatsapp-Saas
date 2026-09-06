/**
 * Bulk consent capture.
 *
 *   POST { contactIds: string[], given: boolean, source? } → { updated, failed }
 *
 * Front-desk reality: a clinic collects consent from a queue of people at once
 * (a form on the counter, a batch of intake slips). Making them tick twenty
 * contacts one at a time is how a compliance feature ends up unused — and an
 * unused consent feature means either blocked sends or, worse, staff looking
 * for a way around it.
 *
 * TENANT-SCOPED: runs as the session user, every write carries
 * `.eq("user_id", user.id)`. Ids from the body are attacker-controlled and are
 * never trusted alone (Law #1).
 */
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { setContactConsent } from "@/lib/compliance/consent";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const SOURCES = ["whatsapp_optin", "web_form", "in_person", "phone", "imported"] as const;
/** Ceiling per call — a mis-click must not rewrite a whole contact book. */
const BULK_MAX = 500;

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const contactIds: string[] = Array.isArray(body.contactIds) ? body.contactIds.filter(Boolean) : [];
  if (typeof body.given !== "boolean") {
    return NextResponse.json({ error: "given must be true or false" }, { status: 400 });
  }
  if (contactIds.length === 0) {
    return NextResponse.json({ error: "Select at least one contact." }, { status: 400 });
  }
  if (contactIds.length > BULK_MAX) {
    return NextResponse.json(
      { error: `That's ${contactIds.length} contacts — the limit is ${BULK_MAX} at a time.` },
      { status: 400 },
    );
  }

  const source = SOURCES.includes(body.source) ? body.source : "in_person";

  // Per-contact outcomes rather than all-or-nothing: if 18 of 20 succeed those
  // 18 genuinely have consent recorded, and rolling them back would discard a
  // real compliance record.
  const updated: string[] = [];
  const failed: { id: string; error: string }[] = [];
  for (const id of contactIds) {
    try {
      await setContactConsent(user.id, id, body.given, source);
      updated.push(id);
    } catch (err) {
      failed.push({ id, error: (err as Error).message });
    }
  }

  logger.info("consent: bulk updated", {
    userId: user.id, given: body.given, source, updated: updated.length, failed: failed.length,
  });

  return NextResponse.json({ updated: updated.length, failed });
}
