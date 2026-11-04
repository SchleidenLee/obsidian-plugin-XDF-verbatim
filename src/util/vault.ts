import { TFolder, normalizePath } from "obsidian";
import type { App, TFile } from "obsidian";

/** 首页中的会议文件区块标题（二级标题，emoji 固定） */
const MEETING_SECTION_HEADING = "## 📂 本次会议文件";
const MEETING_SECTION_RE = /^##\s+📂\s*本次会议文件\s*$/;

/** 任意级别的 Markdown 标题行，用于判定区块结束 */
const ANY_HEADING_RE = /^#{1,6}\s/;

/**
 * 逐级创建文件夹；已存在的层级跳过。
 * 若某一级路径已被文件占用则抛出错误（无法在该路径下继续建目录）。
 */
export async function ensureFolder(app: App, path: string): Promise<void> {
	const normalized = normalizePath(path).replace(/^\/+|\/+$/g, "");
	if (!normalized) return;

	const segments = normalized.split("/").filter((segment) => segment.length > 0);
	let current = "";
	for (const segment of segments) {
		current = current ? `${current}/${segment}` : segment;
		const existing = app.vault.getAbstractFileByPath(current);
		if (existing) {
			if (existing instanceof TFolder) continue;
			throw new Error(`无法创建文件夹：路径已被文件占用（${current}）`);
		}
		try {
			await app.vault.createFolder(current);
		} catch (err) {
			// 并发创建时 Obsidian 会抛「already exists」；确认目录确实存在则视为成功。
			if (!(app.vault.getAbstractFileByPath(current) instanceof TFolder)) throw err;
		}
	}
}

/**
 * 在 folder 下找一个不冲突的完整路径。
 * 重名依次追加 " 1"、" 2"……；ext 传 "webm" 或 ".webm" 均兼容。
 * 返回 vault 内的规范化路径（如 `例会/attachment/2026-11-05 会议记录 1.webm`）。
 */
export async function uniquePath(app: App, folder: string, base: string, ext: string): Promise<string> {
	const cleanExt = ext.replace(/^\.+/, "");
	const suffix = cleanExt ? `.${cleanExt}` : "";
	const dir = normalizePath(folder).replace(/^\/+|\/+$/g, "");
	const join = (name: string): string => (dir ? `${dir}/${name}` : name);

	let candidate = join(`${base}${suffix}`);
	if (!app.vault.getAbstractFileByPath(candidate)) return candidate;

	// 理论上重名不会无限增长；上限只是防御死循环。
	for (let index = 1; index <= 9999; index++) {
		candidate = join(`${base} ${index}${suffix}`);
		if (!app.vault.getAbstractFileByPath(candidate)) return candidate;
	}
	throw new Error(`无法为 ${base}${suffix} 找到可用文件名`);
}

/**
 * 拆分 frontmatter 与正文。
 *
 * 约定：`frontmatter` **包含**首尾两条 `---` 分隔线，以及结尾分隔线后的换行；
 * 无 frontmatter 时 `frontmatter` 为空字符串。
 * `body` 是分隔线之后的内容（保留正文自身的空行与换行，不做 trim）。
 */
export function splitFrontmatter(content: string): { frontmatter: string; body: string } {
	const match = /^---[ \t]*\r?\n(?:[\s\S]*?\r?\n)?---[ \t]*(?:\r?\n|$)/.exec(content);
	if (!match) return { frontmatter: "", body: content };
	return { frontmatter: match[0], body: content.slice(match[0].length) };
}

/**
 * 在正文最顶部插入音频播放器 `![[fileName]]`，其后留一个空行。
 * 若正文已存在指向同一文件的嵌入链接（含别名形式）则不重复插入。
 */
export function insertPlayerAtBodyTop(body: string, fileName: string): string {
	if (body.includes(`![[${fileName}]]`) || body.includes(`![[${fileName}|`)) return body;

	const embed = `![[${fileName}]]`;
	// 正文可能自带前导空行，先去掉，保证播放器就是第一行。
	const rest = body.replace(/^(?:\r?\n)+/, "");
	return rest.length > 0 ? `${embed}\n\n${rest}` : `${embed}\n`;
}

/**
 * 在首页 `## 📂 本次会议文件` 区块下追加录音链接
 * `- [[audioName|🎧 会议录音]]`。
 *
 * 已存在同一 audioName 的链接（含无别名形式）则跳过并返回 false；
 * 区块不存在时在文件末尾新建该标题再追加。返回是否发生了写入。
 */
export async function appendMeetingLink(app: App, homeFile: TFile, audioName: string): Promise<boolean> {
	const content = await app.vault.read(homeFile);
	if (containsAudioLink(content, audioName)) return false;

	const linkLine = `- [[${audioName}|🎧 会议录音]]`;
	const lines = content.split("\n");

	let headingIndex = -1;
	for (let index = 0; index < lines.length; index++) {
		if (MEETING_SECTION_RE.test(lines[index])) {
			headingIndex = index;
			break;
		}
	}

	// 没有区块：文件末尾新建标题后追加（避免与正文最后一行粘连）。
	if (headingIndex === -1) {
		const prefix = content.length === 0 ? "" : content.endsWith("\n") ? "\n" : "\n\n";
		const updated = `${content}${prefix}${MEETING_SECTION_HEADING}\n${linkLine}\n`;
		await app.vault.modify(homeFile, updated);
		return true;
	}

	// 区块范围：标题行之后，到下一个任意级别标题为止。
	let blockEnd = lines.length;
	for (let index = headingIndex + 1; index < lines.length; index++) {
		if (ANY_HEADING_RE.test(lines[index])) {
			blockEnd = index;
			break;
		}
	}

	// 追加到区块内最后一个非空行之后，保留原区块尾部的空行。
	let insertAt = blockEnd;
	while (insertAt > headingIndex + 1 && lines[insertAt - 1].trim() === "") insertAt--;

	const toInsert: string[] = [];
	// 空区块：标题与列表之间补一个空行。
	if (insertAt === headingIndex + 1) toInsert.push("");
	toInsert.push(linkLine);
	// 后面还有标题：补一个空行作为区块间隔。
	if (blockEnd < lines.length) toInsert.push("");

	lines.splice(insertAt, 0, ...toInsert);
	await app.vault.modify(homeFile, lines.join("\n"));
	return true;
}

/** 判断内容里是否已有指向 audioName 的 wikilink（`[[x]]` 或 `[[x|...]]`）。 */
function containsAudioLink(content: string, audioName: string): boolean {
	return content.includes(`[[${audioName}]]`) || content.includes(`[[${audioName}|`);
}
