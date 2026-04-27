import { json } from "@react-router/node";
import { authenticate } from "~/shopify.server";
import { analyzeOrderNote } from "~/services/ai.server";
import { updateShopifyOrderTags, prependOrderNote } from "~/models/ai.server";
import prisma from "~/db.server";

/**
 * POST /webhooks/orders/create
 *
 * Shopify fires this webhook whenever a new order is created.
 * Handles the full 闭环:
 *   1. Verify HMAC signature + parse body via authenticate.webhook(request)
 *   2. Skip if AF_PCD_APPROVED is not "true"
 *   3. Skip if no customer note
 *   4. Skip if order already analyzed (idempotency)
 *   5. Call DeepSeek via analyzeOrderNote()
 *   6. Write tags + prepend note via Shopify Admin API (admin client from adapter)
 *   7. Persist result to Prisma (AiLog)
 *
 * Always returns 200 so Shopify never retries or marks the webhook as failed.
 * All errors are swallowed server-side — never expose internal errors to Shopify.
 */
export const action = async ({ request }) => {
  const log = (level, msg, meta = {}) =>
    console[`${level}ech`](`[AfterFlow][webhook:orders:create] ${msg}`, meta);

  // ── Step 1: HMAC verification + body parsing ───────────────────────────────
  // authenticate.webhook(request) reads request.text() internally for HMAC
  // validation. We MUST use the returned payload — calling request.json() would
  // fail because the stream is already consumed.
  let webhookCtx;
  try {
    webhookCtx = await authenticate.webhook(request);
  } catch (err) {
    // Shopify's adapter throws a Response object (status 401 for bad HMAC,
    // 405 for non-POST, 400 for other validation failures). Return 200 to
    // prevent Shopify from retrying malformed requests.
    log("error", `authenticate.webhook threw: ${err instanceof Error ? err.message : String(err)}`);
    return json({ reason: "Auth error" }, { status: 200 });
  }

  const { payload, shop, topic, admin } = webhookCtx;

  // Sanity check: confirm this is the orders/create topic
  if (topic !== "orders/create") {
    log("warn", `Unexpected topic "${topic}" — expected "orders/create". Skipping.`);
    return json({ reason: `Unexpected topic: ${topic}` }, { status: 200 });
  }

  log("info", "HMAC verified", { shop, topic });

  // ── Step 2: Extract order fields (PII-safe: only id, note, name) ───────────
  const orderId   = payload?.id?.toString() ?? "";
  const orderName = payload?.name ?? `#${orderId}`;
  const note      = (payload?.note ?? "").trim();

  if (!orderId) {
    log("error", `Order missing id field — cannot process`);
    return json({ reason: "Missing order id" }, { status: 200 });
  }

  log("info", `Order received: ${orderName} (${orderId})`, {
    hasNote: note.length > 0,
    noteLength: note.length,
  });

  // ── Step 3: Feature-flag kill-switch ──────────────────────────────────────
  if (process.env.AF_PCD_APPROVED !== "true") {
    log("warn", `AF_PCD_APPROVED is not "true" — skipping analysis for ${orderName}`);
    await logToPrisma(orderId, "skipped", note || "(no note)", "", "Feature disabled");
    return json({ status: "skipped", reason: "Feature disabled" }, { status: 200 });
  }

  // ── Step 4: Skip if no note ────────────────────────────────────────────────
  if (!note) {
    log("info", `Order ${orderName} has no note — skipping AI analysis`);
    await logToPrisma(orderId, "skipped", "(no note)", "", "No note provided");
    return json({ status: "skipped", reason: "No note" }, { status: 200 });
  }

  // ── Step 5: Idempotency — skip if already analyzed ─────────────────────────
  const alreadyDone = await prisma.orderAnalysis.findUnique({ where: { orderId } });
  if (alreadyDone) {
    log("info", `Order ${orderName} already analyzed — skipping`);
    return json({ status: "duplicate", reason: "Already processed" }, { status: 200 });
  }

  // ── Step 6: AI analysis ────────────────────────────────────────────────────
  let analysisResult;
  try {
    analysisResult = await analyzeOrderNote(note, orderId);
    log("info", `AI parsed ${orderName}`, {
      urgency: analysisResult.urgency,
      tags: analysisResult.tags,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log("error", `analyzeOrderNote failed for ${orderName}: ${msg}`);
    await logToPrisma(orderId, "error", note, "", msg);
    return json({ reason: "AI analysis failed" }, { status: 200 });
  }

  // ── Step 7: Write tags to Shopify via tagsAdd mutation ─────────────────────
  // Use the admin client returned by authenticate.webhook — it is already scoped
  // to the correct shop and authenticated via session. No need for a separate
  // unauthenticated.admin() call.
  if (analysisResult.tags.length > 0 && admin) {
    try {
      await updateShopifyOrderTags(admin, orderId, analysisResult.tags);
      log("info", `Tags written to ${orderName}: [${analysisResult.tags.join(", ")}]`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log("error", `tagsAdd failed for ${orderName}: ${msg}`);
    }
  }

  // ── Step 8: Prepend [AfterFlow AI] summary to order note ──────────────────
  if (admin) {
    try {
      await prependOrderNote(admin, orderId, analysisResult.summary, note);
      log("info", `AI note prepended to ${orderName}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log("error", `Note update failed for ${orderName}: ${msg}`);
    }
  }

  log("info", `Webhook 处理完成 for ${orderName}`, {
    urgency: analysisResult.urgency,
    tags: analysisResult.tags,
    summary: analysisResult.summary,
  });

  // ── Step 9: Persist to Prisma ───────────────────────────────────────────────
  await logToPrisma(orderId, "success", note, JSON.stringify(analysisResult), "");

  return json({ status: "processed", orderId, ...analysisResult }, { status: 200 });
};

/** Lightweight Prisma logger — never throws */
async function logToPrisma(orderId, status, input, output, error) {
  try {
    await prisma.aiLog.create({
      data: {
        orderId,
        status,
        input,
        output,
        error: error ?? "",
        processedAt: new Date(),
      },
    });
  } catch (prismaErr) {
    const msg = prismaErr instanceof Error ? prismaErr.message : String(prismaErr);
    console.error("[AfterFlow][webhook] Prisma logging failed:", msg);
  }
}
