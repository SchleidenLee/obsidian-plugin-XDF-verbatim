# DEVLOG — XDF Verbatim

> 变更时间线：日期 + 改了什么 + 为什么。

| 日期 | 改动 | 为什么 |
|------|------|--------|
| 2026-10-31 | 建仓骨架：manifest / package / esbuild / tsconfig / release CI / src 占位 + 四件套；设计定稿全量写入 PENDING | 会议流水线立项。原名 xdf-scribe，嫌朴素改名 **xdf-verbatim**（"逐字稿"，直指转写核心） |
| 2026-10-31 | 方案修订：模板改**固定路径** `00.SYSTEM/xdf_base/templates/meeting/`（去掉设置项）；三个周例会命令**不迁移**，留在 base 做模板化改造 | 用户裁定脚本归 base/QuickAdd 管。设置项会带来插件间依赖、配置漂移、脚本拷走即失效；base 既有惯例本就是硬常量 `SYSTEM_DIR`。模板同时是用户要改的资产，不能进无条件覆盖清单 |
| 2026-10-31 | **架构收敛**：建档 / 记录 / 模板 / 目录命名统一归 **xdf-base**，本插件只做「读录音 → 转写 → 整理 → 写回已存在文件」。删除 PENDING V5（模板机制）、V6（base 命令改造，已落地为 `TplEngine + templates/index.ts + ArchiveUtils.loadTemplate`）；整理规范改为内联 prompt 常量；实现顺序改为 V1 讯飞 → V2 状态机 → V3 面板 → V4 LLM → V5 规范 | 两边都管建档会导致目录 / 模板 / frontmatter 双写冲突。base 是目录与模板的唯一权威，verbatim 只接触「已存在文件路径 + 正文」，base 改格式时本插件零改动 |
| 2026-11-05 | 流程修订：改为**插件内录音**（照抄 Scuttlebutt `recorder.ts`，webm/opus）+ **绑定单页**（会议记录 / 教研笔记二选一）+ **一步 LLM 整理**（转写 raw + 页面全文 + 角色 prompt，砍掉 merge）；`attachment/` 目录改由本插件创建；首页留 `- [[录音\|🎧 会议录音]]`、绑定页面正文顶部放内嵌播放器；绑定关系仅存面板内存 | 用户裁定：录音不再依赖第三方插件（MediaRecorder 实时 webm 已实测讯飞可直传，含无索引无 Duration 形态）；merge 属于多余步骤，预览 + 确认已能兜住覆盖风险；页面模板由 base 建档时填好，直接当整理约束即可 |
