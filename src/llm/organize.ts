import type { ChatMessage } from "../types";
import type { LlmClient } from "./client";
import type { PromptSpec } from "./prompts";

const SYSTEM_PROMPT = `你是一位资深会议记录整理专家，擅长把口语化的会议逐字稿整理成结构清晰、可直接归档的书面笔记。

【硬规则】
1. 只输出正文 markdown。不要输出 frontmatter，不要用 \`\`\` 代码围栏包裹全文，不要写"以下是整理结果""好的，我来整理"之类的开场白或结束语。
2. 严禁编造录音里没有的事实、人名、数字、结论。信息缺失就把章节留空，不要写"未提及"之类占位句，不要推测、补全或美化。
3. 页面现有内容的章节结构是唯一结构权威：标题层级、章节顺序照搬页面，把转写内容归入对应章节；不要新增、删除或重排章节。页面没有任何章节时，按议题自行归纳章节。
4. 把口语转成书面表达，去掉"嗯、啊、那个、就是说、然后"等语气词与重复赘述，但必须保留实质性观点、结论、数字与待办事项。
5. 转写里的 Speaker N 只用于区分发言人，最终正文不要出现 "Speaker" 字样；确有必要交代出处时，用"有老师提出""会上确认"等自然表述。
6. 时间表述照转写原话保留（如"今天下午""下周三"），不要换算成具体日期。

【输出风格】
- 按议题组织：同一议题的零散发言合并归纳，不要按发言顺序流水账式罗列。
- 每个议题一个编号条目，条头为「**加粗短标签**：」，标签即议题名。
- 全面＝议题不漏（每个议题都有一个条目），不是细节不漏。

【精简硬约束】
- 子点一行写完，不超过 50 字，只写一条决定级信息。
- 最多两层：编号议题＋一层子点，禁止第三层。
- 每个议题子点不超过 4 条；能一行写完的议题不挂子点。
- 只保留：结论/决定、做法、数字、时限、人名、注意；注意单独成点（"注意：…"）。
- 一律不写：事件经过、背景、原因分析、举例、效果/意义/定性、讨论过程——再重要也压成一句结论。
- 加粗只用于议题标签，正文不滥用强调。
- 只输出整理后的正文，不要解释你的处理过程。

【正反例】
反例（禁止，过详）：
1. **考研学生占用教室**：
   - 现状：考研临近，很多考研学生成群或独自学习，自习的前提是占用教室。
   - 处理要求：上课教室被占用时让学生出来，上课优先；学生可去自习室，不够可用317大教室。
   - 注意：态度要温和，学生是衣食父母；部分场地与大学校区共用，不能强硬禁止。
正例（必须，同一内容）：
1. **考研学生占用教室**：
   - 上课优先，被占教室请学生让出，可去自习室或317。
   - 态度温和，必要时换隔壁教室；一对一可直接换小教室。
   - 注意：不能教室空着不上课。`;

/** 把专属规则拼进 system prompt；页面模板为唯一结构权威，无兜底章节 */
function buildSystemPrompt(spec: PromptSpec): string {
	const specRulesBlock = spec.systemRules.length
		? `\n\n【${spec.displayName}专属规则】\n${spec.systemRules.join("\n")}`
		: "";

	return `${SYSTEM_PROMPT}\n\n本次要整理的文档类型是「${spec.displayName}」。${specRulesBlock}`;
}

export function buildOrganizeMessages(
	spec: PromptSpec,
	transcript: string,
	pageContent: string,
): ChatMessage[] {
	const system = buildSystemPrompt(spec);
	const user = `<页面现有内容>\n${pageContent}\n</页面现有内容>\n\n<转写原文>\n${transcript}\n</转写原文>`;

	return [
		{ role: "system", content: system },
		{ role: "user", content: user },
	];
}

const FENCE_WRAPPER_RE = /^```[\w-]*[ \t]*\r?\n?([\s\S]*?)\r?\n?```$/;
const PLEASANTRY_RE = /^(以下是|下面是|这是|整理结果如下|好的[，,])/;

export function cleanModelOutput(text: string): string {
	let out = text ?? "";

	out = out.replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, "");
	out = out.replace(/<think[^>]*>[\s\S]*?<\/think>/gi, "");
	out = out.trim();

	const fenced = out.match(FENCE_WRAPPER_RE);
	if (fenced) {
		out = fenced[1].trim();
	}

	const firstBreak = out.indexOf("\n");
	if (firstBreak !== -1) {
		const firstLine = out.slice(0, firstBreak).trim();
		if (PLEASANTRY_RE.test(firstLine)) {
			out = out.slice(firstBreak + 1).trim();
		}
	}

	return out.trim();
}

export interface OrganizeResult {
	draft: string;
	/** 模型 finish_reason 为 length，输出疑似被截断 */
	truncated: boolean;
}

export async function organize(
	client: LlmClient,
	spec: PromptSpec,
	transcript: string,
	pageContent: string,
): Promise<OrganizeResult> {
	const raw = await client.chat(buildOrganizeMessages(spec, transcript, pageContent));
	return { draft: cleanModelOutput(raw.content), truncated: raw.truncated };
}
