import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALLOWED_CONTENT_TYPES = new Set([
  "audio/mpeg", "audio/wav", "audio/flac", "audio/x-flac",
  "audio/mp4",  "audio/m4a", "audio/x-m4a",
  "audio/aac",  "audio/x-aac",
  "video/mp4",  "video/quicktime", "video/x-msvideo",
  "application/octet-stream",
]);

const MAX_FILE_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB hard ceiling per part

interface CreateUploadUrlRequest {
  jobScopeId: string;   // client-generated UUID — namespaces all parts of one job
  partIndex: number;    // 0-based
  filename: string;
  contentType: string;
  fileSize: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sanitizeFilename(name: string): string {
  return name
    .replace(/[^\w.\-]+/g, "_")  // anything not word/dot/dash → underscore
    .replace(/^\.+/, "")          // strip leading dots (block "../" attempts)
    .slice(0, 200);               // cap length
}

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) {
      return new Response(JSON.stringify({ error: "Server not configured" }), {
        status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json() as Partial<CreateUploadUrlRequest>;
    const { jobScopeId, partIndex, filename, contentType, fileSize } = body;

    console.log(`[CREATE-URL] Request received: filename="${filename}", size=${typeof fileSize === 'number' ? (fileSize / 1024 / 1024).toFixed(2) : 'unknown'} MB, contentType=${contentType}, partIndex=${partIndex}, jobScopeId=${jobScopeId}`);

    // --- Validation --------------------------------------------------------
    if (!jobScopeId || !isUuid(jobScopeId)) {
      return new Response(JSON.stringify({ error: "jobScopeId must be a UUID" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (typeof partIndex !== "number" || !Number.isInteger(partIndex) || partIndex < 0 || partIndex > 99) {
      return new Response(JSON.stringify({ error: "partIndex must be an integer 0-99" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!filename || typeof filename !== "string") {
      return new Response(JSON.stringify({ error: "filename is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!contentType || !ALLOWED_CONTENT_TYPES.has(contentType.toLowerCase())) {
      return new Response(JSON.stringify({ error: `contentType not allowed: ${contentType}` }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (typeof fileSize !== "number" || fileSize <= 0 || fileSize > MAX_FILE_BYTES) {
      return new Response(JSON.stringify({ error: `fileSize must be 1..${MAX_FILE_BYTES} bytes` }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const safeName = sanitizeFilename(filename);
    if (!safeName) {
      return new Response(JSON.stringify({ error: "filename sanitized to empty string" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Path layout: {jobScopeId}/part_{NN}_{safeName}
    // - jobScopeId is a fresh UUID per job → no path collisions, ever
    // - part_{NN} is zero-padded to preserve ordering
    // - safeName is the cleaned original filename for human readability in logs
    const path = `${jobScopeId}/part_${String(partIndex).padStart(2, "0")}_${safeName}`;

    const supabase = createClient(supabaseUrl, serviceKey);

    const { data, error } = await supabase.storage
      .from("audio-files")
      .createSignedUploadUrl(path);

    if (error || !data?.signedUrl) {
      console.error(`[CREATE-URL] createSignedUploadUrl failed for path=${path}: ${error?.message ?? "no data returned"}`);
      return new Response(JSON.stringify({ error: `Could not create upload URL: ${error?.message}` }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[CREATE-URL] Signed URL issued — path=${path}, size=${typeof fileSize === 'number' ? (fileSize / 1024 / 1024).toFixed(2) : '?'} MB, expires in 1h (Supabase default)`);

    return new Response(JSON.stringify({
      uploadUrl: data.signedUrl,
      token: data.token,
      path,
    }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("create-upload-url error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
