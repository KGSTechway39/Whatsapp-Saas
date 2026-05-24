import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const TONE_HINTS: Record<string, string> = {
  friendly:     "warm, conversational, uses emojis appropriately",
  professional: "formal, polished, no emojis, business-like",
  urgent:       "time-sensitive language, creates FOMO, clear deadlines",
  festive:      "celebratory, joyful, uses relevant festival emojis",
};

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "AI not configured. Set ANTHROPIC_API_KEY." }, { status: 503 });
  }

  const { description, category = "MARKETING", tone = "friendly", language = "en" } = await req.json();
  if (!description?.trim()) {
    return NextResponse.json({ error: "Description is required" }, { status: 400 });
  }

  const langNames: Record<string, string> = {
    en: "English", en_IN: "Indian English", hi: "Hindi", ta: "Tamil",
    te: "Telugu", mr: "Marathi", bn: "Bengali", kn: "Kannada",
  };
  const langName = langNames[language] || "English";
  const toneHint = TONE_HINTS[tone] || TONE_HINTS.friendly;

  const systemPrompt = `You are an expert WhatsApp Business template writer for Indian businesses.
You write templates that pass Meta's approval process.

Rules you MUST follow:
- Use {{1}}, {{2}}, {{3}}… for dynamic variables (customer name, order ID, etc.)
- Meta WhatsApp template body: max 1024 characters
- MARKETING: can be promotional, use emojis, must have value proposition
- UTILITY: transactional only (order updates, appointments, OTPs) — no promotional language
- AUTHENTICATION: OTP/verification codes only
- No URL shorteners, no misleading claims, no all-caps spam
- Language: ${langName}
- Tone: ${toneHint}

Output ONLY valid JSON — no markdown, no explanation, just JSON.`;

  const userPrompt = `Create 3 WhatsApp ${category} template variations for: "${description}"

Return this exact JSON structure:
{
  "templates": [
    {
      "displayName": "Short human-readable name (max 50 chars)",
      "name": "snake_case_id_max_30_chars",
      "body": "The template body text with {{1}} {{2}} variables",
      "footer": "Optional footer text or empty string",
      "variableNames": ["Name for {{1}}", "Name for {{2}}"],
      "whyItWorks": "One sentence explaining why this variation works"
    }
  ]
}

Make each variation meaningfully different:
- Variation 1: concise and direct
- Variation 2: more detailed with context
- Variation 3: ${tone === "urgent" ? "maximum urgency angle" : "emotionally engaging angle"}`;

  try {
    const msg = await client.messages.create({
      model:      "claude-sonnet-4-6",
      max_tokens: 1500,
      system:     systemPrompt,
      messages:   [{ role: "user", content: userPrompt }],
    });

    const raw = (msg.content[0] as { type: string; text: string }).text ?? "";

    // Parse JSON robustly
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("Invalid AI response format");

    const parsed = JSON.parse(jsonMatch[0]) as {
      templates: {
        displayName: string;
        name: string;
        body: string;
        footer: string;
        variableNames: string[];
        whyItWorks: string;
      }[];
    };

    // Normalize
    const templates = parsed.templates.map((t) => ({
      displayName:   (t.displayName || "").slice(0, 50),
      name:          (t.name || "").toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 30),
      body:          (t.body || "").slice(0, 1024),
      footer:        (t.footer || "").slice(0, 200),
      variableNames: Array.isArray(t.variableNames) ? t.variableNames : [],
      whyItWorks:    t.whyItWorks || "",
      category,
      language,
    }));

    return NextResponse.json({ templates });
  } catch (err) {
    const message = err instanceof Error ? err.message : "AI generation failed";
    console.error("Template generate error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
