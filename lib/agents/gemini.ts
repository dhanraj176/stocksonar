import "server-only";
import { ReportWriterError } from "./report-writer-error";

/**
 * The one place the Gemini model is named. Override with GEMINI_MODEL. Flash-Lite, because
 * gemini-3.8-flash returned HTTP 503 (high demand) and timeouts on the free tier.
 */
export const GEMINI_DEFAULT_MODEL = "gemini-3.5-flash-lite";
/** Gemini's OpenAI-compatible endpoint. Override with GEMINI_BASE_URL (https only). */
export const GEMINI_DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/";

export type GeminiConfig = { apiKey: string; model: string; baseUrl: string };

/**
 * Reads Gemini's settings from env on each call (not at import, so builds and tests need no key).
 * "server-only" keeps this module, and the key, out of the browser. Errors never echo values.
 */
export function getGeminiConfig(): GeminiConfig {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new ReportWriterError("config", "GEMINI_API_KEY must be set to write reports with Gemini.");
  }
  const model = process.env.GEMINI_MODEL?.trim() || GEMINI_DEFAULT_MODEL;
  const baseUrl = process.env.GEMINI_BASE_URL?.trim() || GEMINI_DEFAULT_BASE_URL;
  if (!isHttpsUrl(baseUrl)) {
    throw new ReportWriterError("config", "GEMINI_BASE_URL must be an https URL.");
  }
  return { apiKey, model, baseUrl };
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}
