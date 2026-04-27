let cachedConfig: AiServiceConfig | null = null;

export interface AiServiceConfig {
  deepseekApiKey: string;
  deepseekBaseUrl: string;
  doubaoApiKey: string | null;
  doubaoModel: string;
  doubaoEndpointId: string;
  doubaoBaseUrl: string;
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
    doubaoApiKey: process.env.DOUBAO_API_KEY ?? null,
    doubaoModel: process.env.DOUBAO_MODEL || "ep-20260115140805-6nxf5",
    doubaoEndpointId: process.env.DOUBAO_ENDPOINT_ID ?? null,
    doubaoBaseUrl: process.env.DOUBAO_BASE_URL || "https://ark.cn-beijing.volces.com/api/v3",
  };
}

export function getConfig(): AiServiceConfig {
  if (!cachedConfig) {
    cachedConfig = validateConfig();
  }
  return cachedConfig;
}
