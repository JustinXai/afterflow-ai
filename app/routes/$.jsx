import fs from 'fs';
import path from 'path';

/**
 * Exclude Shopify auth + webhook + API routes from the demo.html catch-all.
 * Return null so React Router falls through to the next matching route
 * (e.g. auth.$.jsx handles /auth/*, webhooks routes handle /webhooks/*).
 * Returning a 404 here would short-circuit and break OAuth.
 */
export async function loader({ request }) {
  const url      = new URL(request.url);
  const pathname = url.pathname;
  const excluded = /^\/auth\/|^\/api\/|^\/webhooks\//;

  if (excluded.test(pathname)) {
    return null; // let React Router try the next route
  }

  const filePath = path.resolve("public", "demo.html");
  const html = fs.readFileSync(filePath, "utf8");

  const apiKey = process.env.SHOPIFY_API_KEY ?? "";
  const host   = url.searchParams.get("host") ?? "";
  const shop   = url.searchParams.get("shop") ?? "";

  const injectedHtml = html.replace(
    "</body>",
    `<script>
(function () {
  var params   = new URLSearchParams(window.location.search);
  var apiKey   = "${apiKey}";
  var host     = params.get("host") || "";
  var shop     = params.get("shop") || "";

  if (window.top !== window.self && apiKey) {
    var script = document.createElement("script");
    script.src = "https://unpkg.com/@shopify/app-bridge@3";
    script.onload = function () {
      var AppBridge = window["app-bridge"];
      if (AppBridge && AppBridge.createApp) {
        var app = AppBridge.createApp({
          apiKey: apiKey,
          host:   host,
        });
        // Dispatch ready so Shopify's frame detects the handshake
        window.dispatchEvent(new CustomEvent("appbridgeready", { detail: app }));
      }
    };
    document.head.appendChild(script);
  }

  // Log embed environment
  console.log("[AfterFlow] Embed env — shop:", shop, "host:", host ? "(present)" : "(absent)", "key:", apiKey ? "(present)" : "(MISSING)");
})();
</script>
</body>`
  );

  return new Response(injectedHtml, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "X-Shopify-Stage": "production",
      // Tell Shopify this is an embedded app response
      "X-Shopify-Embedded-App": "1",
      // Allow iframe embedding
      "Content-Security-Policy": "frame-ancestors https://admin.shopify.com https://*.myshopify.com;",
    },
  });
};

export default function LiveApp() {
  return null;
}
