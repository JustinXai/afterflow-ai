import { createRequestHandler } from "@react-router/express";
import { readFileSync, existsSync } from "fs";
import { join, extname } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const BUILD_PATH = join(__dirname, "build/server/index.js");
const PUBLIC_PATH = join(__dirname, "public");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".txt": "text/plain",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".eot": "application/vnd.ms-fontobject",
};

async function main() {
  let ssrHandler;
  try {
    const build = await import(BUILD_PATH + "?t=" + Date.now());
    ssrHandler = createRequestHandler({ build });
    console.log("[AfterFlow] SSR build loaded successfully");
  } catch (err) {
    console.warn("[AfterFlow] SSR build not found, running in static-only mode:", err.message);
    ssrHandler = null;
  }

  if (!ssrHandler) {
    // Static-only fallback using built-in http module
    const http = await import("http");
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const demoPath = join(PUBLIC_PATH, "demo.html");
      if (existsSync(demoPath) && (url.pathname === "/" || url.pathname === "/index.html")) {
        const html = readFileSync(demoPath, "utf8");
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
      } else {
        res.writeHead(404);
        res.end("Not Found");
      }
    });
    server.listen(PORT, "0.0.0.0", () => {
      console.log(`[AfterFlow] Static server running → http://localhost:${PORT}`);
    });
    return;
  }

  // SSR mode: need express for middleware
  const express = (await import("express")).default;
  const app = express();
  app.disable("x-powered-by");

  // Static files from public/
  app.use(express.static(PUBLIC_PATH, {
    setHeaders(res, filePath) {
      const ext = extname(filePath).toLowerCase();
      if (ext === ".html" || filePath.endsWith("/demo.html")) {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader(
          "Content-Security-Policy",
          "frame-ancestors https://admin.shopify.com https://*.myshopify.com;"
        );
        res.setHeader("X-Shopify-Stage", "production");
        res.setHeader("X-Shopify-Embedded-App", "1");
      } else if (MIME[ext]) {
        res.setHeader("Content-Type", MIME[ext]);
      }
    },
  }));

  // Serve demo.html at root
  app.use((req, res, next) => {
    if (req.path === "/" || req.path === "/index.html") {
      const demoPath = join(PUBLIC_PATH, "demo.html");
      if (existsSync(demoPath)) {
        const html = readFileSync(demoPath, "utf8");
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader(
          "Content-Security-Policy",
          "frame-ancestors https://admin.shopify.com https://*.myshopify.com;"
        );
        res.setHeader("X-Shopify-Stage", "production");
        res.setHeader("X-Shopify-Embedded-App", "1");
        return res.send(html);
      }
    }
    next();
  });

  // Diagnostics route
  app.get("/__health", (req, res) => {
    res.json({
      ssrHandlerLoaded: !!ssrHandler,
      buildPathExists: existsSync(BUILD_PATH),
      env: {
        SHOPIFY_API_KEY: process.env.SHOPIFY_API_KEY ? "(set)" : "(MISSING)",
        SHOPIFY_API_SECRET: process.env.SHOPIFY_API_SECRET ? "(set)" : "(MISSING)",
        SHOPIFY_APP_URL: process.env.SHOPIFY_APP_URL || "(MISSING)",
      },
    });
  });

  // Error handler
  app.use((err, req, res, next) => {
    console.error("[AfterFlow] SSR error:", err.message, err.stack);
    res.status(500).json({ error: err.message });
  });

  // SSR: API routes, webhooks, auth
  app.all("/api/:path(*)", express.json(), express.text(), ssrHandler);
  app.all("/auth/:path(*)", ssrHandler);
  app.all(
    "/webhooks/:path(*)",
    express.raw({ type: "application/json" }),
    ssrHandler
  );
  app.use(ssrHandler);

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[AfterFlow] Server running → http://localhost:${PORT}`);
    console.log(`[AfterFlow] Demo:         http://localhost:${PORT}/`);
  });
}

main().catch(console.error);
