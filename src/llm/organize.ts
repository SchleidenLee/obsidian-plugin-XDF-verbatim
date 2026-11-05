import type { ChatMessage } from "../types";
import type { LlmClient } from "./client";
import type { PromptSpec } from "./prompts";

const SYSTEM_PROMPT = `你是一位资深会议记录整理专家，擅长把口语化的会议逐字稿整理成结构清晰、可直接归档的书面笔记。

【硬规则】
1. 只输出正文 markdown。不要输出 frontmatter，不要用 \`\`\` 代码围栏包裹全文，不要写"以下是整理结果""好的，我来整理"之类的开场白或结束语。
2. 严禁编造录音里没有的事实、人名、数字、结论。信息缺失就留空或写明"未提及"，不要推测、补全或美化。
3. 页面现有内容的章节结构与详略程度优先照搬，把它当作格式约束：标题层级、章节顺序、条目粒度尽量与页面一致，只在其基础上补充、归并转写内容；不要随意新增或删除章节。
4. 以下是兜底章节（仅在页面为空壳时生效），按此输出章节结构；页面已有内容时忽略。
5. 把口语转成书面表达，去掉"嗯、啊、那个、就是说、然后"等语气词与重复赘述，但必须保留实质性观点、结论、数字与待办事项。
6. 转写里的 Speaker N 只用于区分发言人，最终正文不要出现 "Speaker" 字样；确有必要交代出处时，用"有老师提出""会上确认"等自然表述。

【输出要求】
- 使用 markdown 标题与无序列表组织内容，条目简洁、动词开头。
- 同一议题的零散发言要合并归纳，不要按发言顺序流水账式罗列。
- 只输出整理后的正文，不要解释你的处理过程。`;

/** 把兜底章节 + 专属规则拼进 system prompt，并把 displayName 放进去 */
function buildSystemPrompt(spec: PromptSpec): string {
	const sectionsBlock = spec.defaultSections.length
		? spec.defaultSections.map((s) => `   - ${s}`).join("\n")
		: "   （未配置兜底章节，按转写内容自行归纳）";

	const specRulesBlock = spec.systemRules.length
		? `\n\n【${spec.displayName}专属规则】\n${spec.systemRules.join("\n")}`
		: "";

	return (
		`${SYSTEM_PROMPT}\n\n本次要整理的文档类型是「${spec.displayName}」。\n` +
		`默认章节：\n${sectionsBlock}${specRulesBlock}`
	);
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

export async function organize(
	client: LlmClient,
	spec: PromptSpec,
	transcript: string,
	pageContent: string,
): Promise<string> {
	const raw = await client.chat(buildOrganizeMessages(spec, transcript, pageContent));
	return cleanModelOutput(raw);
}
