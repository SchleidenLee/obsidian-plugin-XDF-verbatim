import { Notice, Plugin, TFile } from "obsidian";
import type { WorkspaceLeaf } from "obsidian";
import { MeetingPanel, VIEW_TYPE, type PanelHost } from "./panel/MeetingPanel";
import { VerbatimSettingTab, type SettingsHost } from "./settings";
import { MeetingRecorder } from "./record/Recorder";
import { createXunfeiProvider } from "./providers/xunfei";
import { createLlmClient } from "./llm/client";
import { organize as organizeTranscript } from "./llm/organize";
import { PROMPT_SPECS, findSpecByBasename } from "./llm/prompts";
import { createEmptySession, loadPersistedData, mergeSettings } from "./session";
import {
	appendMeetingLink,
	ensureFolder,
	insertPlayerAtBodyTop,
	splitFrontmatter,
	uniquePath,
} from "./util/vault";
import { isOwnedAudioBasename, isOwnedAudioPath } from "./util/audio-naming";
import { buildAudioBaseName } from "./util/format";
import { sha256Hex } from "./util/crypto";
import { ATTACHMENT_DIR, MEETING_FOLDER_RE } from "./types";
import type { Binding, Recorder, Session, VerbatimSettings } from "./types";

/**
 * XDF Verbatim 主流程：绑定页面 → 录音落盘 → 讯飞转写 → LLM 整理 → 写回笔记。
 * 面板（MeetingPanel）通过 PanelHost 调用这里的公开方法；绑定关系只存内存。
 */
export default class VerbatimPlugin extends Plugin implements PanelHost, SettingsHost {
	settings: VerbatimSettings = mergeSettings(null);
	session: Session | null = null;
	/** 仅内存，重启即失效 */
	binding: Binding | null = null;
	recorder: Recorder | null = null;
	/** 最近一次转写进度文案，供面板展示 */
	progress = "";

	private listeners = new Set<() => void>();

	async onload(): Promise<void> {
		const raw = await this.loadData();
		const data = loadPersistedData(raw);
		this.settings = data.settings;
		this.session = data.session;

		this.registerView(VIEW_TYPE, (leaf) => new MeetingPanel(leaf, this));

		this.addRibbonIcon("mic", "Verbatim 会议录音", () => {
			void this.openPanel();
		});

		this.addCommand({
			id: "open-panel",
			name: "打开录音面板",
			callback: () => {
				void this.openPanel();
			},
		});

		this.addCommand({
			id: "bind-current-page",
			name: "绑定当前页面",
			callback: () => {
				void this.bindActiveFile();
			},
		});

		this.addSettingTab(new VerbatimSettingTab(this.app, this));
	}

	onunload(): void {
		this.recorder?.abort();
		this.recorder = null;
		this.app.workspace.detachLeavesOfType(VIEW_TYPE);
	}

	async saveSettings(): Promise<void> {
		await this.saveData({ settings: this.settings, session: this.session });
	}

	/** 绑定关系不持久化，因此与 saveSettings 写同样的负载 */
	async saveSession(): Promise<void> {
		await this.saveData({ settings: this.settings, session: this.session });
	}

	/** 面板订阅状态变化；返回取消函数 */
	subscribe(callback: () => void): () => void {
		this.listeners.add(callback);
		return () => {
			this.listeners.delete(callback);
		};
	}

	notify(): void {
		for (const callback of Array.from(this.listeners)) {
			try {
				callback();
			} catch (error) {
				console.error("XDF Verbatim: 面板订阅回调失败", error);
			}
		}
	}

	// ── 绑定 ───────────────────────────────────────────────

	/** 校验当前打开的笔记并建立绑定；失败时 Notice 并返回 null */
	async bindCurrentFile(docType: string): Promise<Binding | null> {
		const spec = PROMPT_SPECS[docType];
		if (!spec) {
			new Notice(`未知文档类型：${docType}`);
			return null;
		}

		const file = this.app.workspace.getActiveFile();
		if (!file) {
			new Notice("没有打开的笔记，请先打开会议记录或教研笔记。");
			return null;
		}

		if (file.extension !== "md" || !spec.matchBasenames.includes(file.basename)) {
			new Notice(`当前笔记不是${spec.displayName}，请打开例会内的${spec.matchBasenames.join(" / ")}.md。`);
			return null;
		}

		const parent = file.parent;
		const folderName = parent?.name ?? "";
		if (!parent || !MEETING_FOLDER_RE.test(folderName)) {
			new Notice("不在例会文件夹内，请先跑 base 的周例会记录。");
			return null;
		}

		const meetingFolder = parent.path;
		const binding: Binding = {
			targetFile: file,
			meetingFolder,
			attachmentDir: `${meetingFolder}/${ATTACHMENT_DIR}`,
			audioBaseName: buildAudioBaseName(new Date(), spec.displayName),
			docType: spec.docType,
		};

		this.binding = binding;
		this.notify();
		new Notice(`已绑定：${folderName}/${file.name}`);

		// 重启后绑定关系丢失：按命名约定找回本页已录的音频，重建会话
		const restored = await this.restoreSessionFromBinding(binding, spec.displayName);
		if (restored) {
			new Notice(`已找回录音：${restored}，可直接转写。`);
			this.notify();
		}

		return binding;
	}

	/** 命令入口：按当前文件名推断文档类型 */
	private async bindActiveFile(): Promise<void> {
		const file = this.app.workspace.getActiveFile();
		if (!file) {
			new Notice("没有打开的笔记，请先打开会议记录或教研笔记。");
			return;
		}
		const spec = findSpecByBasename(file.basename);
		if (!spec) {
			new Notice("当前笔记不是会议记录/教研笔记，无法绑定。");
			return;
		}
		await this.bindCurrentFile(spec.docType);
	}

	unbind(): void {
		this.recorder?.abort();
		this.recorder = null;
		this.binding = null;
		this.progress = "";
		this.notify();
	}

	// ── 录音 ───────────────────────────────────────────────

	async startRecording(): Promise<void> {
		if (!this.binding) {
			new Notice("请先绑定会议记录或教研笔记。");
			throw new Error("未绑定页面，无法开始录音。");
		}
		if (this.recorder?.isActive()) return;

		const recorder = new MeetingRecorder();
		this.recorder = recorder;
		try {
			await recorder.start();
			this.progress = "";
			this.notify();
		} catch (error) {
			// 面板依赖抛出判断是否进入录音态
			this.recorder = null;
			this.notify();
			new Notice(`启动录音失败：${messageOf(error)}`);
			throw error;
		}
	}

	pauseRecording(): void {
		this.recorder?.pause();
		this.notify();
	}

	resumeRecording(): void {
		this.recorder?.resume();
		this.notify();
	}

	/** 停止录音 → 落盘 attachment → 插播放器 → 首页追加链接 → 新建会话 */
	async stopRecording(): Promise<void> {
		const binding = this.binding;
		if (!binding) {
			new Notice("请先绑定会议记录或教研笔记。");
			return;
		}
		const recorder = this.recorder;
		if (!recorder) {
			new Notice("当前没有正在进行的录音。");
			return;
		}

		try {
			const blob = await recorder.stop();
			this.recorder = null;
			this.progress = "";
			this.notify();

			if (blob.size === 0) {
				new Notice("录音失败：没有采集到音频。");
				return;
			}

			const buffer = await blob.arrayBuffer();
			const hash = await sha256Hex(buffer);

			await ensureFolder(this.app, binding.attachmentDir);
			const path = await uniquePath(this.app, binding.attachmentDir, binding.audioBaseName, "webm");
			await this.app.vault.createBinary(path, buffer);

			const fileName = lastPathSegment(path);

			// 音频已落盘，先建会话：后续插引用失败也不影响用户继续转写这条录音
			this.session = createEmptySession(path, hash);
			await this.saveSession();

			// 插入引用失败只提示，不触发外层 fail（否则会把已保存的音频标记成 error 状态）
			try {
				await this.insertPlayer(binding, fileName);
				await this.appendHomeLink(binding, fileName);
			} catch (error) {
				console.error("XDF Verbatim: 插入录音引用失败", error);
				new Notice("录音已保存，但插入引用失败：" + messageOf(error));
			}

			this.notify();
			new Notice(`录音已保存：${fileName}`);
		} catch (error) {
			this.recorder = null;
			await this.fail("保存录音失败", error);
		}
	}

	// ── 转写 ───────────────────────────────────────────────

	async transcribe(): Promise<void> {
		const session = this.session;
		if (!session || !session.audioPath) {
			new Notice("没有可转写的录音。");
			return;
		}

		const audioFile = this.app.vault.getAbstractFileByPath(session.audioPath);
		if (!(audioFile instanceof TFile)) {
			await this.fail("转写失败", new Error(`音频文件不存在：${session.audioPath}`));
			return;
		}

		try {
			session.state = "uploading";
			session.error = null;
			this.progress = "准备上传…";
			await this.saveSession();
			this.notify();

			const provider = createXunfeiProvider(this.settings.xunfei);
			const audio = await this.app.vault.adapter.readBinary(session.audioPath);
			const result = await provider.transcribe({
				audio,
				fileName: audioFile.name,
				enableDiarization: true,
				onProgress: (label) => {
					this.progress = label;
					// 上传结束后 provider 的进度文案进入「转写 / 排队」阶段
					if (label.includes("转写")) session.state = "transcribing";
					this.notify();
				},
			});

			const lines = result.segments
				.map((segment) => `${segment.speaker ? `${segment.speaker}：` : ""}${segment.text}`)
				.filter((line) => line.trim().length > 0);
			session.transcript = lines.length > 0 ? lines.join("\n") : result.text;

			// provider 在 raw 里保留了 orderId / signatureRandom，落库便于后续排查
			const raw = result.raw && typeof result.raw === "object" ? (result.raw as Record<string, unknown>) : {};
			session.orderId = readOptionalString(raw.orderId) ?? session.orderId;
			session.signatureRandom = readOptionalString(raw.signatureRandom) ?? session.signatureRandom;

			session.state = "transcribed";
			session.error = null;
			await this.saveSession();
			this.notify();
			new Notice("转写完成。");
		} catch (error) {
			await this.fail("转写失败", error);
		}
	}

	// ── 整理 ───────────────────────────────────────────────

	async organize(): Promise<void> {
		const session = this.session;
		if (!session || !session.transcript.trim()) {
			new Notice("没有可整理的转写稿。");
			return;
		}
		const binding = this.binding;
		if (!binding) {
			new Notice("请先绑定会议记录或教研笔记。");
			return;
		}
		const spec = PROMPT_SPECS[binding.docType];
		if (!spec) {
			await this.fail("整理失败", new Error(`绑定了未知文档类型：${binding.docType}`));
			return;
		}
		const target = this.app.vault.getAbstractFileByPath(binding.targetFile.path);
		if (!(target instanceof TFile)) {
			await this.fail("整理失败", new Error(`绑定页面不存在：${binding.targetFile.path}`));
			return;
		}

		try {
			session.state = "organizing";
			session.error = null;
			this.progress = "整理中…";
			await this.saveSession();
			this.notify();

			const content = await this.app.vault.read(target);
			const { body } = splitFrontmatter(content);
			// 主 Bug 修复：剥离正文首行的播放器，不要喂给 LLM
			const bodyCleaned = stripLeadingPlayer(body);
			const client = createLlmClient(this.settings.llm);
			session.draft = await organizeTranscript(client, spec, session.transcript, bodyCleaned);

			session.state = "organized";
			session.error = null;
			await this.saveSession();
			this.notify();
			new Notice("整理完成，请确认后写入。");
		} catch (error) {
			await this.fail("整理失败", error);
		}
	}

	// ── 写入 ───────────────────────────────────────────────

	async writeToNote(): Promise<void> {
		const session = this.session;
		const draft = session?.draft.trim() ?? "";
		if (!session || !draft) {
			new Notice("没有可写入的整理稿。");
			return;
		}
		const binding = this.binding;
		if (!binding) {
			new Notice("请先绑定会议记录或教研笔记。");
			return;
		}
		const target = this.app.vault.getAbstractFileByPath(binding.targetFile.path);
		if (!(target instanceof TFile)) {
			await this.fail("写入失败", new Error(`绑定页面不存在：${binding.targetFile.path}`));
			return;
		}

		try {
			session.state = "writing";
			session.error = null;
			this.progress = "写入中…";
			this.notify();

			const content = await this.app.vault.read(target);
			const { frontmatter, body } = splitFrontmatter(content);

			// 保留正文顶部已有的播放器；缺失时按当前音频路径重建
			const playerLine = resolvePlayerLine(body, session);

			// 防御性兜底：如果 draft 首行已经是播放器，不要再插第二次
			const draftAlreadyHasPlayer = PLAYER_LINE_RE.test(draft.replace(/^(?:\r?\n)+/, "").split("\n", 1)[0].trim());
			const newBody = playerLine && !draftAlreadyHasPlayer
				? `${playerLine}\n\n${draft}\n`
				: `${draft}\n`;
			await this.app.vault.modify(target, `${frontmatter}${newBody}`);

			session.state = "done";
			session.error = null;
			await this.saveSession();
			this.notify();
			new Notice("已写入。");
		} catch (error) {
			await this.fail("写入失败", error);
		}
	}

	// ── 内部工具 ───────────────────────────────────────────

	/**
	 * 绑定页面后，按命名约定找回该页已录音频并重建会话；返回找回的文件名或 null。
	 * 目录不存在 / 无匹配候选 / 已有同目录同类型会话时均返回 null，不影响绑定主流程。
	 */
	private async restoreSessionFromBinding(binding: Binding, displayName: string): Promise<string | null> {
		try {
			const folder = this.app.vault.getFolderByPath(binding.attachmentDir);
			if (!folder) return null;

			// 保护已有会话：直接按 session 路径判断目录与类型，不依赖候选列表命中，
			// 避免磁盘候选变化（如重名文件被删）时冲掉转写稿 / 整理稿。
			if (this.session && isOwnedAudioPath(this.session.audioPath, binding.attachmentDir, displayName)) {
				return null;
			}

			// 候选：基础名 `yyyy-MM-dd 类型.webm`；重名含空格数字（现行）与 ` (n)`（历史兼容）
			const candidates = folder.children
				.filter((child): child is TFile => child instanceof TFile)
				.filter((file) => file.extension === "webm" && isOwnedAudioBasename(file.basename, displayName))
				.sort((a, b) => b.stat.mtime - a.stat.mtime);

			if (candidates.length === 0) return null;

			const file = candidates[0];
			const buffer = await this.app.vault.readBinary(file);
			const hash = await sha256Hex(buffer);
			this.session = createEmptySession(file.path, hash);
			await this.saveSession();
			return file.basename;
		} catch (error) {
			console.error("XDF Verbatim: 找回已录音频失败", error);
			return null;
		}
	}

	private async openPanel(): Promise<void> {
		const { workspace } = this.app;
		let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(VIEW_TYPE)[0] ?? null;
		if (!leaf) {
			leaf = workspace.getRightLeaf(false);
			if (!leaf) {
				new Notice("无法打开录音面板。");
				return;
			}
			await leaf.setViewState({ type: VIEW_TYPE, active: true });
		}
		await workspace.revealLeaf(leaf);
	}

	/** 把播放器插入绑定页面正文最顶部（frontmatter 原样保留） */
	private async insertPlayer(binding: Binding, fileName: string): Promise<void> {
		const target = this.app.vault.getAbstractFileByPath(binding.targetFile.path);
		if (!(target instanceof TFile)) {
			throw new Error(`绑定页面不存在：${binding.targetFile.path}`);
		}
		const content = await this.app.vault.read(target);
		const { frontmatter, body } = splitFrontmatter(content);
		const updatedBody = insertPlayerAtBodyTop(body, fileName);
		// 已存在同一播放器时不重复写盘
		if (updatedBody === body) return;
		await this.app.vault.modify(target, `${frontmatter}${updatedBody}`);
	}

	/** 例会首页存在时，在「📂 本次会议文件」区块追加录音链接 */
	private async appendHomeLink(binding: Binding, fileName: string): Promise<void> {
		const folderName = lastPathSegment(binding.meetingFolder);
		if (!folderName) return;
		const home = this.app.vault.getAbstractFileByPath(`${binding.meetingFolder}/${folderName}.md`);
		if (home instanceof TFile) await appendMeetingLink(this.app, home, fileName);
	}

	/** 统一失败处理：记 error 状态 + Notice；保存失败不掩盖原始错误 */
	private async fail(prefix: string, error: unknown): Promise<void> {
		const text = `${prefix}：${messageOf(error)}`;
		if (this.session) {
			this.session.state = "error";
			this.session.error = text;
			await this.saveSession();
		}
		this.notify();
		new Notice(text);
	}
}

/** body 第一行若已是 webm 内嵌播放器则原样保留，否则按音频路径重新生成 */
function resolvePlayerLine(body: string, session: Session): string {
	const firstLine = body.replace(/^(?:\r?\n)+/, "").split("\n", 1)[0].trim();
	if (PLAYER_LINE_RE.test(firstLine)) return firstLine;

	const fileName = lastPathSegment(session.audioPath);
	return fileName ? `![[${fileName}]]` : "";
}

/** 匹配单行 webm 播放器嵌入：`![[xxx.webm]]` 或 `![[xxx.webm|别名]]` */
const PLAYER_LINE_RE = /^!\[\[[^\]]+\.webm(?:\|[^\]]*)?\]\]$/i;

/**
 * 从正文剥离掉首行的播放器嵌入（含其后的空白行）。
 * 用于 organzie() 把正文喂给 LLM 前先清掉播放器，避免 LLM 把播放器抄进 draft。
 */
function stripLeadingPlayer(body: string): string {
	const cleaned = body.replace(/^(?:\r?\n)+/, "");
	const firstLineEnd = cleaned.indexOf("\n");
	if (firstLineEnd === -1) {
		// 只有一行且是播放器，直接清空
		return PLAYER_LINE_RE.test(cleaned.trim()) ? "" : body;
	}
	const firstLine = cleaned.slice(0, firstLineEnd).trim();
	if (!PLAYER_LINE_RE.test(firstLine)) return body;
	// 去掉播放器行 + 紧随其后的空行
	const rest = cleaned.slice(firstLineEnd + 1);
	return rest.replace(/^(?:\r?\n)+/, "");
}

function lastPathSegment(path: string): string {
	const segments = path.split("/").filter((segment) => segment.length > 0);
	return segments.length > 0 ? segments[segments.length - 1] : "";
}

function readOptionalString(value: unknown): string | null {
	return typeof value === "string" && value.length > 0 ? value : null;
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
