/**
 * 会话持久化：data.json 读写、设置默认值合并、状态文案。
 *
 * data.json 形状：`{ settings: VerbatimSettings; session: Session | null }`
 * 注意：绑定关系（Binding）只存在面板内存，不写入这里。
 */
import { DEFAULT_SETTINGS } from "./settings";
import type { Session, SessionState, VerbatimSettings } from "./types";

export interface PersistedData {
	settings: VerbatimSettings;
	session: Session | null;
}

const SESSION_STATES: SessionState[] = [
	"idle",
	"recorded",
	"uploading",
	"transcribing",
	"transcribed",
	"organizing",
	"organized",
	"writing",
	"done",
	"error",
];

/** 新会话：音频已落盘，尚未转写 / 整理 */
export function createEmptySession(audioPath: string, audioHash: string): Session {
	return {
		audioPath,
		audioHash,
		orderId: null,
		signatureRandom: null,
		state: "recorded",
		transcript: "",
		draft: "",
		error: null,
	};
}

/**
 * 与 DEFAULT_SETTINGS 做两层深合并（xunfei / llm）。
 * 旧 data.json 缺键时回落默认值；已存在但为空的字符串保留原样（用户可能有意清空）。
 */
export function mergeSettings(raw: unknown): VerbatimSettings {
	const source = asRecord(raw);
	const xunfei = asRecord(source.xunfei);
	const llm = asRecord(source.llm);

	return {
		xunfei: {
			endpoint: readString(xunfei.endpoint, DEFAULT_SETTINGS.xunfei.endpoint),
			appId: readString(xunfei.appId, DEFAULT_SETTINGS.xunfei.appId),
			apiKey: readString(xunfei.apiKey, DEFAULT_SETTINGS.xunfei.apiKey),
			apiSecret: readString(xunfei.apiSecret, DEFAULT_SETTINGS.xunfei.apiSecret),
			timeoutSeconds: readNumber(xunfei.timeoutSeconds, DEFAULT_SETTINGS.xunfei.timeoutSeconds),
			pollIntervalSeconds: readNumber(
				xunfei.pollIntervalSeconds,
				DEFAULT_SETTINGS.xunfei.pollIntervalSeconds
			),
		},
		llm: {
			baseUrl: readString(llm.baseUrl, DEFAULT_SETTINGS.llm.baseUrl),
			apiKey: readString(llm.apiKey, DEFAULT_SETTINGS.llm.apiKey),
			model: readString(llm.model, DEFAULT_SETTINGS.llm.model),
		},
	};
}

/** 从 data.json 的原始内容恢复设置与会话；结构不合法时降级为默认值 / 无会话 */
export function loadPersistedData(raw: unknown): PersistedData {
	const source = asRecord(raw);
	return {
		settings: mergeSettings(source.settings),
		session: normalizeSession(source.session),
	};
}

/** 状态 → 面板展示用中文文案 */
export function describeState(state: SessionState): string {
	switch (state) {
		case "idle":
			return "空闲";
		case "recorded":
			return "已录音，待转写";
		case "uploading":
			return "上传音频中";
		case "transcribing":
			return "转写中";
		case "transcribed":
			return "转写完成，待整理";
		case "organizing":
			return "整理中";
		case "organized":
			return "整理完成，待写入";
		case "writing":
			return "写入中";
		case "done":
			return "已完成";
		case "error":
			return "出错";
		default:
			return "未知状态";
	}
}

/** 缺 audioPath 的会话没有意义，直接丢弃 */
function normalizeSession(raw: unknown): Session | null {
	const source = asRecord(raw);
	const audioPath = readString(source.audioPath, "");
	if (!audioPath) return null;

	return {
		audioPath,
		audioHash: readString(source.audioHash, ""),
		orderId: readNullableString(source.orderId),
		signatureRandom: readNullableString(source.signatureRandom),
		state: isSessionState(source.state) ? source.state : "recorded",
		transcript: readString(source.transcript, ""),
		draft: readString(source.draft, ""),
		error: readNullableString(source.error),
	};
}

function isSessionState(value: unknown): value is SessionState {
	return typeof value === "string" && (SESSION_STATES as string[]).includes(value);
}

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function readString(value: unknown, fallback: string): string {
	return typeof value === "string" ? value : fallback;
}

function readNullableString(value: unknown): string | null {
	return typeof value === "string" && value.length > 0 ? value : null;
}

/** 非负有限数字才采用；<=0 交给 provider 走其内置默认值 */
function readNumber(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}
