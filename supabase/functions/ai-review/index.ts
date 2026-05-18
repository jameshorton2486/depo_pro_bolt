import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk@0.32.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ReviewRequest {
  jobId: string;
  utteranceIds?: string[];   // if omitted, reviews entire job
  runId?: string;            // optional caller-supplied run UUID
}

interface UtteranceRow {
  id: string;
  job_id: string;
  speaker_id: number;
  start_time: number;
  end_time: number;
  transcript: string;
  corrected_transcript: string | null;
  confidence: number;
  sequence_index: number;
}

interface AiSuggestion {
  utterance_id: string;
  job_id: string;
  source_text: string;
  suggested_text: string;
  category: string;
  reason: string;
  confidence: number;
  has_change: boolean;
  model_used: string;
  review_run_id: string;
  review_status: "pending";
}

// ---------------------------------------------------------------------------
// System prompt — the non-negotiable safety boundary for the model
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a LEGAL DEPOSITION TRANSCRIPT REVIEW ASSISTANT for Depo-Pro Transcribe.

CRITICAL LEGAL REQUIREMENT: This is an official court record. Your role is REVIEW ASSISTANCE ONLY.

YOU MUST:
- Preserve every spoken word verbatim
- Preserve all disfluencies (uh, um, you know, like, well)
- Preserve all stutters and false starts (I -- I, he -- she said)
- Preserve all hesitations and trailing thoughts
- Preserve filler words exactly as transcribed
- Preserve interruptions with double-hyphen format: word --
- Preserve ellipsis for trailing thoughts: word...
- Preserve colloquial speech forms (gonna, wanna, kinda) — these are the ACTUAL WORDS SPOKEN
- Preserve legal meaning without alteration
- Only suggest PUNCTUATION changes (commas, periods, question marks, dashes, ellipses)
- Only flag probable speech-to-text recognition errors with low confidence
- Only flag probable speaker diarization mistakes
- Only suggest capitalization fixes for proper nouns that appear misspelled

YOU MUST NEVER:
- Remove any word from the transcript
- Add any word not present in the source
- Rewrite, paraphrase, or rephrase testimony
- Smooth grammar or improve readability
- Remove filler words or hesitation speech
- Summarize or condense answers
- Merge separate sentences
- "Clean up" witness speech
- Infer what the speaker meant to say
- Change verb tenses, subject/object, or sentence structure
- Add words even if the sentence seems grammatically incomplete

RESPONSE FORMAT:
Return a JSON array. Each element is a suggestion object for ONE utterance.
If an utterance needs no changes, still include it with has_change: false.

{
  "utterance_id": "<id from input>",
  "suggested_text": "<text — IDENTICAL to source if no change>",
  "category": "<one of: punctuation | sentence_boundary | speaker_drift | proper_noun | interruption | low_confidence | fragment | review_required>",
  "reason": "<one sentence explaining why — or 'No changes needed' if has_change is false>",
  "confidence": <0.0 to 1.0 — your confidence that this suggestion is correct>,
  "has_change": <true if suggested_text differs from source, false otherwise>
}

CATEGORY DEFINITIONS:
- punctuation: Adding/fixing commas, periods, question marks, dashes, ellipses — NO word changes
- sentence_boundary: Identifying where a run-on segment should be split — suggest split point with | marker
- speaker_drift: Utterance may belong to a different speaker than labeled
- proper_noun: A word appears to be a misspelled proper noun, legal entity, or medical term
- interruption: Probable interruption or overlap not properly marked with --
- low_confidence: Word or phrase appears to be a speech recognition error given context
- fragment: Utterance appears to be an incomplete fragment (not a problem, just flagged)
- review_required: Ambiguous situation that requires human judgment

IMPORTANT: The suggested_text must contain ONLY the spoken words — no Q./A. labels, no speaker names.
Those are added by the formatting layer, not by you.`;

// ---------------------------------------------------------------------------
// Build the per-batch user prompt
// ---------------------------------------------------------------------------

function buildUserPrompt(
  batch: UtteranceRow[],
  prevContext: UtteranceRow[],
  nextContext: UtteranceRow[],
  speakerMap: Record<number, string>,
): string {
  const formatUtterance = (u: UtteranceRow, label: string) => {
    const speaker = speakerMap[u.speaker_id] ?? `Speaker ${u.speaker_id}`;
    const text = u.corrected_transcript ?? u.transcript;
    const confPct = Math.round(u.confidence * 100);
    return `[${label}] id="${u.id}" speaker="${speaker}" t=${u.start_time.toFixed(1)}-${u.end_time.toFixed(1)}s conf=${confPct}%\n${text}`;
  };

  const parts: string[] = [];

  if (prevContext.length > 0) {
    parts.push("=== PRECEDING CONTEXT (do not suggest changes) ===");
    for (const u of prevContext) parts.push(formatUtterance(u, "CONTEXT"));
  }

  parts.push("=== UTTERANCES TO REVIEW ===");
  for (const u of batch) parts.push(formatUtterance(u, "REVIEW"));

  if (nextContext.length > 0) {
    parts.push("=== FOLLOWING CONTEXT (do not suggest changes) ===");
    for (const u of nextContext) parts.push(formatUtterance(u, "CONTEXT"));
  }

  parts.push('\nReturn a JSON array with one suggestion object per REVIEW utterance.');
  return parts.join('\n\n');
}

// ---------------------------------------------------------------------------
// Parse Claude's JSON response safely
// ---------------------------------------------------------------------------

interface ClaudeRawSuggestion {
  utterance_id?: string;
  suggested_text?: string;
  category?: string;
  reason?: string;
  confidence?: number;
  has_change?: boolean;
}

function parseSuggestions(raw: string, batchIds: string[]): ClaudeRawSuggestion[] {
  try {
    // Extract JSON array from response (model sometimes wraps in markdown)
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];
    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter((s: ClaudeRawSuggestion) =>
      typeof s === "object" &&
      s !== null &&
      typeof s.utterance_id === "string" &&
      batchIds.includes(s.utterance_id)
    );
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Safety validator — last-line check before persisting any suggestion
// ---------------------------------------------------------------------------

function validateSuggestion(
  source: string,
  suggested: string,
): { safe: boolean; reason: string } {
  if (suggested === source) return { safe: true, reason: "no change" };

  const sourceWords = source.trim().split(/\s+/);
  const suggestedWords = suggested.trim().split(/\s+/);

  // Strip punctuation for word comparison
  const clean = (w: string) => w.replace(/[^a-zA-Z0-9'-]/g, "").toLowerCase();
  const sourceClean = sourceWords.map(clean).filter(Boolean);
  const suggestedClean = suggestedWords.map(clean).filter(Boolean);

  // Hard fail: words removed
  for (const w of sourceClean) {
    if (!suggestedClean.includes(w)) {
      return { safe: false, reason: `Word removed: "${w}"` };
    }
  }

  // Hard fail: words added
  for (const w of suggestedClean) {
    if (!sourceClean.includes(w)) {
      return { safe: false, reason: `Word added: "${w}"` };
    }
  }

  // Hard fail: word count changed by more than 1 (to catch reordering)
  if (Math.abs(sourceClean.length - suggestedClean.length) > 1) {
    return {
      safe: false,
      reason: `Word count changed: ${sourceClean.length} → ${suggestedClean.length}`,
    };
  }

  return { safe: true, reason: "punctuation/capitalization only" };
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anthropicApiKey = Deno.env.get("ANTHROPIC_API_KEY");

    if (!anthropicApiKey) {
      return new Response(
        JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const anthropic = new Anthropic({ apiKey: anthropicApiKey });

    const { jobId, utteranceIds, runId }: ReviewRequest = await req.json();

    if (!jobId) {
      return new Response(
        JSON.stringify({ error: "jobId is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const reviewRunId = runId ?? crypto.randomUUID();

    // ── Load utterances ──────────────────────────────────────────────────────
    let utteranceQuery = supabase
      .from("utterances")
      .select("id, job_id, speaker_id, start_time, end_time, transcript, corrected_transcript, confidence, sequence_index")
      .eq("job_id", jobId)
      .order("sequence_index");

    if (utteranceIds && utteranceIds.length > 0) {
      utteranceQuery = utteranceQuery.in("id", utteranceIds);
    }

    const { data: allUtterances, error: uttErr } = await utteranceQuery;
    if (uttErr || !allUtterances || allUtterances.length === 0) {
      return new Response(
        JSON.stringify({ error: `Failed to load utterances: ${uttErr?.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Load speaker mappings ────────────────────────────────────────────────
    const { data: speakerData } = await supabase
      .from("speaker_mappings")
      .select("speaker_id, mapped_name")
      .eq("job_id", jobId);

    const speakerMap: Record<number, string> = {};
    for (const s of speakerData ?? []) {
      speakerMap[s.speaker_id] = s.mapped_name;
    }

    // Mark utterances as pending
    await supabase
      .from("utterances")
      .update({ ai_review_state: "pending" })
      .in("id", allUtterances.map((u: UtteranceRow) => u.id));

    // ── Process in batches of 8 with 2-utterance context windows ─────────────
    const BATCH_SIZE = 8;
    const CONTEXT_SIZE = 2;
    const suggestions: AiSuggestion[] = [];
    const failedUtteranceIds: string[] = [];

    // Build batch index array upfront for parallel processing
    const batchStarts: number[] = [];
    for (let i = 0; i < allUtterances.length; i += BATCH_SIZE) batchStarts.push(i);

    // Process all batches concurrently — each is a separate Claude call with its
    // own context window, so there are no inter-batch data dependencies.
    const batchResults = await Promise.all(
      batchStarts.map(async (i) => {
        const batch = allUtterances.slice(i, i + BATCH_SIZE) as UtteranceRow[];
        const prevCtx = allUtterances.slice(Math.max(0, i - CONTEXT_SIZE), i) as UtteranceRow[];
        const nextCtx = allUtterances.slice(i + BATCH_SIZE, i + BATCH_SIZE + CONTEXT_SIZE) as UtteranceRow[];
        const batchIds = batch.map((u: UtteranceRow) => u.id);
        try {
          const userPrompt = buildUserPrompt(batch, prevCtx, nextCtx, speakerMap);
          const message = await anthropic.messages.create({
            model: "claude-sonnet-4-6",
            max_tokens: 4096,
            system: SYSTEM_PROMPT,
            messages: [{ role: "user", content: userPrompt }],
          });
          const rawText = message.content
            .filter((b) => b.type === "text")
            .map((b) => (b as { type: "text"; text: string }).text)
            .join("");
          return { batch, batchIds, parsed: parseSuggestions(rawText, batchIds), failed: false };
        } catch (batchErr) {
          console.error(`Batch ${i}–${i + BATCH_SIZE} failed:`, batchErr);
          return { batch, batchIds, parsed: [], failed: true };
        }
      })
    );

    // Collect results maintaining utterance order
    const ALLOWED_CATEGORIES = new Set([
      "punctuation", "sentence_boundary", "speaker_drift", "proper_noun",
      "interruption", "low_confidence", "fragment", "review_required",
    ]);

    for (const { batch, parsed, failed } of batchResults) {
      if (failed) {
        for (const u of batch) failedUtteranceIds.push(u.id);
        continue;
      }

      for (const u of batch) {
        const raw = parsed.find((s) => s.utterance_id === u.id);
        const sourceText = u.corrected_transcript ?? u.transcript;

        if (!raw || !raw.suggested_text) {
          suggestions.push({
            utterance_id: u.id, job_id: jobId,
            source_text: sourceText, suggested_text: sourceText,
            category: "review_required",
            reason: "AI did not return a suggestion for this utterance",
            confidence: 0.0, has_change: false,
            model_used: "claude-sonnet-4-6",
            review_run_id: reviewRunId, review_status: "pending",
          });
          continue;
        }

        const suggestedText = raw.suggested_text.trim();
        const validation = validateSuggestion(sourceText, suggestedText);

        if (!validation.safe) {
          suggestions.push({
            utterance_id: u.id, job_id: jobId,
            source_text: sourceText, suggested_text: sourceText,
            category: "review_required",
            reason: `Safety check blocked: ${validation.reason}`,
            confidence: 0.0, has_change: false,
            model_used: "claude-sonnet-4-6",
            review_run_id: reviewRunId, review_status: "pending",
          });
          continue;
        }

        const hasChange = suggestedText !== sourceText;
        const category = ALLOWED_CATEGORIES.has(raw.category ?? "")
          ? (raw.category as string)
          : "review_required";

        suggestions.push({
          utterance_id: u.id, job_id: jobId,
          source_text: sourceText,
          suggested_text: hasChange ? suggestedText : sourceText,
          category,
          reason: raw.reason ?? "No reason provided",
          confidence: Math.min(1.0, Math.max(0.0, raw.confidence ?? 0.5)),
          has_change: hasChange,
          model_used: "claude-sonnet-4-6",
          review_run_id: reviewRunId, review_status: "pending",
        });
      }
    }

    // ── Persist suggestions + update utterance states in parallel ────────────
    const withSuggestions = suggestions.filter((s) => s.has_change).map((s) => s.utterance_id);
    const withoutSuggestions = suggestions.filter((s) => !s.has_change).map((s) => s.utterance_id);

    const chunks: AiSuggestion[][] = [];
    for (let i = 0; i < suggestions.length; i += 50) chunks.push(suggestions.slice(i, i + 50));

    await Promise.all([
      // Parallel chunk inserts
      ...chunks.map((chunk) =>
        supabase.from("ai_suggestions").insert(chunk).then(({ error }) => {
          if (error) console.error("Insert error:", error);
        })
      ),
      // Bulk utterance state updates — one call per state value
      withSuggestions.length > 0
        ? supabase.from("utterances").update({ ai_review_state: "has_suggestion" }).in("id", withSuggestions)
        : Promise.resolve(),
      withoutSuggestions.length > 0
        ? supabase.from("utterances").update({ ai_review_state: "skipped" }).in("id", withoutSuggestions)
        : Promise.resolve(),
      failedUtteranceIds.length > 0
        ? supabase.from("utterances").update({ ai_review_state: "not_reviewed" }).in("id", failedUtteranceIds)
        : Promise.resolve(),
      // Job metadata — only last_ai_review_at (ai_review_run_count requires a DB function)
      supabase.from("transcription_jobs")
        .update({ last_ai_review_at: new Date().toISOString() })
        .eq("id", jobId),
    ]);

    const suggestionCount = suggestions.filter((s) => s.has_change).length;

    return new Response(
      JSON.stringify({
        success: true,
        reviewRunId,
        totalReviewed: suggestions.length,
        suggestionsWithChanges: suggestionCount,
        failedCount: failedUtteranceIds.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("ai-review error:", err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
