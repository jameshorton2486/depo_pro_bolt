// transcribe-callback — receives async Deepgram results for each submitted part.
//
// DEPLOYMENT NOTE: This function MUST have verify_jwt = false in supabase/config.toml
// because Deepgram callbacks do not carry a Supabase JWT. Without this setting,
// every callback will be rejected with 401 before this code runs.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { verifyCallbackToken } from "../_shared/hmac.ts";
import { finalizeTranscript, type TranscriptPartRow } from "../_shared/transcript_pipeline.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ---------------------------------------------------------------------------
  // 1. Parse and validate query params
  // ---------------------------------------------------------------------------
  const url = new URL(req.url);
  const jobId = url.searchParams.get("jobId");
  const partIndexRaw = url.searchParams.get("partIndex");
  const token = url.searchParams.get("token");

  if (!jobId || partIndexRaw === null || !token) {
    console.error("[CALLBACK] Missing required query params", { jobId, partIndexRaw, hasToken: !!token });
    return new Response(JSON.stringify({ error: "Missing jobId, partIndex, or token" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const partIndex = parseInt(partIndexRaw, 10);
  if (isNaN(partIndex) || partIndex < 0) {
    return new Response(JSON.stringify({ error: "Invalid partIndex" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ---------------------------------------------------------------------------
  // 2. HMAC verification — reject forged callbacks before any DB work
  // ---------------------------------------------------------------------------
  const callbackSecret = Deno.env.get("DEEPGRAM_CALLBACK_SECRET");
  if (!callbackSecret) {
    console.error("[CALLBACK] DEEPGRAM_CALLBACK_SECRET not configured");
    return new Response(JSON.stringify({ error: "Server misconfiguration" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const valid = await verifyCallbackToken(callbackSecret, jobId, partIndex, token);
  if (!valid) {
    console.error("[CALLBACK] Invalid HMAC token for job", jobId, "part", partIndex);
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ---------------------------------------------------------------------------
  // 3. Parse body — fail loudly on bad JSON
  // ---------------------------------------------------------------------------
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch (parseErr) {
    console.error("[CALLBACK] Failed to parse body for job", jobId, "part", partIndex, parseErr);
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    await supabase.from("transcript_parts")
      .update({ status: "failed", error_message: "Malformed JSON body from Deepgram" })
      .eq("job_id", jobId).eq("part_index", partIndex);
    await supabase.from("transcription_jobs")
      .update({ status: "failed", error_message: "Malformed Deepgram callback body" })
      .eq("id", jobId);
    return new Response(JSON.stringify({ error: "Bad request body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  // Log body size and Deepgram-reported audio duration upfront
  const bodySize = JSON.stringify(body).length;
  const cbMetadata = body.metadata as Record<string, unknown> | undefined;
  const reportedDuration = typeof cbMetadata?.duration === "number" ? cbMetadata.duration : null;
  console.log(`[CALLBACK] Received for job=${jobId} part=${partIndex} — body=${(bodySize / 1024).toFixed(1)} KB, Deepgram-reported audio duration=${reportedDuration ?? "unknown"}s`);

  // ---------------------------------------------------------------------------
  // 4. Load the transcript_parts row
  // ---------------------------------------------------------------------------
  const { data: part, error: partLoadErr } = await supabase
    .from("transcript_parts")
    .select("*")
    .eq("job_id", jobId)
    .eq("part_index", partIndex)
    .maybeSingle();

  if (partLoadErr || !part) {
    console.error("[CALLBACK] Part row not found for job", jobId, "part", partIndex, partLoadErr?.message);
    return new Response(JSON.stringify({ error: "Part not found" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Log time elapsed since this part was submitted to Deepgram
  if (part.created_at) {
    const elapsedSec = Math.round((Date.now() - new Date(part.created_at).getTime()) / 1000);
    console.log(`[CALLBACK] Part ${partIndex} elapsed since submit: ${elapsedSec}s (Deepgram processing time)`);
  }

  // ---------------------------------------------------------------------------
  // 5. Idempotency check — Deepgram retries on 5xx, so duplicates must be no-ops
  // ---------------------------------------------------------------------------
  if (part.status === "complete" && part.raw_result !== null) {
    console.log("[CALLBACK] Already complete — idempotent no-op for job", jobId, "part", partIndex);
    return new Response(JSON.stringify({ ok: true, alreadyComplete: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ---------------------------------------------------------------------------
  // 6. Extract duration from Deepgram metadata (authoritative) or fall back
  // ---------------------------------------------------------------------------
  let duration = 0;
  const metadata = body.metadata as Record<string, unknown> | undefined;
  if (typeof metadata?.duration === "number") {
    duration = metadata.duration;
  } else {
    // Fall back to largest end time among utterances
    const results = body.results as Record<string, unknown> | undefined;
    const utterances = results?.utterances as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(utterances) && utterances.length > 0) {
      duration = utterances.reduce((max, u) => Math.max(max, (u.end as number) ?? 0), 0);
      console.warn("[CALLBACK] metadata.duration absent — fell back to utterance end times:", duration);
    }
  }

  // ---------------------------------------------------------------------------
  // 7. Persist the part result
  // ---------------------------------------------------------------------------
  const { error: updateErr } = await supabase
    .from("transcript_parts")
    .update({
      raw_result: body,
      status: "complete",
      duration_seconds: duration,
      completed_at: new Date().toISOString(),
    })
    .eq("job_id", jobId)
    .eq("part_index", partIndex);

  if (updateErr) {
    console.error("[CALLBACK] Failed to update transcript_parts:", updateErr.message);
    return new Response(JSON.stringify({ error: "DB update failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ---------------------------------------------------------------------------
  // 8. Atomically increment parts_completed via Postgres function.
  //    The increment_parts_completed RPC does it in one SQL statement so
  //    concurrent callbacks for the same job never race. The function also
  //    updates the phase string atomically, so the UI sees a consistent value.
  // ---------------------------------------------------------------------------
  const { data: counterRows, error: incErr } = await supabase
    .rpc("increment_parts_completed", { p_job_id: jobId });

  if (incErr || !counterRows || !Array.isArray(counterRows) || counterRows.length === 0) {
    console.error("[CALLBACK] increment_parts_completed failed:", incErr?.message);
    return new Response(JSON.stringify({ error: "Counter increment failed" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { parts_completed: currentCompleted, parts_total: partsTotal } = counterRows[0] as {
    parts_completed: number;
    parts_total: number;
  };

  console.log(`[CALLBACK] Job ${jobId} part ${partIndex} complete. ${currentCompleted}/${partsTotal} parts done.`);

  // ---------------------------------------------------------------------------
  // 9. If not all parts are complete yet, return and wait for more
  // ---------------------------------------------------------------------------
  if (currentCompleted < partsTotal) {
    return new Response(JSON.stringify({ ok: true, partsComplete: currentCompleted, partsTotal }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ---------------------------------------------------------------------------
  // 10. All parts complete — run finalization pass
  // ---------------------------------------------------------------------------
  console.log(`[CALLBACK] All ${partsTotal} parts complete for job ${jobId}. Starting finalization.`);

  const finalizeStart = Date.now();
  try {
    await supabase.from("transcription_jobs").update({
      phase: "Stitching transcripts...",
      progress: 60,
    }).eq("id", jobId);

    // Load all completed parts in order
    const { data: allParts, error: partsErr } = await supabase
      .from("transcript_parts")
      .select("part_index, raw_result, duration_seconds")
      .eq("job_id", jobId)
      .order("part_index", { ascending: true });

    if (partsErr || !allParts || allParts.length === 0) {
      throw new Error(`Failed to load parts for finalization: ${partsErr?.message}`);
    }

    // Filter to complete parts only (guard against unexpected partial state)
    const completeParts = allParts.filter(p => p.raw_result !== null) as TranscriptPartRow[];
    console.log(`[CALLBACK] Loaded ${completeParts.length} complete parts for finalization (${Date.now() - finalizeStart}ms elapsed)`);

    await finalizeTranscript(supabase, jobId, completeParts);
    console.log(`[CALLBACK] Finalization for job ${jobId} took ${Date.now() - finalizeStart}ms`);

  } catch (finalizeErr) {
    console.error("[CALLBACK] Finalization failed for job", jobId, finalizeErr);
    await supabase.from("transcription_jobs").update({
      status: "failed",
      error_message: `Finalization failed: ${String(finalizeErr)}`,
    }).eq("id", jobId);
    // Still return 200 — Deepgram already delivered its payload; this is our bug, not theirs
    return new Response(JSON.stringify({ ok: false, error: String(finalizeErr) }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true, finalized: true }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
