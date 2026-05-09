import { authenticate } from "../shopify.server";
import { updateShopifyOrderTags, prependOrderNote } from "../models/ai.server";
import { analyzeOrderNote } from "../services/ai.server";
import prisma from "../db.server";

/**
 * POST /webhooks/orders/create
 *
 * Shopify fires this webhook whenever a new order is created.
 * Handles the full 闭环:
 *   1. Verify HMAC signature + parse body via authenticate.webhook(request)
 *   2. Skip if AF_PCD_APPROVED is not "true"
 *   3. Skip if no customer note
 *   4. Skip if order already analyzed (idempotency)
 *   5. AI analysis via analyzeOrderNote()
 *   6. Write tags + prepend note via Shopify Admin API (admin client from adapter)
 *   7. Persist result to Prisma (AiLog)
 *
 * Always returns 200 so Shopify never retries or marks the webhook as failed.
 */
export const action = async ({ request }) => {
  console.log("[AfterFlow][webhooks:orders:create] Raw webhook received — awaiting HMAC check");

  let webhookCtx;
  try {
    webhookCtx = await authenticate.webhook(request);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const errStack = err instanceof Error ? err.stack : "";
    console.error(`[AfterFlow][webhooks:orders:create] HMAC FAILED: ${errMsg}`);
    console.error(`[AfterFlow][webhooks:orders:create] Stack: ${errStack}`);
    return new Response(null, { status: 200 });
  }

  const { payload, shop, admin } = webhookCtx;

  console.log(`[AfterFlow][webhooks:orders:create] HMAC verified — shop="${shop}"`);

  const orderId   = payload?.id?.toString() ?? "";
  const orderName = payload?.name ?? `#${orderId}`;
  const note      = (payload?.note ?? "").trim();

  if (!orderId) {
    console.error(`[AfterFlow][webhooks:orders:create] Order missing id field — cannot process`);
    return new Response(null, { status: 200 });
  }

  console.log(`[AfterFlow][webhooks:orders:create] Order received: ${orderName} (${orderId}) — note length: ${note.length}`);

  if (process.env.AF_PCD_APPROVED !== "true") {
    console.warn(`[AfterFlow][webhooks:orders:create] AF_PCD_APPROVED != true — skipping analysis for ${orderName}`);
    await logToPrisma(orderId, "skipped", note || "(no note)", "", "Feature disabled");
    return new Response(null, { status: 200 });
  }

  if (!note) {
    console.info(`[AfterFlow][webhooks:orders:create] Order ${orderName} has no note — skipping AI analysis`);
    await logToPrisma(orderId, "skipped", "(no note)", "", "No note provided");
    return new Response(null, { status: 200 });
  }

  const alreadyDone = await prisma.orderAnalysis.findUnique({ where: { orderId } });
  if (alreadyDone) {
    console.info(`[AfterFlow][webhooks:orders:create] Order ${orderName} already analyzed — skipping`);
    return new Response(null, { status: 200 });
  }

  let analysisResult;
  try {
    const result = await analyzeOrderNote(note, orderId);
    if ("error" in result) throw new Error(result.reason);
    analysisResult = result;
    console.info(`[AfterFlow][webhooks:orders:create] AI parsed ${orderName} — urgency=${analysisResult.urgency} tags=[${analysisResult.tags.join(", ")}]`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[AfterFlow][webhooks:orders:create] analyzeOrderNote failed for ${orderName}: ${msg}`);
    await logToPrisma(orderId, "error", note, "", msg);
    return new Response(null, { status: 200 });
  }

  if (analysisResult.tags.length > 0 && admin) {
    try {
      await updateShopifyOrderTags(admin, orderId, analysisResult.tags);
      console.info(`[AfterFlow][webhooks:orders:create] Tags written to ${orderName}: [${analysisResult.tags.join(", ")}]`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[AfterFlow][webhooks:orders:create] tagsAdd failed for ${orderName}: ${msg}`);
    }
  }

  if (admin) {
    try {
      await prependOrderNote(admin, orderId, analysisResult.summary, note);
      console.info(`[AfterFlow][webhooks:orders:create] AI note prepended to ${orderName}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[AfterFlow][webhooks:orders:create] Note update failed for ${orderName}: ${msg}`);
    }
  }

  await logToPrisma(orderId, "success", note, JSON.stringify(analysisResult), "");
  console.info(`[AfterFlow][webhooks:orders:create] Webhook processing complete for ${orderName}`);
  return new Response(null, { status: 200 });
};

async function logToPrisma(orderId, status, input, output, error) {
  try {
    await prisma.aiLog.create({
      data: { orderId, status, input, output, error: error ?? "", processedAt: new Date() },
    });
  } catch (prismaErr) {
    const msg = prismaErr instanceof Error ? prismaErr.message : String(prismaErr);
    console.error("[AfterFlow][webhooks:orders:create] Prisma logging failed:", msg);
  }
}
