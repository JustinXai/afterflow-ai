import prisma from "~/db.server";
import { getConfig } from "~/utils/config.server";

// ─── Shared constants ──────────────────────────────────────────────────────────

const TIMEOUT_MS = 10_000;

// ─── Result types ─────────────────────────────────────────────────────────────

export interface AnalyzeResult {
  urgency: string;
  tags: string[];
  summary: string;
  error?: false;
}

export interface VisionResult {
  condition: "new" | "used" | "damaged" | "missing" | "unclear";
  ocrText: string;
  detectedIssues: string[];
  confidence: number;
  summary: string;
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

  let rawResponse: string = "";

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

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
      return { error: true, reason: "DeepSeek request timed out after 10s" };
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

// ─── VisionAnalyzer: Doubao (ByteDance Ark) ───────────────────────────────────

const VISION_SYSTEM_PROMPT = `You are a return inspection expert.
Analyze the provided image(s) of a returned item.
Respond with ONLY a valid JSON object — no markdown, no explanation.
Schema: {
  "condition": "new|used|damaged|missing|unclear",
  "ocrText": "verbatim text found in image",
  "detectedIssues": ["issue1", "issue2"],
  "confidence": 0.0-1.0,
  "summary": "one sentence describing the overall condition"
}`;

interface DoubaoMessage {
  role: "system" | "user";
  content: Array<{
    type: "text" | "image_url";
    text?: string;
    image_url?: { url: string };
  }>;
}

function buildVisionResult(
  parsed: Record<string, unknown>,
  ocrFallback: string,
): VisionResult {
  const validConditions = ["new", "used", "damaged", "missing", "unclear"];
  const condition = validConditions.includes(String(parsed.condition))
    ? (String(parsed.condition) as VisionResult["condition"])
    : "unclear";

  const detectedIssues = Array.isArray(parsed.detectedIssues)
    ? parsed.detectedIssues.filter((i) => typeof i === "string").map(String)
    : [];

  const confidence = typeof parsed.confidence === "number"
    ? Math.max(0, Math.min(1, parsed.confidence))
    : 0.5;

  const summary = parsed.summary
    ? String(parsed.summary)
    : `${condition} condition detected`;

  return {
    condition,
    ocrText: parsed.ocrText ? String(parsed.ocrText) : ocrFallback,
    detectedIssues,
    confidence,
    summary,
  };
}

export interface AnalyzeImageInput {
  imageUrl?: string;
  base64Image?: string;
  mimeType?: string;
  orderId: string;
}

export async function analyzeReturnImage(
  input: AnalyzeImageInput,
): Promise<VisionResult | AiError> {
  const { imageUrl, base64Image, mimeType = "image/jpeg", orderId } = input;

  if (!imageUrl && !base64Image) {
    return { error: true, reason: "No image provided — supply imageUrl or base64Image" };
  }

  const { doubaoApiKey, doubaoEndpointId, doubaoBaseUrl } = getConfig();

  if (!doubaoApiKey) {
    return { error: true, reason: "Doubao API key not configured (DOUBAO_API_KEY)" };
  }

  if (!doubaoEndpointId) {
    return { error: true, reason: "Doubao endpoint ID not configured (DOUBAO_ENDPOINT_ID)" };
  }

  const imageContent: { type: "image_url"; image_url: { url: string } } = {
    type: "image_url",
    image_url: {
      url: base64Image
        ? `data:${mimeType};base64,${base64Image}`
        : imageUrl!,
    },
  };

  const messages: DoubaoMessage[] = [
    { role: "system", content: [{ type: "text", text: VISION_SYSTEM_PROMPT }] },
    {
      role: "user",
      content: [
        imageContent,
        { type: "text", text: "Inspect this return item image and report its condition." },
      ],
    },
  ];

  let rawResponse = "";

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const endpoint = `${doubaoBaseUrl}/chat/completions?endpoint_id=${doubaoEndpointId}`;

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${doubaoApiKey}`,
      },
      body: JSON.stringify({
        model: doubaoEndpointId,
        messages,
        max_tokens: 400,
        temperature: 0.2,
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Doubao HTTP ${response.status}: ${body}`);
    }

    const data = safeJsonParse(await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    rawResponse = data?.choices?.[0]?.message?.content ?? "";
    const parsed = extractJson(rawResponse);
    const result = buildVisionResult(parsed, "");

    await prisma.aiLog.create({
      data: {
        orderId,
        status: "vision_success",
        input: `image: ${imageUrl ?? "[base64]"}`,
        output: JSON.stringify(result),
        error: "",
        processedAt: new Date(),
      },
    });

    return result;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);

    if (reason === "The user aborted a request.") {
      return { error: true, reason: "Doubao vision request timed out after 10s" };
    }

    await prisma.aiLog.create({
      data: {
        orderId,
        status: "vision_error",
        input: `image: ${imageUrl ?? "[base64]"}`,
        output: rawResponse,
        error: reason,
        processedAt: new Date(),
      },
    });

    return { error: true, reason };
  }
}

// ─── AIProvider factory (public API) ──────────────────────────────────────────
// Use this factory when you need a unified interface. Individual analyzers above
// can also be called directly for more control.

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
