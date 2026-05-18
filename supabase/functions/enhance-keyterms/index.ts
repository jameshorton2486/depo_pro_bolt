import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Anthropic from "npm:@anthropic-ai/sdk@0.30.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const SYSTEM_PROMPT = `You are an expert legal document parser and ASR vocabulary specialist.
Your only job is to analyze legal deposition documents and produce a JSON payload for Deepgram's custom vocabulary (keywords) API.

Output rules:
- Output ONLY a valid JSON object with a single "keywords" array. No prose, no markdown fences, no explanation.
- Each element is a string in one of these formats:
    1. Plain term:            "Term"
    2. Boosted term:          "Term:2"  or  "Term:3"  (use :3 for unusual spellings/rare surnames)
    3. Phonetic mapping:      "spoken form -> Written Form"  (for terms a standard ASR model would mispronounce)

Extraction priority:
1. Full names of deponents, witnesses, attorneys, paralegals — boost :2
2. Law firm / company / entity names — boost :2
3. Geographic specifics (street names, unusual city/county names) — boost :1
4. Case-specific medical, technical, or legal jargon — boost :2
5. Phonetically complex proper nouns → add a sounds-like mapping entry IN ADDITION to the plain entry
6. Product names, brand names, drug names — boost :2

DO NOT extract:
- Generic legal words (plaintiff, defendant, deposition, objection, court, etc.)
- Common English words
- Numbers, dates, cause numbers

For phonetic mappings, use common English pronunciation spelling for the spoken form.
Example: "cook-yah-tee -> Cukjati"

Output only the JSON object.`;

interface EnhanceRequest {
  documentText: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthropicKey) {
      return new Response(
        JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { documentText }: EnhanceRequest = await req.json();
    if (!documentText?.trim()) {
      return new Response(
        JSON.stringify({ error: "documentText is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Truncate to ~12k chars to stay within context limits for this task
    const truncated = documentText.slice(0, 12000);

    const client = new Anthropic({ apiKey: anthropicKey });

    const message = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Extract custom vocabulary from this legal document:\n\n${truncated}`,
        },
      ],
    });

    // Extract text content from response
    const rawText = message.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("");

    // Parse the JSON — strip any accidental markdown fences
    const cleaned = rawText
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/, "")
      .trim();

    let parsed: { keywords: string[] };
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return new Response(
        JSON.stringify({ error: "AI returned malformed JSON", raw: rawText.slice(0, 500) }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!Array.isArray(parsed?.keywords)) {
      return new Response(
        JSON.stringify({ error: "AI response missing keywords array", raw: rawText.slice(0, 500) }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Sanitize — reject anything that looks like a prompt injection attempt
    const safeKeywords = parsed.keywords
      .filter((k) => typeof k === "string" && k.length > 0 && k.length < 120)
      .map((k) => k.trim());

    return new Response(
      JSON.stringify({ keywords: safeKeywords }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("enhance-keyterms error:", err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
