let cachedConfig: AiServiceConfig | null = null;

export interface AiServiceConfig {
  deepseekApiKey: string;
  deepseekBaseUrl: string;
  geminiApiKey: string | null;
  geminiEndpoint: string;
}

function validateConfig(): AiServiceConfig {
  const deepseekApiKey = process.env.DEEPSEEK_API_KEY;
  if (!deepseekApiKey) {
    throw new Error(
      "[config] DEEPSEEK_API_KEY 未设置。请在 .env 文件中添加 DEEPSEEK_API_KEY，App 无法启动。"
    );
  }

  return {
    deepseekApiKey,
    deepseekBaseUrl: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
    geminiApiKey: process.env.GEMINI_API_KEY ?? null,
    geminiEndpoint:
      process.env.GEMINI_ENDPOINT ||
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent",
  };
}

export function getConfig(): AiServiceConfig {
  if (!cachedConfig) {
    cachedConfig = validateConfig();
  }
  return cachedConfig;
}
