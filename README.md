# XDF Verbatim

> 从会议录音到成稿：XDF 教学系统的例会流水线插件。

## 是什么

侧边面板驱动的会议流水线：

1. **读取录音** — 绑定例会文件夹（`YYYY-MM-DD 第N次例会`），校验 `会议记录.md` / `教研笔记.md` 就位
2. **转写** — 科大讯飞「录音文件转写大模型」，发言人分离；orderId 持久化断点续传，重启 Obsidian 继续轮询
3. **整理** — LLM 按模板（`00.SYSTEM/xdf_base/templates/meeting/` 下的 md 文件，随时可改）整理会议记录 / 教研笔记，面板内预览编辑
4. **合并**（可选）— 手打要点 + 整理稿再过一遍 LLM，硬规则：手打条目一条不丢
5. **写入** — 强确认（显示将覆盖的行数）后保留 frontmatter 只换正文，首页自动补 🎧 录音链接

周例会建档 / 周例会记录 / 例会添加页面三个命令**仍由 xdf-base 提供**，本插件不接管；本批只把它们的正文改成读同一套模板渲染。

## 给谁

XDF 教学系统（Obsidian 工作流）用户。建议在 xdf-base 之后启用；无 base 也能跑（admin 路径回退 `Admin`）。

## 安装

1. 下载 release 三件套（main.js / manifest.json / styles.css）放入 `.obsidian/plugins/xdf-verbatim/`
2. 启用插件，设置中填：讯飞 appId / apiKey / apiSecret，LLM（NewAPI 兼容）baseUrl / key
   （模板目录固定为 `00.SYSTEM/xdf_base/templates/meeting/`，无需设置；由 xdf-base 首次释放，之后随意修改）
3. 命令面板搜「Verbatim」打开面板

## 状态

设计定稿（见 [PENDING.md](./PENDING.md)），实现未开始。架构见 [ARCHITECTURE.md](./ARCHITECTURE.md)。
