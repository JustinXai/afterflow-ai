import prisma from "~/db.server";

const DEEPSEEK_BASE_URL =
  process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || "";

const FEATURE_ENABLED =
  process.env.AF_PCD_APPROVED === "true" &&
  Boolean(DEEPSEEK_API_KEY) &&
  DEEPSEEK_API_KEY !== "your_deepseek_api_key_here";

const SYSTEM_PROMPT = `You are an e-commerce expert. Analyze the customer note: [note]. Return a JSON with: { "urgency": "low/medium/high", "tags": ["tag1", "tag2"], "summary": "short summary" }`;

function extractJson(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  const match = trimmed.match(/```(?:json)?\s*([\s\S]*?)```$/);
  return JSON.parse(match ? match[1].trim() : trimmed);
}

export interface AnalyzeResult {
  urgency: string;
  tags: string[];
  summary: string;
}

export async function analyzeOrderNote(
  note: string,
  orderId: string
): Promise<AnalyzeResult> {
  if (!note || note.trim() === "") {
    return { urgency: "low", tags: ["no_action"], summary: "No note provided" };
  }

  if (!FEATURE_ENABLED) {
    return { urgency: "low", tags: ["disabled"], summary: "AfterFlow AI is not active (AF_PCD_APPROVED != true or missing DeepSeek key)" };
  }

  const input = note;

  try {
    const response = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          { role: "system", content: SYSTEM_PROMPT.replace("[note]", input) },
          { role: "user", content: input },
        ],
        temperature: 0.3,
        max_tokens: 200,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`DeepSeek API ${response.status}: ${errorBody}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content ?? "";
    const parsed = extractJson(content) as {
      urgency?: unknown;
      tags?: unknown;
      summary?: unknown;
    };

    const result: AnalyzeResult = {
      urgency:
        parsed.urgency === "low" ||
        parsed.urgency === "medium" ||
        parsed.urgency === "high"
          ? String(parsed.urgency)
          : "low",
      tags: Array.isArray(parsed.tags)
        ? parsed.tags.filter((t) => typeof t === "string").map((t) => String(t))
        : [],
      summary: parsed.summary ? String(parsed.summary) : input.slice(0, 120),
    };

    await prisma.orderAnalysis.upsert({
      where: { orderId },
      update: {
        originalNote: input,
        urgency: result.urgency,
        tags: JSON.stringify(result.tags),
        summary: result.summary,
      },
      create: {
        orderId,
        originalNote: input,
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
        input,
        output: JSON.stringify(result),
        error: "",
        processedAt: new Date(),
      },
    });

    return result;
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);

    await prisma.aiLog.create({
      data: {
        orderId,
        status: "error",
        input,
        output: "",
        error: errMsg,
        processedAt: new Date(),
      },
    });

    return { urgency: "low", tags: ["error"], summary: input.slice(0, 120) };
  }
}
