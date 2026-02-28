import type { ModelTokens } from "./types";

/**
 * Claude API 料金テーブル (USD per 1M tokens)
 * https://www.anthropic.com/pricing
 */
const PRICING: Record<string, { input: number; output: number; cacheWrite: number; cacheRead: number }> = {
	"claude-opus-4-6": { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 },
	"claude-sonnet-4-6": { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
	"claude-haiku-4-5": { input: 0.8, output: 4, cacheWrite: 1, cacheRead: 0.08 },
};

const DEFAULT_PRICING = { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 };

function normalizeModel(model: string): string {
	// "claude-opus-4-6-20260301" → "claude-opus-4-6"
	return model.replace(/-\d{8}$/, "");
}

export function estimateCost(model: string, tokens: ModelTokens): number {
	const normalized = normalizeModel(model);
	const pricing = PRICING[normalized] ?? DEFAULT_PRICING;
	const perMillion = 1_000_000;

	return (
		(tokens.inputTokens * pricing.input) / perMillion +
		(tokens.outputTokens * pricing.output) / perMillion +
		(tokens.cacheCreationTokens * pricing.cacheWrite) / perMillion +
		(tokens.cacheReadTokens * pricing.cacheRead) / perMillion
	);
}
