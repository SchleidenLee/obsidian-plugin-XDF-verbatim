# ARCHITECTURE — XDF Verbatim

> 目标架构（v0.1.0 规划态，实现期间随现状更新）。

## 定位

会议流水线插件：例会录音 → 讯飞「录音文件转写大模型」（发言人分离）→ LLM 按外置模板整理《会议记录》《教研笔记》→ 确认后写回例会文件夹。同时接管原 base 的周例会建档/记录/添加页面三个命令（原生 TS，不再走 QuickAdd preset）。

## 目录结构（规划）

```
src/
  main.ts            ← 入口：注册命令/面板/Ribbon，onload 恢复未完成转写轮询
  settings.ts        ← 设置：讯飞 appId/apiKey/apiSecret、LLM baseUrl/key、模板目录
  session.ts         ← 会话状态机：data.json 读写、状态迁移、断点续传
  providers/
    xunfei.ts        ← 讯飞录音文件转写（HMAC-SHA1 签名 + 上传/轮询）
  panel/
    MeetingPanel.ts  ← ItemView：按钮组 + 状态显示 + 转写稿/整理稿编辑预览
  llm/
    client.ts        ← NewAPI 兼容口调用
    organize.ts      ← 整理：转写稿+模板 → 正文
    merge.ts         ← 合并：手打稿+整理稿（硬规则：手打条目一条不丢）
  templates/
    engine.ts        ← {{占位符}} 渲染 + 校验（未知占位符即报错中止）
  commands/
    meetingSetup.ts  ← 周例会建档（原 base preset 迁移）
    meetingRecord.ts ← 周例会记录（原 base preset 迁移）
    addPage.ts       ← 例会添加页面（原 base preset 迁移）
  util/
    vault.ts         ← 路径处理、frontmatter 拆装、音频 SHA-256 指纹
```

## 数据流

```
音频 ─(读取 + 校验例会文件夹)→ 面板绑定 session
音频 ─(讯飞 upload)→ orderId ─(轮询 getResult)→ 转写稿 → session.transcript（面板可编辑）
转写稿 + 模板 ─(LLM 整理)→ draft → 面板预览
draft + 目标文件手打内容 ─(LLM merge，可选)→ merged
「写入」→ 保留原 frontmatter、替换正文 → 会议记录.md / 教研笔记.md
        → 例会首页追加 - [[录音名|🎧 会议录音]]
```

## 持久化

- 插件 `data.json`：session 全量（音频指纹、orderId、转写稿、整理稿），每状态变更即写；断点续传依赖 orderId + signatureRandom 持久化
- **不在 vault 生成中间文件**（转写稿只存插件 data.json，用户明确要求）

## 依赖

- 软依赖 `xdf-base`：读 `folderStructure.admin` 定位周例会根；缺席回退 `"Admin"`
- frontmatter 键名（date / meeting_number / fiscal_year / section）被 ClassTracker、SQLite 消费，**不可改**
- 独立 git 仓库，不依赖 base 的构建产物

## 构建

- esbuild → `dist/`（manifest/styles 一并拷入，三件套齐全）；tsc 仅类型检查
- 编译命令用 wsl 风格路径（工作区约定）
- 发布：推 `v*` tag → `.github/workflows/release.yml` 校验 package.json / manifest.json / tag 三处版本一致 → 自动构建发布，不手搓 Release
