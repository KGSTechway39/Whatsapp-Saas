/**
 * GET /api/verticals/me — the signed-in client's own industry suggestions.
 *
 *   ?kind=FLOW_JSON | CAMPAIGN_PROMPT | MESSAGE_TEMPLATE   (optional filter)
 *
 * Returns `{ vertical: null, ... }` with empty lists when the client has no
 * industry set. That is a normal, fully supported state — every caller renders
 * nothing extra and the page works exactly as it does today.
 *
 * Client-facing, so the response deliberately omits `adminNote` (admin-only
 * guidance) and never ships raw flow structure to the browser: a flow is
 * described by its first message and how many messages it sends.
 */
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getVerticalForUser, getVerticalWithLibrary } from "@/lib/verticals/repository";
import { firstMessageOf, flowStepCount } from "@/lib/verticals/preview";
import { VERTICAL_TEMPLATE_KINDS, type VerticalTemplateKind } from "@/lib/verticals/types";

const EMPTY = { vertical: null, flows: [], campaignPrompts: [], messageTemplates: [] };

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const vertical = await getVerticalForUser(user.id);
  if (!vertical) return NextResponse.json(EMPTY);

  const data = await getVerticalWithLibrary(vertical.id);
  if (!data) return NextResponse.json(EMPTY);

  const kindParam = req.nextUrl.searchParams.get("kind");
  const kind = VERTICAL_TEMPLATE_KINDS.includes(kindParam as VerticalTemplateKind)
    ? (kindParam as VerticalTemplateKind)
    : null;
  const wants = (k: VerticalTemplateKind) => !kind || kind === k;

  return NextResponse.json({
    vertical: { id: vertical.id, slug: vertical.slug, displayName: vertical.displayName, icon: vertical.icon },

    flows: wants("FLOW_JSON")
      ? data.flows.map((f) => ({
          id: f.id,
          title: f.title,
          description: f.description,
          outcome: f.outcome,
          firstMessage: firstMessageOf(f.payload.flow),
          /** >1 means the client should know only the first message sends today. */
          steps: flowStepCount(f.payload.flow),
          collectsBooking: Boolean(f.payload.bookingContext),
        }))
      : [],

    campaignPrompts: wants("CAMPAIGN_PROMPT")
      ? data.campaignPrompts.map((p) => ({
          id: p.id,
          title: p.title,
          description: p.description,
          outcome: p.outcome,
          /** Tapping a chip pre-fills this into the input; the client edits before generating. */
          prompt: p.payload.prompt,
        }))
      : [],

    messageTemplates: wants("MESSAGE_TEMPLATE")
      ? data.messageTemplates.map((t) => ({
          id: t.id,
          title: t.title,
          description: t.description,
          outcome: t.outcome,
          metaCategory: t.metaCategory,
          body: t.payload.body,
          footer: t.payload.footer ?? null,
          variableNames: t.payload.variableNames,
        }))
      : [],
  });
}
