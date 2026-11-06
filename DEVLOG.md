# DEVLOG — XDF Verbatim

> 变更时间线：日期 + 改了什么 + 为什么。

| 日期 | 改动 | 为什么 |
|------|------|--------|
| 2026-10-31 | 建仓骨架：manifest / package / esbuild / tsconfig / release CI / src 占位 + 四件套；设计定稿全量写入 PENDING | 会议流水线立项。原名 xdf-scribe，嫌朴素改名 **xdf-verbatim**（"逐字稿"，直指转写核心） |
| 2026-10-31 | 方案修订：模板改**固定路径** `00.SYSTEM/xdf_base/templates/meeting/`（去掉设置项）；三个周例会命令**不迁移**，留在 base 做模板化改造 | 用户裁定脚本归 base/QuickAdd 管。设置项会带来插件间依赖、配置漂移、脚本拷走即失效；base 既有惯例本就是硬常量 `SYSTEM_DIR`。模板同时是用户要改的资产，不能进无条件覆盖清单 |
| 2026-10-31 | **架构收敛**：建档 / 记录 / 模板 / 目录命名统一归 **xdf-base**，本插件只做「读录音 → 转写 → 整理 → 写回已存在文件」。删除 PENDING V5（模板机制）、V6（base 命令改造，已落地为 `TplEngine + templates/index.ts + ArchiveUtils.loadTemplate`）；整理规范改为内联 prompt 常量；实现顺序改为 V1 讯飞 → V2 状态机 → V3 面板 → V4 LLM → V5 规范 | 两边都管建档会导致目录 / 模板 / frontmatter 双写冲突。base 是目录与模板的唯一权威，verbatim 只接触「已存在文件路径 + 正文」，base 改格式时本插件零改动 |
| 2026-11-05 | 流程修订：改为**插件内录音**（照抄 Scuttlebutt `recorder.ts`，webm/opus）+ **绑定单页**（会议记录 / 教研笔记二选一）+ **一步 LLM 整理**（转写 raw + 页面全文 + 角色 prompt，砍掉 merge）；`attachment/` 目录改由本插件创建；首页留 `- [[录音\|🎧 会议录音]]`、绑定页面正文顶部放内嵌播放器；绑定关系仅存面板内存 | 用户裁定：录音不再依赖第三方插件（MediaRecorder 实时 webm 已实测讯飞可直传，含无索引无 Duration 形态）；merge 属于多余步骤，预览 + 确认已能兜住覆盖风险；页面模板由 base 建档时填好，直接当整理约束即可 |
| 2026-11-05 | 实现 V1~V5：`providers/xunfei.ts`、`record/Recorder.ts`、`session.ts`、`settings.ts`、`panel/MeetingPanel.ts`、`llm/{client,organize}.ts`、`util/{crypto,format,vault}.ts`、`main.ts` 编排；`types.ts` 作接口契约；补 `pnpm-lock.yaml` | 按 PENDING 定稿落地。先定接口契约再并行实现，三路 subagent 无冲突；锁文件为 release CI 的 `--frozen-lockfile` 前置 |
| 2026-11-05 | 验收修复：`stopRecording` 改为 `createBinary` 后**立即**建 session 并落库，插播放器/首页链接包进独立 try/catch 只提示 | 原顺序下插引用抛错会走 `fail()`，音频已落盘但 session 丢失，用户无法再转写这条录音 |
| 2026-11-05 | 建自动化验收 harness（`.scratch/verbatim-test/harness/`，仓库外）：esbuild `--alias:obsidian=<stub>` 把 `obsidian` 模块换成假实现，Node 里跑 14 项；结果 **14 PASS / 0 FAIL**，含真实讯飞转写与真实本地 LLM 全链路（绑定→录音落盘→转写→整理→写回） | 无法在真实 Obsidian 里手动测试，需要可重复的编排级验收。踩坑记录：WSL 内无外网且 `127.0.0.1:8181` 指 WSL 自身，harness 必须用 **Windows node** 跑；构建产物 `dist/harness.cjs` 平台无关 |
| 2026-11-05 | **V7 PromptSpec 路由表重构**：新建 `llm/prompts.ts`，`PROMPT_SPECS` 单一真相源（meeting / research 两条，每条含 `defaultSections` / `systemRules` / `needsDbInjection`）；`organize` / `buildOrganizeMessages` 首参从 `DocType` 改为 `PromptSpec`；绑定弹窗从路由表动态生成 | 原页面类型散在 `types.ts` 联合 + `organize.ts` 硬编码兜底章节 + `SYSTEM_PROMPT` if 分流三处，加新类型要改三四处。路由表把所有 prompt 相关配置收进一处，加一行 spec 即可 |
| 2026-11-05 | 修复写回后正文两份音频播放器：`organize()` 里 `stripLeadingPlayer(body)` 剥离首行 `![[*.webm]]` 再喂 LLM（主修复）；`writeToNote()` 加 `draftAlreadyHasPlayer` 防御（兜底 LLM 没听话） | `stopRecording` 往正文插了播放器行 → `organize()` 把含播放器的正文原封不动喂 LLM → LLM 因硬规则「页面现有内容优先照搬」抄进 draft → `writeToNote()` 又从旧正文挖了一次插在 draft 顶部 → 两份。两边哲学不一致：prompt 不该包含插件技术性占位 |
| 2026-11-05 | 绑定页面自动找回已录音频：新增 `restoreSessionFromBinding()`，按 `yyyy-MM-dd {displayName}.webm` 命名在 binding 的 `attachment/` 里找 mtime 最新的一条，重建 session（重算 sha256）；已指向同目录同类型录音则不覆盖 | 会话只在停止录音时创建、绑定关系不持久化，重启后只能转写「最后一段录音」，同例会另一段录音彻底无法转写。命名约定本就是插件自己定的，用它反查比持久化绑定关系更省事 |
| 2026-11-06 | 文档纠偏：README 删除「实现未开始」和「重启续轮询」；写明 V7/双播放器/V9 仅为本地未发布实现，V8 未做；找回规则明确为同目录按页面类型匹配，不接管另一类型 webm | 过期 README 会让人按未实现或已发布能力排期。本次只改文档，未跑实机，QA 尚未验收 |
| 2026-11-06 | 文档登记 BUG-1：`vault.ts` 重名为空格加数字，当时 `main.ts` 找回正则只认括号 | 文档若只写括号，会把现行落盘文件排除在找回之外 |
| 2026-11-06 | 文档改记当前源码：`src/util/audio-naming.ts` 匹配基础名、空格数字和历史括号；`main.ts` 用 `isOwnedAudioPath` 保护同目录同类型会话。QA 独立复跑纯逻辑测试 7/7、tsc 通过；实现工程师另报告过临时 stub 集成 8/8，但当前工作区没有可复现入口，因此不作为正式验证结论。本条不把结果写成真实 Obsidian 通过 | 文档要跟已落地代码一致，同时保留实机未验收 |
