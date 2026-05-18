// transcribe-audio — two responsibilities:
//
// 1. Token broker: mints a short-lived Deepgram API key so the browser can POST
//    audio bytes directly to Deepgram without the raw API key ever reaching the client.
//
// 2. Job prep: creates the transcript_parts rows and updates the job to processing
//    state before returning the token, so the callback has rows to write into.
//
// The browser then:
//   a. POSTs compressed audio directly to Deepgram (one hop, no storage intermediary)
//   b. Deepgram calls back to transcribe-callback when done
//   c. Browser archives the compressed file to storage in the background (not on critical path)

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { signCallbackToken } from "../_shared/hmac.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DeepgramOptions {
  smart_format: boolean;
  diarize: boolean;
  punctuate: boolean;
  paragraphs: boolean;
  utterances: boolean;
  filler_words: boolean;
  numerals: boolean;
  utt_split: number;
  keyterms: string[];
}

interface PrepareRequest {
  jobId: string;
  partsCount: number;        // how many files the browser is about to upload
  model: string;
  deepgramOptions?: Partial<DeepgramOptions>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_OPTIONS: DeepgramOptions = {
  smart_format: true,
  diarize: true,
  punctuate: true,
  paragraphs: false,
  utterances: true,
  filler_words: true,
  numerals: true,
  utt_split: 0.8,
  keyterms: [],
};

const ALLOWED_MODELS = ["nova-3", "nova-3-medical", "nova-2", "nova-2-medical"];

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function whitelistModel(model: string): string {
  return ALLOWED_MODELS.includes(model) ? model : "nova-3";
}

function buildDeepgramUrl(model: string, opts: DeepgramOptions): string {
  const params = new URLSearchParams();
  params.set("model", model);
  params.set("language", "en-US");
  if (opts.smart_format) params.set("smart_format", "true");
  if (opts.diarize) params.set("diarize", "true");
  if (opts.punctuate) params.set("punctuate", "true");
  if (opts.utterances) params.set("utterances", "true");
  if (opts.filler_words) params.set("filler_words", "true");
  if (opts.numerals) params.set("numerals", "true");
  if (typeof opts.utt_split === "number" && opts.utt_split > 0) {
    params.set("utt_split", String(opts.utt_split));
  }
  if (Array.isArray(opts.keyterms) && opts.keyterms.length > 0) {
    const paramName = model.startsWith("nova-3") ? "keyterm" : "keywords";
    for (const rawTerm of opts.keyterms) {
      const term = rawTerm.trim();
      if (!term) continue;
      // Phonetic mappings ("spoken -> written") are post-processing only — Deepgram has no such concept
      if (term.includes(" -> ")) continue;
      if (paramName === "keyterm") {
        // Nova-3 keyterm has no boost notation; strip any ":N" suffix from AI-generated terms
        const stripped = term.replace(/:\d+(\.\d+)?$/, "").trim();
        if (stripped) params.append("keyterm", stripped);
      } else {
        // Nova-2 keywords: boost notation ":N" is valid, pass through as-is
        params.append("keywords", term);
      }
    }
  }
  return `https://api.deepgram.com/v1/listen?${params.toString()}`;
}

function summarizeOptions(opts: DeepgramOptions): string {
  return [
    opts.smart_format && "smart_format",
    opts.diarize && "diarize",
    opts.punctuate && "punctuate",
    opts.utterances && "utterances",
    opts.filler_words && "filler_words",
    opts.numerals && "numerals",
    opts.keyterms.length > 0 && `keyterms(${opts.keyterms.length})`,
  ].filter(Boolean).join(", ");
}

async function failJob(
  supabase: ReturnType<typeof createClient>,
  jobId: string,
  message: string,
): Promise<Response> {
  console.error(`[PREP] Job ${jobId} failed: ${message}`);
  await supabase.from("transcription_jobs").update({
    status: "failed",
    error_message: message,
    phase: "Failed",
  }).eq("id", jobId);
  return new Response(
    JSON.stringify({ error: message }),
    { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const deepgramApiKey = Deno.env.get("DEEPGRAM_API_KEY");
    const callbackSecret = Deno.env.get("DEEPGRAM_CALLBACK_SECRET");

    if (!supabaseUrl || !serviceKey) {
      return new Response(JSON.stringify({ error: "Server misconfiguration: missing Supabase env vars" }), {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!deepgramApiKey) {
      return new Response(
        JSON.stringify({ error: "DEEPGRAM_API_KEY is not configured." }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (!callbackSecret) {
      return new Response(
        JSON.stringify({ error: "DEEPGRAM_CALLBACK_SECRET is not configured." }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    const {
      jobId,
      partsCount,
      model,
      deepgramOptions: requestedOptions,
    }: PrepareRequest = await req.json();

    if (!jobId || !partsCount || partsCount < 1) {
      return new Response(
        JSON.stringify({ error: "jobId and partsCount (>= 1) are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const opts: DeepgramOptions = { ...DEFAULT_OPTIONS, ...requestedOptions };
    const deepgramModel = whitelistModel(model);
    const baseDeepgramUrl = buildDeepgramUrl(deepgramModel, opts);

    console.log(`[PREP] Job ${jobId}: ${partsCount} part(s), model=${deepgramModel}`);
    console.log(`[PREP] Job ${jobId}: Deepgram URL = ${baseDeepgramUrl}`);

    // -------------------------------------------------------------------------
    // Mint a short-lived Deepgram JWT via /v1/auth/grant (TTL = 600s).
    // The browser uses Bearer <access_token> to POST audio directly to Deepgram.
    // This requires only usage:write scope — no Admin/Owner scope needed.
    // -------------------------------------------------------------------------
    const ttlSeconds = 600;
    const grantRes = await fetch("https://api.deepgram.com/v1/auth/grant", {
      method: "POST",
      headers: {
        Authorization: `Token ${deepgramApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ttl_seconds: ttlSeconds }),
    });

    if (!grantRes.ok) {
      const errText = await grantRes.text().catch(() => "");
      return await failJob(supabase, jobId, `Deepgram grant failed ${grantRes.status}: ${errText.slice(0, 200)}`);
    }

    const grantData = await grantRes.json() as { access_token?: string; expires_in?: number };
    const tempKey = grantData.access_token;
    if (!tempKey) {
      return await failJob(supabase, jobId, "Deepgram did not return an access_token");
    }

    const actualTtl = grantData.expires_in ?? ttlSeconds;
    console.log(`[PREP] Job ${jobId}: Deepgram JWT minted (TTL ${actualTtl}s)`);

    // -------------------------------------------------------------------------
    // Build per-part callback URLs and create transcript_parts rows so the
    // callback function has rows to write into when results arrive.
    // -------------------------------------------------------------------------
    const partCallbackUrls: string[] = [];
    for (let i = 0; i < partsCount; i++) {
      const token = await signCallbackToken(callbackSecret, jobId, i);
      const callbackUrl =
        `${supabaseUrl}/functions/v1/transcribe-callback` +
        `?jobId=${encodeURIComponent(jobId)}` +
        `&partIndex=${i}` +
        `&token=${encodeURIComponent(token)}`;
      partCallbackUrls.push(callbackUrl);

      await supabase.from("transcript_parts").insert({
        job_id: jobId,
        part_index: i,
        storage_path: "",     // filled in by background archive upload later
        status: "submitted",
      });
    }

    // Update job to processing state
    await supabase.from("transcription_jobs").update({
      status: "processing",
      parts_total: partsCount,
      parts_completed: 0,
      phase: `Uploading to Deepgram (${partsCount} part${partsCount > 1 ? "s" : ""})...`,
      progress: 5,
      deepgram_options: opts,
      logs: [
        `[SYS] Deepgram model: ${deepgramModel}`,
        `[SYS] Options: ${summarizeOptions(opts)}`,
        opts.keyterms.length > 0 ? `[KEYTERMS] ${opts.keyterms.join(", ")}` : null,
        `[DIRECT] Browser → Deepgram direct upload mode`,
      ].filter(Boolean),
    }).eq("id", jobId);

    console.log(`[PREP] Job ${jobId}: ready — returning token + ${partsCount} callback URL(s) to browser`);

    return new Response(
      JSON.stringify({
        tempKey,
        ttlSeconds: actualTtl,
        partCallbackUrls,
        baseDeepgramUrl,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );

  } catch (err) {
    console.error("[PREP] Unexpected error:", err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
