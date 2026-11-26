import "server-only";

export const GEMINI_DEFAULT_MODEL = "gemini-3.8-flash";
export const GEMINI_DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/";

export type GeminiConfig = { apiKey: string; model: string; baseUrl: string };

export function getGeminiConfig(): GeminiConfig {
  throw new Error("not implemented");
}
