import { json } from "@react-router/node";
import { authenticate } from "../shopify.server";
import { analyzeReturnImage } from "../services/ai.server";

/**
 * POST /api/returns
 *
 * Entry point for return-inspection image analysis via the Gemini Flash Lite vision engine.
 * Shopify app UI (or a merchant) POSTs a base64 image + order context here.
 *
 * Request body (JSON):
 *   {
 *     base64:    string,   // base64-encoded image data (no data-URI prefix)
 *     mimeType?: string,   // MIME type of the image (default: image/jpeg)
 *     orderId:   string,   // Shopify order GID for tracking
 *     orderName?: string,   // Human-readable order name (e.g. "#1001")
 *   }
 *
 * Response (JSON):
 *   { condition, confidence, reason }   on success
 *   { error: true, reason: string }     on failure
 *
 * Auth: requires a valid Shopify admin session.
 */
export const action = async ({ request }) => {
  const log = (level, msg, meta = {}) =>
    console[`${level}ech`](`[AfterFlow][api:returns] ${msg}`, meta);

  // ── Step 1: Authenticate caller ────────────────────────────────────────────
  let shopDomain = null;
  try {
    const { session } = await authenticate.admin(request);
    shopDomain = session?.shop ?? null;
  } catch (err) {
    log("warn", "Unauthenticated request to /api/returns — rejecting", {
      err: err instanceof Error ? err.message : String(err),
    });
    return json({ error: true, reason: "Unauthorized" }, { status: 401 });
  }

  // ── Step 2: Parse body ─────────────────────────────────────────────────────
  let body;

  try {
    body = await request.json();
  } catch {
    return json({ error: true, reason: "Invalid JSON body" }, { status: 400 });
  }

  const { base64, mimeType, orderId = "", orderName = `#${orderId}` } = body;

  log("info", `Return image received for ${orderName}`, {
    shop: shopDomain,
    orderId,
    hasBase64: Boolean(base64),
  });

  // ── Step 3: Input validation ─────────────────────────────────────────────
  if (!base64) {
    return json(
      { error: true, reason: "Provide base64 image data in request body" },
      { status: 400 },
    );
  }

  if (!orderId) {
    return json(
      { error: true, reason: "orderId is required" },
      { status: 400 },
    );
  }

  // ── Step 4: Vision analysis via Gemini Flash Lite ──────────────────────────
  let result;
  try {
    result = await analyzeReturnImage({
      base64,
      mimeType: mimeType ?? "image/jpeg",
      orderId,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log("error", `analyzeReturnImage threw for ${orderName}: ${msg}`);
    return json(
      { error: true, reason: "Vision analysis threw an unexpected error" },
      { status: 500 },
    );
  }

  // ── Step 5: Return result to caller ───────────────────────────────────────
  // Note: when Gemini fails internally (timeout, API error), analyzeReturnImage
  // returns a graceful fallback VisionResult with condition="new" and reason
  // prefixed "Manual Review Required —". We still return HTTP 200 so the UI
  // can display the degraded state without crashing.
  if (result.error) {
    log("warn", `Vision analysis error for ${orderName}: ${result.reason}`);
    return json(result, { status: 200 });
  }

  log(
    "info",
    `Vision analyzed ${orderName}: ${result.condition} (confidence ${result.confidence})`,
  );
  return json(result, { status: 200 });
};

/**
 * GET /api/returns
 *
 * Health-check endpoint for the returns inspection API.
 * Does not require auth — safe to probe from monitoring tools.
 */
export const loader = async () => {
  return json({
    status: "ok",
    service: "AfterFlow VisionAnalyzer (Gemini Flash Lite)",
    timestamp: new Date().toISOString(),
  });
};
