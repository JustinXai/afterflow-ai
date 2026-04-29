import prisma from "../db.server";
import { getConfig } from "../utils/config.server";

// ─── Shared constants ──────────────────────────────────────────────────────────

const DEEPSEEK_TIMEOUT_MS = 12_000;
const GEMINI_TIMEOUT_MS = 12_000;

// ─── Result types ─────────────────────────────────────────────────────────────

export interface AnalyzeResult {
  urgency: "high" | "normal";
  tags: string[];
  summary: string;
  error?: false;
}

export interface VisionResult {
  condition: "damaged" | "used" | "wrong_item" | "new";
  confidence: number;
  reason: string;
  error?: false;
}

export interface AiError {
  error: true;
  reason: string;
}

// ─── JSON helpers ─────────────────────────────────────────────────────────────

function extractJson(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  const match = trimmed.match(/```(?:json)?\s*([\s\S]*?)```$/);
  return JSON.parse(match ? match[1].trim() : trimmed);
}

function safeJsonParse(raw: unknown, fallback: Record<string, unknown> = {}): Record<string, unknown> {
  if (typeof raw === "object" && raw !== null) return raw as Record<string, unknown>;
  return fallback;
}

function normalizeConfidence(value: unknown): number {
  if (typeof value === "number") return Math.max(0, Math.min(1, value));
  if (typeof value === "string") {
    const parsed = parseFloat(value);
    return isNaN(parsed) ? 0.5 : Math.max(0, Math.min(1, parsed));
  }
  return 0.5;
}

// ─── TextAnalyzer: DeepSeek ───────────────────────────────────────────────────

const TEXT_SYSTEM_PROMPT = `You are an expert e-commerce order fulfillment assistant. Analyze the customer order note and respond with ONLY a valid JSON object — no markdown, no explanation.

Schema: { "urgency": "high|normal", "tags": ["tag1","tag2",...], "summary": "one sentence" }

MANDATORY TAG RULES (apply ALL that match):
1. "fragile" → item is fragile, needs extra protection, double-box, handle with care, or similar
2. "overnight-delivery" → overnight, express, rush, urgent, ASAP, FedEx, UPS, next day, same day, time deadline ("by Friday", "within 24 hours", "ship today")
3. "gift" → gift, birthday, anniversary, holiday, wedding, Christmas, surprise, present, wife's/husband's/boyfriend's/girlfriend's/son's/daughter's birthday
4. "gift-packaging" → gift wrap, no price tag, no invoice, no receipt, gift box, gift message, include a card, leave no price indication
5. "cancellation-risk" → customer explicitly says "cancel and refund", or "cancel if X" (refund threat)
6. "size-swap" → size/color/style/attribute swap, "Red L" means "I want Red color in size L", "no [X] cancel" means "do NOT cancel if [X attribute is correct]"
7. "delivery-note" → leave at door, leave outside, hide package, porch, neighbor, ring doorbell, call before delivery, signature required
8. "address-change" → redirect, new address, ship to different address, forward it, change delivery address, different address (ALWAYS flag as fraud risk — account takeover pattern)
9. "subscription" → subscription, reorder, refill, recurring
10. "standard" → only if NO other tags apply

URGENCY RULES (strict):
- "high" if ANY of: fragile items, overnight/express/delivery deadline, cancellation-risk, birthday/holiday/anniversary, surprise gift (keep secret), size/color swap with urgency, any explicit time pressure, "no matter what" / "must" / "absolutely" language, address-change (always high — fraud risk)
- ALWAYS "high" if: cancel, refund, "by Friday", "rush", "ASAP", birthday, surprise, deadline, "no matter what", "must", "absolutely", redirect, forwarding
- "normal" only if: standard order, routine gift-packaging without time pressure

SUMMARY FORMAT: "Customer [action] for [product/situation]. [Key fulfillment instruction]."

Customer note: "\${note}"`;

function buildTextResult(
  parsed: Record<string, unknown>,
  note: string,
): AnalyzeResult {
  const tags = Array.isArray(parsed.tags)
    ? parsed.tags
        .filter((t) => typeof t === "string")
        .map((t) => String(t).toLowerCase().trim().replace(/\s+/g, "-"))
    : ["manual-review"];

  const urgency: "high" | "normal" =
    parsed.urgency === "high" || parsed.urgency === "normal"
      ? String(parsed.urgency) as "high" | "normal"
      : "normal";

  const summary = parsed.summary
    ? String(parsed.summary).slice(0, 200)
    : note.slice(0, 120);

  return { urgency, tags, summary };
}

export async function analyzeOrderNote(
  note: string,
  orderId: string,
): Promise<AnalyzeResult | AiError> {
  const cleanNote = (note ?? "").trim();

  if (!cleanNote) {
    return { urgency: "normal", tags: ["standard"], summary: "No note provided." };
  }

  let deepseekApiKey: string | null = null;
  let deepseekBaseUrl = "https://api.deepseek.com";
  let geminiApiKey: string | null = null;
  let geminiEndpoint = "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent";

  try {
    const cfg = getConfig();
    deepseekApiKey = cfg.deepseekApiKey;
    deepseekBaseUrl = cfg.deepseekBaseUrl;
    geminiApiKey = cfg.geminiApiKey;
    geminiEndpoint = cfg.geminiEndpoint;
  } catch {
    // getConfig throws if DEEPSEEK_API_KEY is not set (standalone / dev mode).
    // Continue — we will check geminiApiKey below.
  }

  if (!deepseekApiKey && !geminiApiKey) {
    return { error: true, reason: "No AI provider configured — set DEEPSEEK_API_KEY or GEMINI_API_KEY" };
  }

  // ── Provider 1: DeepSeek (primary) ─────────────────────────────────────────
  if (deepseekApiKey && deepseekApiKey !== "your_deepseek_api_key_here") {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), DEEPSEEK_TIMEOUT_MS);

      const response = await fetch(`${deepseekBaseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${deepseekApiKey}`,
        },
        body: JSON.stringify({
          model: "deepseek-chat",
          messages: [
            { role: "system", content: TEXT_SYSTEM_PROMPT.replace("${note}", cleanNote) },
            { role: "user", content: cleanNote },
          ],
          temperature: 0.2,
          max_tokens: 200,
        }),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (response.ok) {
        const data = safeJsonParse(await response.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        const rawResponse = data?.choices?.[0]?.message?.content ?? "";
        const parsed = extractJson(rawResponse);
        const result = buildTextResult(parsed, cleanNote);

        await prisma.orderAnalysis.upsert({
          where: { orderId },
          update: {
            originalNote: cleanNote,
            urgency: result.urgency,
            tags: JSON.stringify(result.tags),
            summary: result.summary,
          },
          create: {
            orderId,
            originalNote: cleanNote,
            urgency: result.urgency,
            tags: JSON.stringify(result.tags),
            summary: result.summary,
            createdAt: new Date(),
          },
        });

        await prisma.aiLog.create({
          data: {
            orderId,
            status: "success",
            input: cleanNote,
            output: JSON.stringify(result),
            error: "",
            processedAt: new Date(),
          },
        });

        return result;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[AfterFlow][analyzeOrderNote] DeepSeek failed: ${msg}, trying Gemini...`);
    }
  }

  // ── Provider 2: Gemini (fallback) ─────────────────────────────────────────
  if (!geminiApiKey) {
    return { error: true, reason: "DeepSeek failed and no Gemini API key available" };
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);

    const url = `${geminiEndpoint}?key=${geminiApiKey}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: TEXT_SYSTEM_PROMPT.replace("${note}", cleanNote) + `\n\nCustomer note: "${cleanNote}"` }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.2 },
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Gemini HTTP ${response.status}: ${body}`);
    }

    const data = safeJsonParse(await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const rawResponse = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const parsed = extractJson(rawResponse);
    const result = buildTextResult(parsed, cleanNote);

    await prisma.orderAnalysis.upsert({
      where: { orderId },
      update: {
        originalNote: cleanNote,
        urgency: result.urgency,
        tags: JSON.stringify(result.tags),
        summary: result.summary,
      },
      create: {
        orderId,
        originalNote: cleanNote,
        urgency: result.urgency,
        tags: JSON.stringify(result.tags),
        summary: result.summary,
        createdAt: new Date(),
      },
    });

    await prisma.aiLog.create({
      data: {
        orderId,
        status: "success",
        input: cleanNote,
        output: JSON.stringify(result),
        error: "",
        processedAt: new Date(),
      },
    });

    return result;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[AfterFlow][analyzeOrderNote] All AI providers failed: ${reason}`);

    await prisma.aiLog.create({
      data: {
        orderId,
        status: "error",
        input: cleanNote,
        output: "",
        error: reason,
        processedAt: new Date(),
      },
    });

    return { error: true, reason };
  }
}

// ─── VisionAnalyzer: Gemini 3.1 Flash Lite Preview ─────────────────────────────

/**
 * Returns the condition as a safe VisionResult["condition"] value.
 * Maps "wrong item" / "wrong" to "wrong_item" to match the strict union.
 */
function normalizeCondition(value: unknown): VisionResult["condition"] {
  const raw = String(value).toLowerCase();
  if (raw === "damaged") return "damaged";
  if (raw === "used") return "used";
  if (raw === "wrong item" || raw === "wrong_item" || raw === "wrong item received") return "wrong_item";
  if (raw === "new") return "new";
  return "new"; // default safest assumption
}

export interface AnalyzeImageInput {
  /** Image as a plain base64 string (no data-URI prefix) */
  base64: string;
  /** MIME type of the image, e.g. "image/jpeg", "image/png" */
  mimeType?: string;
  orderId: string;
}

export async function analyzeReturnImage(
  input: AnalyzeImageInput | string,
): Promise<VisionResult | AiError> {
  const base64 = typeof input === "string" ? input : (input.base64 ?? "");
  const mimeType = typeof input === "string" ? "image/jpeg" : (input.mimeType ?? "image/jpeg");
  const orderId = typeof input === "string" ? input : (input.orderId ?? "");

  if (!base64) {
    return { error: true, reason: "No image data provided — supply a base64 string" };
  }

  if (!orderId) {
    return { error: true, reason: "orderId is required" };
  }

  const { geminiApiKey, geminiEndpoint } = getConfig();

  if (!geminiApiKey) {
    return manualReviewResult("Gemini API key not configured (GEMINI_API_KEY)");
  }

  const visionPrompt = `You are a return inspection expert analyzing a product image.
Inspect the product carefully and respond with ONLY a valid JSON object — no markdown, no explanation.
Classify the product into exactly ONE of these four categories:
  1. "damaged"   — the product shows visible physical damage, scratches, dents, or defects
  2. "used"      — the product shows signs of use (opened packaging, wear, fingerprints, etc.) but is not physically damaged
  3. "wrong_item" — the product received does not match what was ordered (wrong size, color, model, etc.)
  4. "new"       — the product appears brand new, sealed or in perfect condition with no signs of use

Schema: { "condition": "damaged|used|wrong_item|new", "confidence": 0.0-1.0, "reason": "one sentence explaining the classification" }`;

  const payload = {
    contents: [
      {
        role: "user",
        parts: [
          {
            inline_data: {
              mime_type: mimeType,
              data: base64,
            },
          },
          {
            text: visionPrompt,
          },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.2,
    },
  };

  let rawResponse = "";

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);

    const url = `${geminiEndpoint}?key=${geminiApiKey}`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Gemini HTTP ${response.status}: ${body}`);
    }

    const data = safeJsonParse(await response.json()) as {
      candidates?: Array<{
        content?: {
          parts?: Array<{ text?: string }>;
        };
      }>;
    };

    rawResponse = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

    if (!rawResponse) {
      throw new Error("Gemini returned an empty response");
    }

    const parsed = extractJson(rawResponse);

    const result: VisionResult = {
      condition: normalizeCondition(parsed.condition),
      confidence: normalizeConfidence(parsed.confidence),
      reason: parsed.reason ? String(parsed.reason) : "Classification completed.",
    };

    await prisma.aiLog.create({
      data: {
        orderId,
        status: "vision_success",
        input: `image (${mimeType}, ${Math.round(base64.length * 0.75)} bytes)`,
        output: JSON.stringify(result),
        error: "",
        processedAt: new Date(),
      },
    });

    return result;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);

    if (reason === "The user aborted a request.") {
      return manualReviewResult(`Gemini request timed out after ${GEMINI_TIMEOUT_MS / 1000}s`);
    }

    await prisma.aiLog.create({
      data: {
        orderId,
        status: "vision_error",
        input: `image (${mimeType}, ${Math.round(base64.length * 0.75)} bytes)`,
        output: rawResponse,
        error: reason,
        processedAt: new Date(),
      },
    });

    return manualReviewResult(reason);
  }
}

function manualReviewResult(failureReason: string): VisionResult {
  return {
    condition: "new",
    confidence: 0,
    reason: `Manual Review Required — ${failureReason}`,
  };
}

// ─── AIProvider factory (public API) ──────────────────────────────────────────

export interface AIProvider {
  text: typeof analyzeOrderNote;
  vision: typeof analyzeReturnImage;
}

export function createAIProvider(): AIProvider {
  return {
    text: analyzeOrderNote,
    vision: analyzeReturnImage,
  };
}
