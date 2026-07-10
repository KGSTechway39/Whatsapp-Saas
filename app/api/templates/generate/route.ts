import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getUserTier } from "@/lib/ai/config";
import { runTask } from "@/lib/ai/service";

// Governed via AIProviderService (task: template_content) — model/provider come
// from ai_model_config, and every call is usage-logged. This replaces the former
// direct, hardcoded @anthropic-ai/sdk call so there is one governed AI path.

const TONE_HINTS: Record<string, string> = {
  friendly:     "warm, conversational, uses emojis appropriately",
  professional: "formal, polished, no emojis, business-like",
  urgent:       "time-sensitive language, creates FOMO, clear deadlines",
  festive:      "celebratory, joyful, uses relevant festival emojis",
};

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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

  interface GenTemplate {
    displayName: string;
    name: string;
    body: string;
    footer: string;
    variableNames: string[];
    whyItWorks: string;
    category: string;
    language: string;
  }

  const parse = (raw: string): GenTemplate[] => {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("Invalid AI response format");
    const parsed = JSON.parse(jsonMatch[0]) as {
      templates: Omit<GenTemplate, "category" | "language">[];
    };
    if (!Array.isArray(parsed.templates)) throw new Error("No templates in AI response");
    return parsed.templates.map((t) => ({
      displayName:   (t.displayName || "").slice(0, 50),
      name:          (t.name || "").toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 30),
      body:          (t.body || "").slice(0, 1024),
      footer:        (t.footer || "").slice(0, 200),
      variableNames: Array.isArray(t.variableNames) ? t.variableNames : [],
      whyItWorks:    t.whyItWorks || "",
      category,
      language,
    }));
  };

  const tier = await getUserTier(user.id);
  const result = await runTask<GenTemplate[]>({
    userId:         user.id,
    tier,
    taskType:       "template_content",
    system:         systemPrompt,
    prompt:         userPrompt,
    maxTokens:      1500,
    idempotencyKey: `tmpl:${user.id}:${Date.now()}`, // each generation is its own action
    parse,
  });

  if (result.status === "fallback") {
    // Template generation has no manual fallback UI; surface as unavailable.
    return NextResponse.json({ error: result.message }, { status: 503 });
  }
  return NextResponse.json({ templates: result.data });
}
