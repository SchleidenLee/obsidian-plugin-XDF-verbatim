import { ItemView, Modal } from "obsidian";
import type { App, WorkspaceLeaf } from "obsidian";
import { DOC_TYPES } from "../types";
import type { Binding, DocType, Session, SessionState, VerbatimSettings } from "../types";
import { formatDuration, recordedMs } from "../util/format";

export const VIEW_TYPE = "xdf-verbatim-panel";

export interface PanelHost {
	settings: VerbatimSettings;
	session: Session | null;
	binding: Binding | null;
	bindCurrentFile(docType: DocType): Promise<Binding | null>;
	unbind(): void;
	startRecording(): Promise<void>;
	pauseRecording(): void;
	resumeRecording(): void;
	stopRecording(): Promise<void>;
	transcribe(): Promise<void>;
	organize(): Promise<void>;
	writeToNote(): Promise<void>;
	saveSession(): Promise<void>;
	subscribe(cb: () => void): () => void;
}

type RecordState = "idle" | "recording" | "paused";

const STATE_LABELS: Record<SessionState, string> = {
	idle: "空闲",
	recorded: "已录音",
	uploading: "上传中",
	transcribing: "转写中",
	transcribed: "转写完成",
	organizing: "整理中",
	organized: "整理完成",
	writing: "写入中",
	done: "已完成",
	error: "出错",
};

/** 输入停顿多久后落盘 */
const SAVE_DEBOUNCE_MS = 600;

/** 计时器刷新间隔 */
const TICK_MS = 500;

export class MeetingPanel extends ItemView {
	private readonly host: PanelHost;
	private unsubscribe: (() => void) | null = null;
	private recordState: RecordState = "idle";
	private accumulatedMs = 0;
	private segmentStartedAt: number | null = null;
	private tickHandle: number | null = null;
	private saveHandle: number | null = null;
	private timerEl: HTMLElement | null = null;

	constructor(leaf: WorkspaceLeaf, host: PanelHost) {
		super(leaf);
		this.host = host;
	}

	getViewType(): string {
		return VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Verbatim 录音";
	}

	getIcon(): string {
		return "mic";
	}

	async onOpen(): Promise<void> {
		this.unsubscribe = this.host.subscribe(() => this.render());
		this.render();
	}

	async onClose(): Promise<void> {
		if (this.unsubscribe) {
			this.unsubscribe();
			this.unsubscribe = null;
		}
		this.stopTicker();
		if (this.saveHandle !== null) {
			window.clearTimeout(this.saveHandle);
			this.saveHandle = null;
			if (this.host.session) void this.host.saveSession().catch(() => undefined);
		}
		this.timerEl = null;
	}

	private render(): void {
		const root = this.containerEl.children[1] as HTMLElement | undefined;
		if (!root) return;
		root.empty();
		root.classList.add("xdf-verbatim-panel");
		this.timerEl = null;
		this.renderBinding(root);
		this.renderRecording(root);
		this.renderTranscribe(root);
		this.renderOrganize(root);
		this.renderWrite(root);
	}

	private createSection(root: HTMLElement, title: string): HTMLElement {
		const section = root.createDiv({ cls: "xdf-verbatim-section" });
		section.createEl("h4", { text: title, cls: "xdf-verbatim-section-title" });
		return section;
	}

	private renderBinding(root: HTMLElement): void {
		const card = root.createDiv({ cls: "xdf-verbatim-card" });
		const binding = this.host.binding;
		if (!binding) {
			card.createEl("p", {
				text: "请先在例会文件夹内打开 会议记录.md 或 教研笔记.md",
				cls: "xdf-verbatim-hint",
			});
			const row = card.createDiv({ cls: "xdf-verbatim-btn-row" });
			for (const docType of DOC_TYPES) {
				const button = row.createEl("button", {
					text: `绑定为${docType}`,
					cls: "xdf-verbatim-btn",
				});
				button.addEventListener("click", () => {
					void this.bind(docType);
				});
			}
			return;
		}

		const info = card.createDiv({ cls: "xdf-verbatim-binding" });
		info.createSpan({ cls: "xdf-verbatim-doc-type", text: binding.docType });
		info.createSpan({ cls: "xdf-verbatim-sep", text: " · " });
		info.createSpan({ cls: "xdf-verbatim-folder", text: folderName(binding.meetingFolder) });
		const row = card.createDiv({ cls: "xdf-verbatim-btn-row" });
		const unbindButton = row.createEl("button", {
			text: "解除绑定",
			cls: "xdf-verbatim-btn",
		});
		unbindButton.addEventListener("click", () => {
			this.host.unbind();
			this.render();
		});
	}

	private renderRecording(root: HTMLElement): void {
		const section = this.createSection(root, "录音");
		if (this.recordState === "idle") {
			const startButton = section.createEl("button", {
				text: "开始录音",
				cls: "xdf-verbatim-btn xdf-verbatim-record-btn",
			});
			startButton.disabled = this.host.binding === null;
			startButton.addEventListener("click", () => {
				void this.startRecording();
			});
			return;
		}

		this.timerEl = section.createDiv({ cls: "xdf-verbatim-timer" });
		this.timerEl.textContent = formatDuration(this.elapsedMs());

		const row = section.createDiv({ cls: "xdf-verbatim-btn-row" });
		if (this.recordState === "recording") {
			const pauseButton = row.createEl("button", { text: "暂停", cls: "xdf-verbatim-btn" });
			pauseButton.addEventListener("click", () => this.pauseRecording());
		} else {
			const resumeButton = row.createEl("button", { text: "继续", cls: "xdf-verbatim-btn" });
			resumeButton.addEventListener("click", () => this.resumeRecording());
		}
		const stopButton = row.createEl("button", {
			text: "停止并保存",
			cls: "xdf-verbatim-btn mod-warning",
		});
		stopButton.addEventListener("click", () => {
			void this.stopRecording();
		});
	}

	private renderTranscribe(root: HTMLElement): void {
		const section = this.createSection(root, "转写");
		const session = this.host.session;
		const busy = session !== null && (session.state === "uploading" || session.state === "transcribing");

		const textarea = section.createEl("textarea", {
			cls: "xdf-verbatim-textarea",
			attr: { rows: "8", placeholder: "转写结果将显示在这里，可直接编辑" },
		});
		textarea.value = session ? session.transcript : "";
		textarea.disabled = session === null;
		textarea.addEventListener("input", () => {
			this.handleEdit("transcript", textarea.value);
		});

		const row = section.createDiv({ cls: "xdf-verbatim-btn-row" });
		const transcribeButton = row.createEl("button", {
			text: busy ? "转写中…" : "转写",
			cls: "xdf-verbatim-btn",
		});
		transcribeButton.disabled = busy || session === null || session.transcript.trim() !== "";
		transcribeButton.addEventListener("click", () => {
			void this.transcribe();
		});

		this.renderStatus(section);
	}

	private renderOrganize(root: HTMLElement): void {
		const section = this.createSection(root, "整理");
		const session = this.host.session;
		const organizing = session !== null && session.state === "organizing";

		const textarea = section.createEl("textarea", {
			cls: "xdf-verbatim-textarea",
			attr: { rows: "10", placeholder: "整理后的正文将显示在这里，可直接编辑" },
		});
		textarea.value = session ? session.draft : "";
		textarea.disabled = session === null;
		textarea.addEventListener("input", () => {
			this.handleEdit("draft", textarea.value);
		});

		const row = section.createDiv({ cls: "xdf-verbatim-btn-row" });
		const organizeButton = row.createEl("button", {
			text: organizing ? "整理中…" : "整理",
			cls: "xdf-verbatim-btn",
		});
		organizeButton.disabled = session === null || session.transcript.trim() === "" || organizing;
		organizeButton.addEventListener("click", () => {
			void this.organize();
		});
	}

	private renderWrite(root: HTMLElement): void {
		const section = this.createSection(root, "写入");
		const session = this.host.session;

		const writeButton = section.createEl("button", {
			text: "确认写入笔记",
			cls: "xdf-verbatim-btn",
		});
		writeButton.disabled = session === null || session.draft.trim() === "";
		writeButton.addEventListener("click", () => this.confirmWrite());
	}

	private renderStatus(section: HTMLElement): void {
		const status = section.createDiv({ cls: "xdf-verbatim-status" });
		const session = this.host.session;
		if (!session) {
			status.textContent = "暂无会话";
			return;
		}
		const label = STATE_LABELS[session.state];
		if (session.state === "error" && session.error) {
			status.textContent = `${label}：${session.error}`;
			status.classList.add("is-error");
			return;
		}
		status.textContent = label;
	}

	private handleEdit(field: "transcript" | "draft", value: string): void {
		const session = this.host.session;
		if (!session) return;
		session[field] = value;
		this.scheduleSave();
	}

	private scheduleSave(): void {
		if (this.saveHandle !== null) window.clearTimeout(this.saveHandle);
		this.saveHandle = window.setTimeout(() => {
			this.saveHandle = null;
			if (!this.host.session) return;
			void this.host.saveSession().catch(() => undefined);
		}, SAVE_DEBOUNCE_MS);
	}

	private async bind(docType: DocType): Promise<void> {
		try {
			const binding = await this.host.bindCurrentFile(docType);
			if (binding) this.render();
		} catch {
			// 失败提示由 host 统一处理
		}
	}

	private async startRecording(): Promise<void> {
		try {
			await this.host.startRecording();
		} catch {
			this.render();
			return;
		}
		this.recordState = "recording";
		this.accumulatedMs = 0;
		this.segmentStartedAt = Date.now();
		this.startTicker();
		this.render();
	}

	private pauseRecording(): void {
		this.host.pauseRecording();
		this.accumulatedMs = this.elapsedMs();
		this.segmentStartedAt = null;
		this.recordState = "paused";
		this.stopTicker();
		this.render();
	}

	private resumeRecording(): void {
		this.host.resumeRecording();
		this.segmentStartedAt = Date.now();
		this.recordState = "recording";
		this.startTicker();
		this.render();
	}

	private async stopRecording(): Promise<void> {
		try {
			await this.host.stopRecording();
		} catch {
			// 失败提示由 host 统一处理
		} finally {
			this.resetTimer();
			this.render();
		}
	}

	private async transcribe(): Promise<void> {
		try {
			await this.host.transcribe();
		} catch {
			// 失败提示由 host 统一处理
		} finally {
			this.render();
		}
	}

	private async organize(): Promise<void> {
		try {
			await this.host.organize();
		} catch {
			// 失败提示由 host 统一处理
		} finally {
			this.render();
		}
	}

	private confirmWrite(): void {
		const fileName = this.host.binding ? this.host.binding.targetFile.basename : "当前笔记";
		const modal = new ConfirmModal(this.app, fileName, () => {
			void this.host.writeToNote().catch(() => undefined);
		});
		modal.open();
	}

	private elapsedMs(): number {
		return recordedMs(this.accumulatedMs, this.segmentStartedAt, Date.now());
	}

	private startTicker(): void {
		if (this.tickHandle !== null) return;
		this.tickHandle = window.setInterval(() => {
			if (!this.timerEl || this.segmentStartedAt === null) return;
			this.timerEl.textContent = formatDuration(this.elapsedMs());
		}, TICK_MS);
	}

	private stopTicker(): void {
		if (this.tickHandle === null) return;
		window.clearInterval(this.tickHandle);
		this.tickHandle = null;
	}

	private resetTimer(): void {
		this.recordState = "idle";
		this.accumulatedMs = 0;
		this.segmentStartedAt = null;
		this.stopTicker();
	}
}

/** 例会文件夹路径的最后一段 */
function folderName(path: string): string {
	const parts = path.split("/").filter((part) => part.length > 0);
	return parts.length > 0 ? parts[parts.length - 1] : path;
}

class ConfirmModal extends Modal {
	private readonly fileName: string;
	private readonly onConfirm: () => void;

	constructor(app: App, fileName: string, onConfirm: () => void) {
		super(app);
		this.fileName = fileName;
		this.onConfirm = onConfirm;
	}

	onOpen(): void {
		this.contentEl.createEl("h3", { text: "确认写入笔记" });
		this.contentEl.createEl("p", {
			text: `将用整理稿替换 ${this.fileName} 的正文，frontmatter 保留`,
		});
		const row = this.contentEl.createDiv({
			cls: "xdf-verbatim-btn-row xdf-verbatim-confirm-actions",
		});
		const cancelButton = row.createEl("button", { text: "取消" });
		cancelButton.addEventListener("click", () => this.close());
		const confirmButton = row.createEl("button", { text: "确认", cls: "mod-cta" });
		confirmButton.addEventListener("click", () => {
			this.close();
			this.onConfirm();
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
