const DOUBAO_BASE_URL =
  process.env.DOUBAO_BASE_URL || "https://ark.cn-beijing.volces.com/api/v3";
const DOUBAO_API_KEY = process.env.DOUBAO_API_KEY || "";
const DOUBAO_MODEL = process.env.DOUBAO_MODEL || "ep-20260115140805-6nxf5";

const DEFAULT_PROMPT = `请分析这张图片。如果是错误截图，请识别错误类型、错误信息、可能原因和修复建议。如果是其他类型图片，请描述主要内容并给出相关判断。`;

export interface VisionResult {
  description: string;
  labels: string[];
  confidence: number;
}

export async function analyzeImage(
  imageBase64: string,
  prompt?: string
): Promise<VisionResult> {
  if (!DOUBAO_API_KEY) {
    return {
      description: "",
      labels: [],
      confidence: 0,
    };
  }

  const imageData = imageBase64.startsWith("data:")
    ? imageBase64.split(",")[1]
    : imageBase64;

  try {
    const response = await fetch(`${DOUBAO_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${DOUBAO_API_KEY}`,
      },
      body: JSON.stringify({
        model: DOUBAO_MODEL,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt || DEFAULT_PROMPT },
              {
                type: "image_url",
                image_url: {
                  url: `data:image/jpeg;base64,${imageData}`,
                  detail: "high",
                },
              },
            ],
          },
        ],
        max_tokens: 1024,
        temperature: 0.5,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Doubao API ${response.status}: ${errorBody}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content ?? "";

    return {
      description: content,
      labels: [],
      confidence: 1.0,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      description: "",
      labels: [],
      confidence: 0,
    };
  }
}
