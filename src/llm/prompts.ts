export interface PromptSpec {
	/** 内部标识（小写，用于路由表 key 与 Binding.docType） */
	docType: string;
	/** 面板绑定弹窗显示名 */
	displayName: string;
	/** 哪些文件名自动匹配 */
	matchBasenames: string[];
	/** 页面空壳时的兜底章节 */
	defaultSections: string[];
	/** 追加到 system prompt 的专属硬规则 */
	systemRules: string[];
	/** DB 注入开关（留给 V8） */
	needsDbInjection: boolean;
}

/** 路由表：所有文档类型的真相源 */
export const PROMPT_SPECS: Record<string, PromptSpec> = {
	meeting: {
		docType: "meeting",
		displayName: "会议记录",
		matchBasenames: ["会议记录"],
		defaultSections: ["本周工作（含课量）", "问题与协调", "会议内容（含学习内容）", "下周计划"],
		systemRules: [],
		needsDbInjection: false,
	},
	research: {
		docType: "research",
		displayName: "教研笔记",
		matchBasenames: ["教研笔记"],
		defaultSections: ["问题沟通", "批课磨课"],
		systemRules: [],
		needsDbInjection: false,
	},
};

/** 按文件 basename 查找 PromptSpec，找不到返回 null */
export function findSpecByBasename(basename: string): PromptSpec | null {
	return Object.values(PROMPT_SPECS).find((s) => s.matchBasenames.includes(basename)) ?? null;
}
