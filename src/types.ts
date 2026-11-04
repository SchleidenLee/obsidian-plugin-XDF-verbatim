import type { TFile } from "obsidian";

/** 文档类型：必须与例会文件夹内的实际文件名一致 */
export type DocType = "会议记录" | "教研笔记";

export const DOC_TYPES: DocType[] = ["会议记录", "教研笔记"];

/** 录音与音频文件的落地子目录名（由本插件创建） */
export const ATTACHMENT_DIR = "attachment";

/** 例会文件夹名规则：`YYYY-MM-DD 第N次例会` */
export const MEETING_FOLDER_RE = /^\d{4}-\d{2}-\d{2} 第\d+次例会$/;

/** 面板内临时绑定关系，不持久化，重启即失效 */
export interface Binding {
	/** 要写回的笔记：会议记录.md 或 教研笔记.md */
	targetFile: TFile;
	/** 所属例会文件夹路径 */
	meetingFolder: string;
	/** `{meetingFolder}/attachment` */
	attachmentDir: string;
	/** 音频基础名：`2026-11-05 会议记录` */
	audioBaseName: string;
	docType: DocType;
}

export type SessionState =
	| "idle"
	| "recorded"
	| "uploading"
	| "transcribing"
	| "transcribed"
	| "organizing"
	| "organized"
	| "writing"
	| "done"
	| "error";

/** 持久化到 data.json 的转写会话（不含绑定关系） */
export interface Session {
	/** 音频在 vault 内的路径 */
	audioPath: string;
	/** 音频 SHA-256，用于命中缓存 */
	audioHash: string;
	orderId: string | null;
	signatureRandom: string | null;
	state: SessionState;
	/** 转写原文（面板可编辑） */
	transcript: string;
	/** LLM 整理稿 */
	draft: string;
	error: string | null;
}

export interface TranscriptSegment {
	speaker: string;
	text: string;
	startMs: number;
	endMs: number;
}

export interface TranscriptResult {
	text: string;
	segments: TranscriptSegment[];
	raw: unknown;
}

export interface TranscribeOptions {
	audio: ArrayBuffer;
	fileName: string;
	/** 发言人分离：roleType=1 */
	enableDiarization: boolean;
	onProgress?: (label: string) => void;
	signal?: AbortSignal;
}

export interface TranscriptionProvider {
	transcribe(opts: TranscribeOptions): Promise<TranscriptResult>;
}

/** 录音器抽象，便于面板与实现解耦 */
export interface Recorder {
	isRecording(): boolean;
	isPaused(): boolean;
	isActive(): boolean;
	start(deviceId?: string): Promise<void>;
	pause(): void;
	resume(): void;
	/** 停止并返回 webm Blob；未在录音时返回空 Blob */
	stop(): Promise<Blob>;
	abort(): void;
	getMimeType(): string;
}

export interface XunfeiSettings {
	endpoint: string;
	appId: string;
	apiKey: string;
	apiSecret: string;
	timeoutSeconds: number;
	pollIntervalSeconds: number;
}

export interface LlmSettings {
	/** OpenAI 兼容 baseUrl，如 http://127.0.0.1:8181/v1 */
	baseUrl: string;
	apiKey: string;
	model: string;
}

export interface VerbatimSettings {
	xunfei: XunfeiSettings;
	llm: LlmSettings;
}

export interface ChatMessage {
	role: "system" | "user" | "assistant";
	content: string;
}
