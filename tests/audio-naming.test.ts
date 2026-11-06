// 运行：node --test tests/audio-naming.test.ts
// Node >= 22.18 默认支持 TS 类型剥离；不依赖 Obsidian 运行时，无需安装额外依赖。
import test from "node:test";
import assert from "node:assert/strict";
import { isOwnedAudioBasename, isOwnedAudioPath } from "../src/util/audio-naming.ts";

const DIR = "Admin/周例会/FY27/2026秋季/2026-10-29 第3次例会/attachment";
const NAME = "会议记录";

test("基础名匹配", () => {
	assert.equal(isOwnedAudioBasename("2026-11-05 会议记录", NAME), true);
});

test("BUG-1 回归：空格数字重名必须匹配", () => {
	assert.equal(isOwnedAudioBasename("2026-11-05 会议记录 1", NAME), true);
	assert.equal(isOwnedAudioBasename("2026-11-05 会议记录 12", NAME), true);
});

test("兼容历史括号形式，但不接受混合形式", () => {
	assert.equal(isOwnedAudioBasename("2026-11-05 会议记录 (1)", NAME), true);
	assert.equal(isOwnedAudioBasename("2026-11-05 会议记录 (2)", NAME), true);
	assert.equal(isOwnedAudioBasename("2026-11-05 会议记录 1 (1)", NAME), false);
});

test("不误匹配其他类型或前后缀", () => {
	assert.equal(isOwnedAudioBasename("2026-11-05 教研笔记", NAME), false);
	assert.equal(isOwnedAudioBasename("2026-11-05 会议记录x", NAME), false);
	assert.equal(isOwnedAudioBasename("2026-11-05 会议记录 1x", NAME), false);
});

test("displayName 含正则特殊字符时安全", () => {
	assert.equal(isOwnedAudioBasename("2026-11-05 会议记录(草) 1", "会议记录(草)"), true);
	assert.equal(isOwnedAudioBasename("2026-11-05 会议记录X 1", "会议记录(草)"), false);
});

test("路径保护：同目录同类型（含空格数字/历史括号）返回 true", () => {
	assert.equal(isOwnedAudioPath(`${DIR}/2026-11-05 会议记录.webm`, DIR, NAME), true);
	assert.equal(isOwnedAudioPath(`${DIR}/2026-11-05 会议记录 1.webm`, DIR, NAME), true);
	assert.equal(isOwnedAudioPath(`${DIR}/2026-11-05 会议记录 (3).webm`, DIR, NAME), true);
});

test("路径保护：其他类型、其他目录、子目录、非 webm 均不保护", () => {
	assert.equal(isOwnedAudioPath(`${DIR}/2026-11-05 教研笔记 2.webm`, DIR, NAME), false);
	assert.equal(isOwnedAudioPath(`Other/2026-11-05 会议记录 1.webm`, DIR, NAME), false);
	assert.equal(isOwnedAudioPath(`${DIR}/sub/2026-11-05 会议记录 1.webm`, DIR, NAME), false);
	assert.equal(isOwnedAudioPath(`${DIR}/2026-11-05 会议记录 1.md`, DIR, NAME), false);
});
