/** 文件名中不允许出现的字符（Windows / Obsidian 通用） */
const ILLEGAL_FILENAME_CHARS = /[/\\:*?"<>|]/g;

/** ASCII 控制字符（\u0000-\u001F、\u007F） */
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

/**
 * 毫秒 → 时长文本。
 * 小于 1 小时返回 MM:SS；否则返回 H:MM:SS（小时不补零）。
 * 负数 / NaN 按 0 处理；秒数向下取整。
 */
export function formatDuration(ms: number): string {
	const totalSeconds = Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 1000)) : 0;
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;
	const pad = (value: number): string => value.toString().padStart(2, "0");

	if (hours > 0) return `${hours}:${pad(minutes)}:${pad(seconds)}`;
	return `${pad(minutes)}:${pad(seconds)}`;
}

/**
 * 已录时长（毫秒）= 已累计时长 + 当前分段已走过的时长。
 * 暂停时没有进行中的分段，segmentStartedAt 传 null，只返回累计时长。
 * 分段起止时间异常（时钟回拨 / NaN）时退回累计时长，避免出现负数。
 */
export function recordedMs(accumulatedMs: number, segmentStartedAt: number | null, now: number): number {
	const base = Number.isFinite(accumulatedMs) ? Math.max(0, accumulatedMs) : 0;
	if (segmentStartedAt === null) return base;
	if (!Number.isFinite(segmentStartedAt) || !Number.isFinite(now)) return base;
	return base + Math.max(0, now - segmentStartedAt);
}

/**
 * 清理文件名：去掉 / \ : * ? " < > | 与控制字符，压缩连续空格并 trim。
 * 注意：若输入全是非法字符，结果可能为空字符串，调用方需自行兜底。
 */
export function sanitizeFileName(name: string): string {
	return name
		.replace(ILLEGAL_FILENAME_CHARS, "")
		.replace(CONTROL_CHARS, "")
		.replace(/ {2,}/g, " ")
		.trim();
}

/**
 * 音频基础名：`yyyy-MM-dd 类型`，例如 `2026-11-05 会议记录`。
 * 使用本地时区取年月日（与用户看到的日历一致），月/日补零。
 * 第二个参数是 PromptSpec.displayName（中文），因为它直接用于文件名展示。
 */
export function buildAudioBaseName(date: Date, docType: string): string {
	const year = date.getFullYear();
	const month = (date.getMonth() + 1).toString().padStart(2, "0");
	const day = date.getDate().toString().padStart(2, "0");
	return `${year}-${month}-${day} ${docType}`;
}
