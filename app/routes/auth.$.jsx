import { LoaderFunctionArgs } from "@remix-run/node";
import shopify from "../shopify.server.js";

/**
 * /auth/* — handles Shopify OAuth flow
 *
 * GET  /auth/login           → show login page (shopify.login returns {})
 * GET  /auth/login?shop=... → shopify.login() throws redirect to Shopify OAuth
 * GET  /auth/callback?...   → shopify.authenticate.admin() handles OAuth callback internally
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/auth\//, "") || "login";

  // /auth/login — initiate OAuth (GET with shop param throws redirect internally)
  if (path === "login") {
    const result = await shopify.login(request);
    if (result?.shop === "MISSING_SHOPIFY_DOMAIN_ERROR") {
      return new Response("Missing shop parameter", { status: 400 });
    }
    return new Response(null, { status: 200 });
  }

  // /auth/callback — Shopify library handles the OAuth callback automatically
  if (path === "callback") {
    return shopify.authenticate.admin(request);
  }

  // All other /auth/* paths → validate admin session
  return shopify.authenticate.admin(request);
}
