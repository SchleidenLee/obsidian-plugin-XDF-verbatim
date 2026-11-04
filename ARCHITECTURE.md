# ARCHITECTURE — XDF Verbatim

> 目标架构（v0.1.0 规划态，实现期间随现状更新）。最近修订：2026-11-05。

## 定位

会议流水线插件：**面板内录音** → 讯飞「录音文件转写大模型」（发言人分离）→ LLM 按页面约束整理《会议记录》《教研笔记》→ 面板预览确认后写回例会文件夹。

**职责边界（2026-11-05 修订）**：

| 范围 | 归属 | 内容 |
|---|---|---|
| 建档 / 记录 / 添加页面 | `xdf-base` | 三个 preset 留在 base；目录命名（`{fy}/{seasonFolderName}/{date} 第{n}次例会`）、frontmatter、空壳文件、模板渲染全部由 base 负责 |
| 录音 / 转写 / 整理 / 写回 | 本插件 | 面板录音 → 转写 → 整理 → 写回**已存在**的 md 文件 |
| `attachment/` 子目录 | 本插件 | base 暂无此能力，由本插件按需创建 |

本插件**不自建例会目录、不读写模板、不参与例会文件夹命名**。与 base 的唯一接触面是「一个已存在的文件路径 + 一段正文」，因此 base 调整目录格式时本插件无需跟着改。

## 目录结构（规划）

```
src/
  main.ts            ← 入口：注册命令/面板/Ribbon，onload 恢复未完成转写轮询
  settings.ts        ← 设置：讯飞 appId/apiKey/apiSecret、LLM baseUrl/key
  session.ts         ← 会话状态机：data.json 读写、状态迁移、断点续传（绑定关系不持久化）
  record/
    Recorder.ts      ← MediaRecorder 封装（webm/opus，pause/resume/stop）
  providers/
    xunfei.ts        ← 讯飞录音文件转写（HMAC-SHA1 签名 + 上传/轮询）
  panel/
    MeetingPanel.ts  ← ItemView：绑定/录音/转写/整理/预览/写入
  llm/
    client.ts        ← NewAPI 兼容口调用
    organize.ts      ← 一次调用：转写稿 + 页面全文 + 角色 prompt → 正文
  util/
    vault.ts         ← 路径处理、frontmatter 拆装、音频 SHA-256 指纹、attachment 目录创建
```

## 数据流

```
绑定页面（当前笔记 → 确认 会议记录 / 教研笔记 → 校验例会文件夹）   ← 仅面板内存
  ↓
录音（MediaRecorder → Blob）
  ↓
落盘 attachment/{YYYY-MM-DD} {类型}.webm
  ↓ 绑定页面顶部插 ![[录音]] + 首页 📂 区追加 - [[录音|🎧 会议录音]]
转写（讯飞 upload → orderId → 轮询 getResult）→ transcript（面板可编辑，存 data.json）
  ↓
整理（system: 角色 + 类型规范兜底；user: transcript + 绑定页面全文）→ draft
  ↓
面板预览（可编辑）→ 用户点「确认写入」
  ↓
保留原 frontmatter、整体替换正文 → 写回绑定页面
```

## 持久化

- 插件 `data.json`：转写任务全量（`audioPath` / `audioHash` / `orderId` / `signatureRandom` / `state` / `transcript` / `draft`），每状态变更即写；断点续传依赖 orderId + signatureRandom 持久化
- **绑定关系（targetFile / meetingFolder / docType）不持久化**，重启即失效，仅作面板工作态
- **不在 vault 生成中间文件**（转写稿只存插件 `data.json`，用户明确要求）

## 依赖

- 软依赖 `xdf-base`：**仅**用于读 `folderStructure.admin` 定位周例会根；缺席回退 `"Admin"`。不读 base 的模板目录
- 模板与建档全部归 base（`src/xdf/templates/**/*.md` → `00.SYSTEM/xdf_base/templates/{build-in,customized}/`），本插件不引用
- frontmatter 键名（date / meeting_number / fiscal_year / section）被 ClassTracker、SQLite 消费，写入时**原样保留**，不新增不改名
- 录音参考 `references/Scuttlebutt/src/recorder.ts`（MIT，不入库）
- 独立 git 仓库，不依赖 base 的构建产物
- **已知风险**：base「周例会记录」对已存在文件有跳过逻辑，需确认在建档后重跑时不会冲掉本插件写入的正文（见 PENDING ⚪ 待定）

## 构建

- esbuild → `dist/`（manifest/styles 一并拷入，三件套齐全）；tsc 仅类型检查
- 编译命令用 wsl 风格路径（工作区约定）
- 发布：推 `v*` tag → `.github/workflows/release.yml` 校验 package.json / manifest.json / tag 三处版本一致 → 自动构建发布，不手搓 Release
