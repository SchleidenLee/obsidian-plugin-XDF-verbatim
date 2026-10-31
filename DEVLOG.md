# DEVLOG — XDF Verbatim

> 变更时间线：日期 + 改了什么 + 为什么。

| 日期 | 改动 | 为什么 |
|------|------|--------|
| 2026-10-31 | 建仓骨架：manifest / package / esbuild / tsconfig / release CI / src 占位 + 四件套；设计定稿全量写入 PENDING | 会议流水线立项。原名 xdf-scribe，嫌朴素改名 **xdf-verbatim**（"逐字稿"，直指转写核心） |
| 2026-10-31 | 方案修订：模板改**固定路径** `00.SYSTEM/xdf_base/templates/meeting/`（去掉设置项）；三个周例会命令**不迁移**，留在 base 做模板化改造 | 用户裁定脚本归 base/QuickAdd 管。设置项会带来插件间依赖、配置漂移、脚本拷走即失效；base 既有惯例本就是硬常量 `SYSTEM_DIR`。模板同时是用户要改的资产，不能进无条件覆盖清单 |
