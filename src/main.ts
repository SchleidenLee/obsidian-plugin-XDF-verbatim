import { Plugin } from "obsidian";

/**
 * XDF Verbatim — 骨架占位。
 * 实现方案见 PENDING.md；动手顺序：讯飞 provider → 模板引擎 → 面板 → LLM → 命令迁移。
 */
export default class XdfVerbatimPlugin extends Plugin {
	onload() {
		console.log("XDF Verbatim: skeleton loaded");
	}
}
