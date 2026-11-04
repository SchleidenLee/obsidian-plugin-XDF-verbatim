/**
 * 科大讯飞「录音文件转写大模型」provider。
 *
 * 流程：/v2/upload 上传原始音频 → 轮询 /v2/getResult 取结果 → 解析 lattice 段落。
 * HTTP 层通过 HttpAdapter 注入：默认走 Obsidian 的 requestUrl，测试时可换成 Node fetch。
 *
 * 签名约定（实测，2026-11）：
 * - HMAC-SHA1，key = apiSecret 原始 UTF-8 字符串（不做 base64 解码），结果 base64
 * - 参与签名参数按 key 字典序排序，值 encodeURIComponent 后把 %20 换成 +，用 & 连接
 * - 空值参数不参与签名
 * - 上传时生成 16 位 signatureRandom，轮询全程复用同一个值
 */
import { requestUrl } from "obsidian";
import type {
	TranscribeOptions,
	TranscriptionProvider,
	TranscriptResult,
	TranscriptSegment,
	XunfeiSettings,
} from "../types";
import { hmacSha1Base64, randomAlphaNumeric } from "../util/crypto";

const DEFAULT_ENDPOINT = "https://office-api-ist-dx.iflyaisol.com";
const UPLOAD_PATH = "/v2/upload";
const GET_RESULT_PATH = "/v2/getResult";
/** 讯飞录音文件转写的音频上限 */
const MAX_FILE_BYTES = 500 * 1024 * 1024;
/** 固定值：写 autodetect 会返回 100020 */
const LANGUAGE = "autodialect";
const SUCCESS_CODE = "000000";
const DEFAULT_TIMEOUT_SECONDS = 600;
const DEFAULT_POLL_INTERVAL_SECONDS = 10;

export interface HttpRequest {
	url: string;
	method: "POST";
	headers: Record<string, string>;
	body: string | ArrayBuffer;
}

export interface HttpResponse {
	status: number;
	text: string;
}

/** HTTP 适配器：默认用 Obsidian requestUrl，测试时注入 Node fetch */
export type HttpAdapter = (req: HttpRequest) => Promise<HttpResponse>;

/** 默认适配器：requestUrl 返回 { status, text }，不支持流式响应 */
const requestUrlAdapter: HttpAdapter = async (req) => {
	const response = await requestUrl({
		url: req.url,
		method: req.method,
		headers: req.headers,
		body: req.body,
		throw: false,
	});
	return { status: response.status, text: response.text };
};

export function createXunfeiProvider(
	settings: XunfeiSettings,
	http: HttpAdapter = requestUrlAdapter
): TranscriptionProvider {
	return {
		async transcribe(opts: TranscribeOptions): Promise<TranscriptResult> {
			assertSettings(settings);
			assertAudio(opts);

			const timeoutSeconds =
				settings.timeoutSeconds > 0 ? settings.timeoutSeconds : DEFAULT_TIMEOUT_SECONDS;
			const pollIntervalSeconds =
				settings.pollIntervalSeconds > 0 ? settings.pollIntervalSeconds : DEFAULT_POLL_INTERVAL_SECONDS;

			// signatureRandom 只生成一次，上传与轮询全程复用
			const signatureRandom = randomAlphaNumeric(16);
			const uploadParams: Record<string, string> = {
				appId: settings.appId.trim(),
				accessKeyId: settings.apiKey.trim(),
				dateTime: formatDateTimeWithOffset(new Date()),
				signatureRandom,
				fileSize: String(opts.audio.byteLength),
				fileName: opts.fileName.trim(),
				language: LANGUAGE,
				durationCheckDisable: "true",
			};
			if (opts.enableDiarization) uploadParams.roleType = "1";

			opts.onProgress?.(`上传音频（${formatMegabytes(opts.audio.byteLength)} MB）…`);
			const uploadResponse = await signedPost(
				http,
				settings,
				UPLOAD_PATH,
				uploadParams,
				"application/octet-stream",
				opts.audio,
				"上传",
				opts.signal
			);
			const uploadJson = parseJsonResponse(uploadResponse, "上传");
			const uploadCode = readCode(uploadJson.code);
			if (uploadCode !== SUCCESS_CODE) {
				throw new Error(
					`讯飞上传失败（code ${uploadCode || "unknown"}）：${readString(uploadJson.descInfo) || "未返回错误描述"}`
				);
			}
			const orderId = readString(asRecord(uploadJson.content).orderId);
			if (!orderId) {
				throw new Error("讯飞上传失败：响应中缺少 orderId。");
			}

			const startedAt = Date.now();
			for (;;) {
				throwIfAborted(opts.signal, "转写");

				const pollParams: Record<string, string> = {
					accessKeyId: settings.apiKey.trim(),
					dateTime: formatDateTimeWithOffset(new Date()),
					signatureRandom,
					orderId,
					resultType: "transfer",
				};
				const pollResponse = await signedPost(
					http,
					settings,
					GET_RESULT_PATH,
					pollParams,
					"application/json",
					"{}",
					"getResult",
					opts.signal
				);
				const pollJson = parseJsonResponse(pollResponse, "getResult");
				const code = readCode(pollJson.code);

				if (code === SUCCESS_CODE) {
					const content = asRecord(pollJson.content);
					const orderInfo = asRecord(content.orderInfo);
					const status = readNumber(orderInfo.status);

					if (status === 4) {
						return normalizeResult(content, pollJson, orderId, signatureRandom);
					}
					if (status === -1) {
						const failType =
							readString(orderInfo.failType) || String(readNumber(orderInfo.failType) ?? "");
						throw new Error(
							`讯飞转写失败${failType ? `（failType ${failType}）` : ""}：${
								readString(orderInfo.failReason) || "服务端未返回失败原因"
							}`
						);
					}
					opts.onProgress?.(`转写中…（status ${status ?? "unknown"}）`);
				} else if (code === "100012" || code === "100013") {
					// 任务处理中 / 排队中，继续等待
					opts.onProgress?.("转写排队中…");
				} else {
					throw new Error(
						`讯飞 getResult 失败（code ${code || "unknown"}）：${
							readString(pollJson.descInfo) || "未返回错误描述"
						}`
					);
				}

				if (Date.now() - startedAt > timeoutSeconds * 1000) {
					throw new Error(`讯飞转写超时：已等待 ${timeoutSeconds} 秒（orderId ${orderId}）。`);
				}

				await sleep(pollIntervalSeconds * 1000, opts.signal);
			}
		},
	};
}

/** 参数校验：缺哪项说哪项 */
function assertSettings(settings: XunfeiSettings): void {
	const missing: string[] = [];
	if (!settings.appId?.trim()) missing.push("appId");
	if (!settings.apiKey?.trim()) missing.push("apiKey");
	if (!settings.apiSecret?.trim()) missing.push("apiSecret");
	if (missing.length > 0) {
		throw new Error(`讯飞配置不完整：缺少 ${missing.join("、")}。`);
	}
}

function assertAudio(opts: TranscribeOptions): void {
	if (!opts.audio || opts.audio.byteLength === 0) {
		throw new Error("讯飞上传失败：音频为空。");
	}
	if (opts.audio.byteLength > MAX_FILE_BYTES) {
		throw new Error(
			`讯飞上传失败：音频 ${formatMegabytes(opts.audio.byteLength)} MB 超过 500MB 上限（时长上限 5 小时）。`
		);
	}
	if (!opts.fileName?.trim()) {
		throw new Error("讯飞上传失败：缺少音频文件名（fileName）。");
	}
}

/** 发起带签名的 POST，并把网络层 / HTTP 层错误统一标成具体步骤 */
async function signedPost(
	http: HttpAdapter,
	settings: XunfeiSettings,
	path: string,
	params: Record<string, string>,
	contentType: string,
	body: string | ArrayBuffer,
	step: string,
	signal?: AbortSignal
): Promise<HttpResponse> {
	throwIfAborted(signal, step);

	const url = `${normalizeEndpoint(settings.endpoint)}${path}?${buildQuery(params)}`;
	const headers: Record<string, string> = {
		"Content-Type": contentType,
		signature: createSignature(settings, params),
	};

	let response: HttpResponse;
	try {
		response = await http({ url, method: "POST", headers, body });
	} catch (error) {
		throw new Error(`讯飞${step}请求失败：${describeError(error)}`);
	}

	if (response.status < 200 || response.status >= 300) {
		throw new Error(`讯飞${step}请求失败（HTTP ${response.status}）：${truncate(response.text)}`);
	}
	return response;
}

function createSignature(settings: XunfeiSettings, params: Record<string, string>): string {
	return hmacSha1Base64(settings.apiSecret.trim(), buildBaseString(params));
}

function buildBaseString(params: Record<string, string>): string {
	return sortedParamEntries(params)
		.filter(([, value]) => value !== "")
		.map(([key, value]) => `${key}=${urlEncodeForm(value)}`)
		.join("&");
}

function buildQuery(params: Record<string, string>): string {
	return sortedParamEntries(params)
		.map(([key, value]) => `${key}=${urlEncodeForm(value)}`)
		.join("&");
}

function sortedParamEntries(params: Record<string, string>): [string, string][] {
	return Object.entries(params)
		.filter(([key]) => key !== "signature")
		.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
}

function urlEncodeForm(value: string): string {
	return encodeURIComponent(value).replace(/%20/g, "+");
}

function normalizeEndpoint(value: string): string {
	const raw = value?.trim() || DEFAULT_ENDPOINT;
	const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
	try {
		const url = new URL(withScheme);
		url.pathname = "";
		url.search = "";
		url.hash = "";
		return url.toString().replace(/\/$/, "");
	} catch {
		throw new Error(`讯飞配置错误：endpoint 不是合法地址（${value}）。`);
	}
}

function parseJsonResponse(response: HttpResponse, step: string): Record<string, unknown> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(response.text);
	} catch {
		throw new Error(`讯飞${step}返回了非 JSON 内容：${truncate(response.text)}`);
	}
	if (!parsed || typeof parsed !== "object") {
		throw new Error(`讯飞${step}返回内容格式异常：${truncate(response.text)}`);
	}
	return parsed as Record<string, unknown>;
}

function normalizeResult(
	content: Record<string, unknown>,
	response: Record<string, unknown>,
	orderId: string,
	signatureRandom: string
): TranscriptResult {
	const parsed = safeJson(readString(content.orderResult));
	const segments = parseLatticeSegments(asRecord(parsed).lattice);
	const text = segments
		.map((segment) => segment.text)
		.filter(Boolean)
		.join("\n");

	return {
		text,
		segments,
		// 保留 orderId / signatureRandom，便于上层持久化后续查（如面板恢复会话）
		raw: { orderId, signatureRandom, response },
	};
}

/** orderResult → lattice[] → json_1best → st.rt[].ws[].cw[0].w */
function parseLatticeSegments(value: unknown): TranscriptSegment[] {
	if (!Array.isArray(value)) return [];

	const segments: TranscriptSegment[] = [];
	for (const item of value) {
		const jsonBest = safeJson(readString(asRecord(item).json_1best));
		const st = asRecord(asRecord(jsonBest).st);
		const text = extractText(st).trim();
		if (!text) continue;

		const speakerId = readString(st.rl);
		segments.push({
			speaker: speakerId && speakerId !== "0" ? `Speaker ${speakerId}` : "",
			text,
			startMs: readNumber(st.bg) ?? 0,
			endMs: readNumber(st.ed) ?? 0,
		});
	}

	return segments;
}

function extractText(st: Record<string, unknown>): string {
	const words: string[] = [];
	for (const rtItem of asArray(st.rt)) {
		for (const wsItem of asArray(asRecord(rtItem).ws)) {
			const first = asRecord(asArray(asRecord(wsItem).cw)[0]);
			const word = readString(first.w);
			const wordProperty = readString(first.wp);
			// wp === "g" 是噪音 / 语气词标记，不进正文
			if (!word || wordProperty === "g") continue;
			words.push(word);
		}
	}
	return words.join("");
}

/** yyyy-MM-dd'T'HH:mm:ss±HHmm（时区偏移不带冒号） */
function formatDateTimeWithOffset(date: Date): string {
	const offsetMinutes = -date.getTimezoneOffset();
	const sign = offsetMinutes >= 0 ? "+" : "-";
	const absoluteOffset = Math.abs(offsetMinutes);
	return (
		`${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}` +
		`T${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}` +
		`${sign}${pad2(Math.floor(absoluteOffset / 60))}${pad2(absoluteOffset % 60)}`
	);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(new Error("讯飞转写已取消。"));
			return;
		}
		const onAbort = () => {
			clearTimeout(timer);
			reject(new Error("讯飞转写已取消。"));
		};
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

function throwIfAborted(signal: AbortSignal | undefined, step: string): void {
	if (signal?.aborted) {
		throw new Error(`讯飞${step}已取消。`);
	}
}

function formatMegabytes(bytes: number): string {
	return (bytes / 1024 / 1024).toFixed(1);
}

function truncate(text: string): string {
	const limit = 500;
	return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function safeJson(text: string): unknown {
	if (!text.trim()) return {};
	try {
		return JSON.parse(text);
	} catch {
		return {};
	}
}

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

function readString(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function readCode(value: unknown): string {
	if (typeof value === "string") return value;
	if (typeof value === "number") return String(value);
	return "";
}

function readNumber(value: unknown): number | undefined {
	if (typeof value === "number") return Number.isNaN(value) ? undefined : value;
	if (typeof value === "string" && value.trim() !== "") {
		const parsed = Number(value);
		return Number.isNaN(parsed) ? undefined : parsed;
	}
	return undefined;
}

function pad2(value: number): string {
	return String(value).padStart(2, "0");
}
