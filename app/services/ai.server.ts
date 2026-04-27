import prisma from "../db.server";
import { getConfig } from "../utils/config.server";

// ─── Shared constants ──────────────────────────────────────────────────────────

const DEEPSEEK_TIMEOUT_MS = 10_000;
const GEMINI_TIMEOUT_MS = 5_000;

// ─── Result types ─────────────────────────────────────────────────────────────

export interface AnalyzeResult {
  urgency: string;
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

const TEXT_SYSTEM_PROMPT = `You are an e-commerce expert analyzing a customer order note.
Respond with ONLY a valid JSON object — no markdown, no explanation.
Schema: { "urgency": "low|medium|high", "tags": ["tag1", "tag2"], "summary": "one sentence" }`;

function buildTextResult(
  parsed: Record<string, unknown>,
  note: string,
): AnalyzeResult {
  const urgency =
    parsed.urgency === "low" ||
    parsed.urgency === "medium" ||
    parsed.urgency === "high"
      ? String(parsed.urgency)
      : "low";

  const tags = Array.isArray(parsed.tags)
    ? parsed.tags.filter((t) => typeof t === "string").map((t) => String(t))
    : [];

  const summary = parsed.summary
    ? String(parsed.summary)
    : note.slice(0, 120);

  return { urgency, tags, summary };
}

export async function analyzeOrderNote(
  note: string,
  orderId: string,
): Promise<AnalyzeResult | AiError> {
  const cleanNote = (note ?? "").trim();

  if (!cleanNote) {
    return { urgency: "low", tags: ["no_action"], summary: "No note provided" };
  }

  const { deepseekApiKey, deepseekBaseUrl } = getConfig();

  if (!deepseekApiKey || deepseekApiKey === "your_deepseek_api_key_here") {
    return { error: true, reason: "DeepSeek key not configured" };
  }

  let rawResponse = "";

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
          { role: "system", content: TEXT_SYSTEM_PROMPT },
          { role: "user", content: cleanNote },
        ],
        temperature: 0.3,
        max_tokens: 200,
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`DeepSeek HTTP ${response.status}: ${body}`);
    }

    const data = safeJsonParse(await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    rawResponse = data?.choices?.[0]?.message?.content ?? "";

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

    if (reason === "The user aborted a request.") {
      return { error: true, reason: `DeepSeek request timed out after ${DEEPSEEK_TIMEOUT_MS / 1000}s` };
    }

    await prisma.aiLog.create({
      data: {
        orderId,
        status: "error",
        input: cleanNote,
        output: rawResponse,
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
