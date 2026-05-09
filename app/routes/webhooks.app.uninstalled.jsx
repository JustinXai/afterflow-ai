import { authenticate } from "../shopify.server";

/**
 * POST /webhooks/app/uninstalled
 *
 * Shopify fires this webhook when a merchant uninstalls the app.
 * Cleans up local data associated with the shop.
 *
 * Always returns 200 so Shopify never retries.
 */
export const action = async ({ request }) => {
  let webhookCtx;
  try {
    webhookCtx = await authenticate.webhook(request);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[AfterFlow][webhooks:app:uninstalled] HMAC FAILED: ${errMsg}`);
    return new Response(null, { status: 200 });
  }

  const { payload, shop } = webhookCtx;

  console.log(`[AfterFlow][webhooks:app:uninstalled] HMAC verified — shop="${shop}"`);

  try {
    const prisma = (await import("../db.server")).default;
    const { shopDomain } = payload ?? {};

    // Delete all data for this shop
    const shopToDelete = shopDomain || shop;
    await prisma.session.deleteMany({ where: { shop: shopToDelete } });
    await prisma.orderAnalysis.deleteMany({ where: { orderId: { startsWith: `${shopToDelete}:` } } });
    await prisma.aiLog.deleteMany({ where: { orderId: { startsWith: `${shopToDelete}:` } } });

    console.info(`[AfterFlow][webhooks:app:uninstalled] Cleaned up data for shop="${shopToDelete}"`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[AfterFlow][webhooks:app:uninstalled] Cleanup error: ${msg}`);
  }

  return new Response(null, { status: 200 });
};
