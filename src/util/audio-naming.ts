/**
 * 录音文件命名约定（与 `util/vault.ts` 的 `uniquePath` 保持一致）：
 *   基础名：`yyyy-MM-dd {displayName}.webm`
 *   现行重名：`yyyy-MM-dd {displayName} N.webm`（空格 + 十进制数字，N 从 1 起）
 *   历史兼容：`yyyy-MM-dd {displayName} (N).webm`（只读兼容，新录制不再产生）
 *
 * 本模块不依赖 Obsidian，便于用纯逻辑测试覆盖命名与保护判断。
 */

/** 转义正则特殊字符，用于把 displayName 拼进动态正则 */
export function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 判断不含扩展名的 basename（`TFile.basename` 语义）是否属于指定页面类型。
 * 日期前缀不限具体日期，避免跨零点或补录文件被漏掉。
 */
export function isOwnedAudioBasename(basename: string, displayName: string): boolean {
	const pattern = new RegExp(
		`^\\d{4}-\\d{2}-\\d{2} ${escapeRegExp(displayName)}(?: \\d+| \\(\\d+\\))?$`,
	);
	return pattern.test(basename);
}

/**
 * 判断会话音频路径是否属于「指定 attachmentDir + 指定页面类型」。
 *
 * 只看规范路径与命名，不依赖该文件是否仍在当前候选列表：
 * 即便磁盘候选变化（如重名文件被删），也据此保护已有转写稿 / 整理稿。
 */
export function isOwnedAudioPath(audioPath: string, attachmentDir: string, displayName: string): boolean {
	const dir = normalizeVaultPath(attachmentDir);
	const path = normalizeVaultPath(audioPath);
	const prefix = dir ? `${dir}/` : "";
	if (!prefix || !path.startsWith(prefix)) return false;

	const segment = path.slice(prefix.length);
	if (!segment || segment.includes("/")) return false;
	if (!/\.webm$/i.test(segment)) return false;

	return isOwnedAudioBasename(segment.slice(0, -".webm".length), displayName);
}

/** Obsidian 路径以 `/` 分隔；去掉首尾分隔符，并兼容传入 Windows 反斜杠 */
function normalizeVaultPath(path: string): string {
	return String(path ?? "")
		.replace(/\\/g, "/")
		.replace(/^\/+|\/+$/g, "");
}
