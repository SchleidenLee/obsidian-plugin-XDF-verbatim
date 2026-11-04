import { App, Plugin, PluginSettingTab, Setting } from "obsidian";

import type { VerbatimSettings } from "./types";

export const DEFAULT_SETTINGS: VerbatimSettings = {
	xunfei: {
		endpoint: "https://office-api-ist-dx.iflyaisol.com",
		appId: "",
		apiKey: "",
		apiSecret: "",
		timeoutSeconds: 1800,
		pollIntervalSeconds: 10,
	},
	llm: {
		baseUrl: "http://127.0.0.1:8181/v1",
		apiKey: "",
		model: "",
	},
};

export interface SettingsHost {
	settings: VerbatimSettings;
	saveSettings(): Promise<void>;
}

export class VerbatimSettingTab extends PluginSettingTab {
	private readonly host: SettingsHost;

	constructor(app: App, host: SettingsHost & Plugin) {
		super(app, host);
		this.host = host;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("h2", { text: "讯飞" });

		new Setting(containerEl)
			.setName("服务地址")
			.setDesc("讯飞录音文件转写 API 的端点地址。")
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.xunfei.endpoint)
					.setValue(this.host.settings.xunfei.endpoint)
					.onChange(async (value) => {
						this.host.settings.xunfei.endpoint = value.trim();
						await this.host.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("App ID")
			.setDesc("讯飞开放平台应用的 App ID。")
			.addText((text) =>
				text
					.setPlaceholder("请输入 App ID")
					.setValue(this.host.settings.xunfei.appId)
					.onChange(async (value) => {
						this.host.settings.xunfei.appId = value.trim();
						await this.host.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("API Key")
			.setDesc("讯飞开放平台应用的 API Key。")
			.addText((text) => {
				text.inputEl.type = "password";
				text
					.setPlaceholder("请输入 API Key")
					.setValue(this.host.settings.xunfei.apiKey)
					.onChange(async (value) => {
						this.host.settings.xunfei.apiKey = value.trim();
						await this.host.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("API Secret")
			.setDesc("讯飞开放平台应用的 API Secret。")
			.addText((text) => {
				text.inputEl.type = "password";
				text
					.setPlaceholder("请输入 API Secret")
					.setValue(this.host.settings.xunfei.apiSecret)
					.onChange(async (value) => {
						this.host.settings.xunfei.apiSecret = value.trim();
						await this.host.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("转写超时（秒）")
			.setDesc("等待讯飞转写结果的超时时间，默认 1800 秒。")
			.addText((text) =>
				text
					.setPlaceholder(String(DEFAULT_SETTINGS.xunfei.timeoutSeconds))
					.setValue(String(this.host.settings.xunfei.timeoutSeconds))
					.onChange(async (value) => {
						const parsed = Number(value.trim());
						if (!Number.isFinite(parsed) || parsed <= 0) return;
						this.host.settings.xunfei.timeoutSeconds = parsed;
						await this.host.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("轮询间隔（秒）")
			.setDesc("查询转写进度的时间间隔，默认 10 秒。")
			.addText((text) =>
				text
					.setPlaceholder(String(DEFAULT_SETTINGS.xunfei.pollIntervalSeconds))
					.setValue(String(this.host.settings.xunfei.pollIntervalSeconds))
					.onChange(async (value) => {
						const parsed = Number(value.trim());
						if (!Number.isFinite(parsed) || parsed <= 0) return;
						this.host.settings.xunfei.pollIntervalSeconds = parsed;
						await this.host.saveSettings();
					}),
			);

		containerEl.createEl("h2", { text: "LLM" });

		new Setting(containerEl)
			.setName("接口地址")
			.setDesc("OpenAI 兼容接口的 baseUrl，例如 http://127.0.0.1:8181/v1。")
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.llm.baseUrl)
					.setValue(this.host.settings.llm.baseUrl)
					.onChange(async (value) => {
						this.host.settings.llm.baseUrl = value.trim();
						await this.host.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("API Key")
			.setDesc("调用 LLM 接口所需的 API Key。")
			.addText((text) => {
				text.inputEl.type = "password";
				text
					.setPlaceholder("请输入 API Key")
					.setValue(this.host.settings.llm.apiKey)
					.onChange(async (value) => {
						this.host.settings.llm.apiKey = value.trim();
						await this.host.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("模型")
			.setDesc("用于整理转写稿的模型名称，例如 deepseek-chat。")
			.addText((text) =>
				text
					.setPlaceholder("请输入模型名称")
					.setValue(this.host.settings.llm.model)
					.onChange(async (value) => {
						this.host.settings.llm.model = value.trim();
						await this.host.saveSettings();
					}),
			);
	}
}
