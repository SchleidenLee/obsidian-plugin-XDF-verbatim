// 运行：node --test tests/organize.test.ts
// Node >= 22.18 默认支持 TS 类型剥离；organize/prompts 不依赖 Obsidian 运行时。
import test from "node:test";
import assert from "node:assert/strict";
import { buildOrganizeMessages, cleanModelOutput } from "../src/llm/organize.ts";
import { PROMPT_SPECS } from "../src/llm/prompts.ts";

const PAGE = "## 本周工作\n\n#### 课量\n\n## 问题与协调\n\n## 会议内容\n\n### 学习内容\n\n##### 通知事项\n\n## 下周计划\n";
const TRANSCRIPT = "Speaker 1：今天下午必须完成组织氛围打分。\nSpeaker 2：好的。";

test("V13：兜底章节机制已删除", () => {
	const [system] = buildOrganizeMessages(PROMPT_SPECS.meeting, TRANSCRIPT, PAGE);
	assert.ok(!system.content.includes("兜底"));
	assert.ok(!system.content.includes("默认章节"));
	assert.ok(!("defaultSections" in PROMPT_SPECS.meeting));
});

test("V13：页面章节为唯一结构权威", () => {
	const [system] = buildOrganizeMessages(PROMPT_SPECS.meeting, TRANSCRIPT, PAGE);
	assert.ok(system.content.includes("唯一结构权威"));
});

test("V14：精简硬约束与正反例齐备", () => {
	const [system] = buildOrganizeMessages(PROMPT_SPECS.meeting, TRANSCRIPT, PAGE);
	for (const norm of ["加粗短标签", "50 字", "禁止第三层", "4 条", "议题不漏", "一律不写", "反例", "正例", "照转写原话保留"]) {
		assert.ok(system.content.includes(norm), `缺少规范：${norm}`);
	}
	assert.ok(system.content.includes("不要写\"未提及\"之类占位句"));
});

test("V13：meeting 专属规则注入（无关过滤＋分节口径）", () => {
	const [system] = buildOrganizeMessages(PROMPT_SPECS.meeting, TRANSCRIPT, PAGE);
	assert.ok(system.content.includes("【会议记录专属规则】"));
	assert.ok(system.content.includes("拿不准是否相关的，保留"));
	assert.ok(system.content.includes("通知事项"));
	assert.ok(system.content.includes("不记事件经过"));
});

test("research 无专属规则时不出现专属规则块", () => {
	const [system] = buildOrganizeMessages(PROMPT_SPECS.research, TRANSCRIPT, PAGE);
	assert.ok(!system.content.includes("专属规则】"));
	assert.ok(system.content.includes("教研笔记"));
});

test("user 消息同时携带页面内容与转写原文", () => {
	const [, user] = buildOrganizeMessages(PROMPT_SPECS.meeting, TRANSCRIPT, PAGE);
	assert.ok(user.content.includes("<页面现有内容>"));
	assert.ok(user.content.includes(PAGE));
	assert.ok(user.content.includes("<转写原文>"));
	assert.ok(user.content.includes(TRANSCRIPT));
});

test("cleanModelOutput 回归：围栏／开场白／思考块剥离", () => {
	assert.equal(cleanModelOutput("```markdown\n## 本周工作\n- 条目\n```"), "## 本周工作\n- 条目");
	assert.equal(cleanModelOutput("以下是整理结果：\n## 本周工作"), "## 本周工作");
	assert.equal(cleanModelOutput("<think>\n推理\n</think>\n## 本周工作"), "## 本周工作");
	assert.equal(cleanModelOutput("  ## 本周工作  "), "## 本周工作");
});
