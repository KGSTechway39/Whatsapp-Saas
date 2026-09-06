/**
 * REMOVED — this route called `GET /{waba_id}/template_library`, which is not a
 * real Graph endpoint. Meta answers:
 *     "Unknown path components: /template_library"
 * Every call failed and the route silently returned FALLBACK_LIBRARY — ten
 * hardcoded templates presented as Meta's own. They could never be added to a
 * WABA, so the panel looked functional and was not.
 *
 * Meta hands out no ready-made templates. Every template is created by the
 * business and reviewed by Meta. The honest replacement is
 * /api/templates/starters, which creates real templates through
 * `POST /{waba_id}/message_templates`.
 *
 * Kept as a 410 rather than deleted so any client still calling it gets a clear
 * answer instead of a 404 that reads like a deploy problem.
 */
import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json(
    {
      error:
        "Meta has no template library to browse. Use starter templates instead — they create real templates on your WhatsApp account.",
      code: "GONE_USE_STARTERS",
      replacement: "/api/templates/starters",
      templates: [],
    },
    { status: 410 },
  );
}
