import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";

const requiredEnvVars = [
  "SHOPIFY_APP_URL",
  "SHOPIFY_API_KEY",
  "SHOPIFY_API_SECRET",
];

const missing = requiredEnvVars.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error("[shopify.server] Missing environment variables:", missing.join(", "));
  console.error("[shopify.server] Please set them in Railway Dashboard → Variables tab.");
}

if (!process.env.SHOPIFY_APP_URL) {
  throw new Error(
    "Missing SHOPIFY_APP_URL environment variable.\n" +
    "This is the public URL of your deployed app (e.g. https://your-app.up.railway.app).\n" +
    "Set it in Railway Dashboard → Variables tab, or in your .env file as SHOPIFY_APP_URL=https://your-app-url.railway.app"
  );
}

let shopify;

try {
  shopify = shopifyApp({
    apiKey: process.env.SHOPIFY_API_KEY,
    apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
    apiVersion: ApiVersion.October25,
    scopes: process.env.SCOPES?.split(","),
    appUrl: process.env.SHOPIFY_APP_URL,
    authPathPrefix: "/auth",
    sessionStorage: new PrismaSessionStorage(prisma),
    distribution: AppDistribution.AppStore,
    future: {
      expiringOfflineAccessTokens: true,
    },
    ...(process.env.SHOP_CUSTOM_DOMAIN
      ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
      : {}),
  });
} catch (err) {
  console.error("[shopify.server] Failed to initialize Shopify:", err.message);
  throw err;
}

export default shopify;
export const apiVersion = ApiVersion.October25;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
