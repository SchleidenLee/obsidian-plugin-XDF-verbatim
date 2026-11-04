# XDF Verbatim

> 从会议录音到成稿：XDF 教学系统的例会流水线插件。

## 是什么

侧边面板驱动的会议流水线：

1. **绑定页面** — 选中 `会议记录.md` 或 `教研笔记.md`，确认类型并校验所属例会文件夹
2. **录音** — 面板内直接录（webm/opus），支持暂停/继续；文件自动落进当次例会的 `attachment/`，页面正文顶部插内嵌播放器，首页补 🎧 引用
3. **转写** — 科大讯飞「录音文件转写大模型」，发言人分离；orderId 持久化断点续传，重启 Obsidian 继续轮询
4. **整理** — 一次 LLM 调用：转写 raw + 页面现有内容作约束，按会议记录 / 教研笔记各自的规范直接出稿
5. **写入** — 面板预览确认后，保留 frontmatter 只换正文

**建档 / 记录 / 添加页面、模板、目录命名全部由 xdf-base 负责**（周例会建档 / 周例会记录 / 例会添加页面三个命令），本插件不接管、不读写模板、不参与例会文件夹命名。分工是：base 把空壳文件和目录准备好，本插件负责录音与会后成稿，并额外创建 `attachment/` 子目录（base 暂无此能力）。因此 base 调整目录或模板格式时，本插件无需跟改。

## 给谁

XDF 教学系统（Obsidian 工作流）用户。建议在 xdf-base 之后启用：例会文件夹与空壳文件需先由 base 的「周例会记录 / 周例会建档」命令建好；无 base 也能跑（admin 路径回退 `Admin`），只是需自行准备文件夹与文件。

## 安装

1. 下载 release 三件套（main.js / manifest.json / styles.css）放入 `.obsidian/plugins/xdf-verbatim/`
2. 启用插件，设置中填：讯飞 appId / apiKey / apiSecret，LLM（NewAPI 兼容）baseUrl / key（无需配置模板目录）
3. 命令面板搜「Verbatim」打开面板

## 状态

设计定稿（见 [PENDING.md](./PENDING.md)），实现未开始。架构见 [ARCHITECTURE.md](./ARCHITECTURE.md)。
