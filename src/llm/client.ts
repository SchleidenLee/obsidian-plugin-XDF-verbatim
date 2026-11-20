import { requestUrl } from "obsidian";

import type { ChatMessage, LlmSettings } from "../types";

export interface LlmHttpAdapter {
	(req: {
		url: string;
		method: "POST";
		headers: Record<string, string>;
		body: string;
	}): Promise<{ status: number; text: string }>;
}

export interface LlmChatResult {
	content: string;
	/** finish_reason 为 length，输出疑似被截断 */
	truncated: boolean;
}

export interface LlmClient {
	chat(
		messages: ChatMessage[],
		opts?: { temperature?: number; maxTokens?: number; signal?: AbortSignal },
	): Promise<LlmChatResult>;
}

const requestUrlAdapter: LlmHttpAdapter = async (req) => {
	const res = await requestUrl({
		url: req.url,
		method: req.method,
		headers: req.headers,
		body: req.body,
		throw: false,
	});
	return { status: res.status, text: res.text };
};

function buildEndpoint(baseUrl: string): string {
	return `${baseUrl.trim().replace(/\/+$/, "")}/chat/completions`;
}

function extractContent(text: string): LlmChatResult {
	let payload: unknown;
	try {
		payload = JSON.parse(text);
	} catch {
		throw new Error(`LLM 响应不是合法 JSON：${text.slice(0, 500)}`);
	}

	const choices = (payload as { choices?: unknown })?.choices;
	if (!Array.isArray(choices) || choices.length === 0) {
		throw new Error(`LLM 响应缺少 choices：${text.slice(0, 500)}`);
	}

	const choice = choices[0] as {
		message?: { content?: unknown };
		finish_reason?: unknown;
	};
	const content = choice?.message?.content;
	if (typeof content !== "string" || content.trim() === "") {
		throw new Error(`LLM 返回内容为空：${text.slice(0, 500)}`);
	}
	return { content, truncated: choice.finish_reason === "length" };
}

export function createLlmClient(settings: LlmSettings, http?: LlmHttpAdapter): LlmClient {
	const adapter = http ?? requestUrlAdapter;

	return {
		async chat(messages, opts) {
			const body: Record<string, unknown> = {
				model: settings.model,
				messages,
				temperature: opts?.temperature ?? 0.3,
			};
			if (opts?.maxTokens) {
				body.max_tokens = opts.maxTokens;
			}

			const res = await adapter({
				url: buildEndpoint(settings.baseUrl),
				method: "POST",
				headers: {
					Authorization: `Bearer ${settings.apiKey}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify(body),
			});

			if (res.status < 200 || res.status >= 300) {
				throw new Error(
					`LLM 请求失败（HTTP ${res.status}）：${(res.text ?? "").slice(0, 500)}`,
				);
			}

			return extractContent(res.text ?? "");
		},
	};
}
