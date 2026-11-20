export interface PromptSpec {
	/** 内部标识（小写，用于路由表 key 与 Binding.docType） */
	docType: string;
	/** 面板绑定弹窗显示名 */
	displayName: string;
	/** 哪些文件名自动匹配 */
	matchBasenames: string[];
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
		systemRules: [
			"1. 只整理与本次会议相关的内容：会前闲聊、会中插入的无关话题、会后收拾等放不进页面任何章节的内容，不整理进正文；拿不准是否相关的，保留。",
			"2. 本周工作：记各老师本周工作完成情况与关键进展，只记结论与做法，不记经过与背景；「课量」小节记课量达标、超课时奖励、代课抢手等课量相关信息。",
			"3. 问题与协调：记会上提出的问题与协调结论，含负责人、时限（转写提到的才写），只记结论与做法，不记事件经过。",
			"4. 会议内容：记学习、培训、教研类内容；「学习内容」小节记学了什么、要点与结论，不记案例过程；「通知事项」小节记行政通知，每条含时限、做法、注意。",
			"5. 下周计划：记下周工作安排与计划，含负责人、时限（转写提到的才写），只记结论与做法，不记经过与背景。",
		],
		needsDbInjection: false,
	},
	research: {
		docType: "research",
		displayName: "教研笔记",
		matchBasenames: ["教研笔记"],
		systemRules: [],
		needsDbInjection: false,
	},
};

/** 按文件 basename 查找 PromptSpec，找不到返回 null */
export function findSpecByBasename(basename: string): PromptSpec | null {
	return Object.values(PROMPT_SPECS).find((s) => s.matchBasenames.includes(basename)) ?? null;
}
