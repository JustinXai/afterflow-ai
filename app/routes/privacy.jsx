import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * GET /privacy
 *
 * Serves the public privacy policy page at /privacy.
 * The public/privacy.html file is served directly for both /privacy and /privacy.html
 * by React Router serving this loader.
 */
export const loader = async () => {
  const filePath = path.resolve(__dirname, "../../public/privacy.html");
  const html = fs.readFileSync(filePath, "utf8");

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": "frame-ancestors https://admin.shopify.com https://*.myshopify.com;",
    },
  });
};

export default function Privacy() {
  return null;
}
