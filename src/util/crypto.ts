/**
 * 加密工具：仅依赖 Node 内置 crypto（Obsidian 桌面端可用）。
 * - sha256Hex：算音频指纹，用于命中转写缓存
 * - hmacSha1Base64：讯飞签名（key 为 apiSecret 原始 UTF-8 字符串，不做 base64 解码）
 * - randomAlphaNumeric：讯飞 signatureRandom
 */
import { createHash, createHmac, randomBytes } from "node:crypto";

/** 计算 ArrayBuffer 的 SHA-256 十六进制摘要 */
export async function sha256Hex(data: ArrayBuffer): Promise<string> {
	return createHash("sha256").update(new Uint8Array(data)).digest("hex");
}

/** HMAC-SHA1 后取 base64；key 按 UTF-8 原始字节使用 */
export function hmacSha1Base64(key: string, data: string): string {
	return createHmac("sha1", Buffer.from(key, "utf8")).update(data, "utf8").digest("base64");
}

/** 生成指定长度的随机字母数字串（讯飞 signatureRandom 用） */
export function randomAlphaNumeric(length: number): string {
	const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
	return Array.from(randomBytes(length), (byte) => alphabet[byte % alphabet.length]).join("");
}
