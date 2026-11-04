import type { Recorder } from "../types";

/**
 * 麦克风录音器（v1 只录麦克风，不混系统音频）。
 *
 * 蓝本：references/Scuttlebutt/src/recorder.ts（MIT）。
 * 已移除 getDisplayMedia / 系统音频设备 / Web Audio 混音相关代码，保持单一音源。
 */
export class MeetingRecorder implements Recorder {
	private mediaRecorder: MediaRecorder | null = null;
	private stream: MediaStream | null = null;
	private chunks: Blob[] = [];
	private mimeType = "audio/webm";
	/** 防重入：start 的异步窗口期内（getUserMedia 未返回）再次调用直接忽略 */
	private starting = false;

	isRecording(): boolean {
		return this.mediaRecorder?.state === "recording";
	}

	isPaused(): boolean {
		return this.mediaRecorder?.state === "paused";
	}

	/** 存在录音会话且处于录制或暂停中 */
	isActive(): boolean {
		const state = this.mediaRecorder?.state;
		return state === "recording" || state === "paused";
	}

	async start(deviceId?: string): Promise<void> {
		// 双触发（快捷键 + 按钮）时第二次直接返回，避免第一路麦克风流被遗弃、设备一直被占用。
		if (this.starting || this.isActive()) return;
		this.starting = true;
		try {
			const audioConstraints: MediaTrackConstraints = {
				echoCancellation: true,
				noiseSuppression: true,
			};
			if (deviceId) audioConstraints.deviceId = { exact: deviceId };

			const stream = await navigator.mediaDevices.getUserMedia({
				video: false,
				audio: audioConstraints,
			});
			this.stream = stream;

			// 依次挑选浏览器支持的编码，全部不支持时兜底 audio/webm。
			const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];
			this.mimeType = candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? "audio/webm";

			const recorder = new MediaRecorder(stream, { mimeType: this.mimeType });
			this.mediaRecorder = recorder;
			this.chunks = [];
			recorder.ondataavailable = (event: BlobEvent) => {
				// 空 chunk 会让 Blob 里混入无意义片段，直接丢弃。
				if (event.data && event.data.size > 0) this.chunks.push(event.data);
			};
			// 每秒切一片，避免长时间录音只产出一个大 Blob。
			recorder.start(1000);
		} catch (err) {
			// getUserMedia 成功但 MediaRecorder 构造/启动失败时，必须释放麦克风。
			this.cleanup();
			throw err;
		} finally {
			this.starting = false;
		}
	}

	pause(): void {
		if (this.mediaRecorder?.state === "recording") this.mediaRecorder.pause();
	}

	resume(): void {
		if (this.mediaRecorder?.state === "paused") this.mediaRecorder.resume();
	}

	/** 停止并返回 webm Blob；未在录音时返回空 Blob。 */
	stop(): Promise<Blob> {
		return new Promise<Blob>((resolve) => {
			const recorder = this.mediaRecorder;
			if (!recorder) {
				resolve(new Blob());
				return;
			}

			// 已经因音轨结束等原因进入 inactive：onstop 不会再触发，直接组装已有分片。
			if (recorder.state === "inactive") {
				const blob = new Blob(this.chunks, { type: this.mimeType });
				this.cleanup();
				resolve(blob);
				return;
			}

			recorder.onstop = () => {
				const blob = new Blob(this.chunks, { type: this.mimeType });
				this.cleanup();
				resolve(blob);
			};
			try {
				recorder.stop();
			} catch {
				// 极端情况下 stop 抛 InvalidStateError：不留下悬挂的 Promise 与设备占用。
				const blob = new Blob(this.chunks, { type: this.mimeType });
				this.cleanup();
				resolve(blob);
			}
		});
	}

	/** 放弃本次录音：停止采集并丢弃分片。 */
	abort(): void {
		const recorder = this.mediaRecorder;
		if (recorder && recorder.state !== "inactive") {
			recorder.onstop = null;
			try {
				recorder.stop();
			} catch {
				/* 忽略：下面统一 cleanup */
			}
		}
		this.cleanup();
	}

	getMimeType(): string {
		return this.mimeType;
	}

	/** 释放音轨、清空 MediaRecorder 与分片；所有异常路径都走这里。 */
	private cleanup(): void {
		if (this.stream) {
			for (const track of this.stream.getTracks()) track.stop();
			this.stream = null;
		}
		this.mediaRecorder = null;
		this.chunks = [];
	}
}
