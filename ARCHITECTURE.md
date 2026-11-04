# ARCHITECTURE — XDF Verbatim

> 现状架构（v0.1.0 已实现，2026-11-05 验收）。

## 定位

会议流水线插件：**面板内录音** → 讯飞「录音文件转写大模型」（发言人分离）→ LLM 按页面约束整理《会议记录》《教研笔记》→ 面板预览确认后写回例会文件夹。

**职责边界（2026-11-05 修订）**：

| 范围 | 归属 | 内容 |
|---|---|---|
| 建档 / 记录 / 添加页面 | `xdf-base` | 三个 preset 留在 base；目录命名（`{fy}/{seasonFolderName}/{date} 第{n}次例会`）、frontmatter、空壳文件、模板渲染全部由 base 负责 |
| 录音 / 转写 / 整理 / 写回 | 本插件 | 面板录音 → 转写 → 整理 → 写回**已存在**的 md 文件 |
| `attachment/` 子目录 | 本插件 | base 暂无此能力，由本插件按需创建 |

本插件**不自建例会目录、不读写模板、不参与例会文件夹命名**。与 base 的唯一接触面是「一个已存在的文件路径 + 一段正文」，因此 base 调整目录格式时本插件无需跟着改。

## 目录结构（现状）

```
src/
  main.ts            ← 入口 + 编排：注册命令/面板/Ribbon；bindCurrentFile / startRecording /
                       stopRecording / transcribe / organize / writeToNote；PanelHost 实现
  types.ts           ← 跨模块接口契约（Binding / Session / Provider / Recorder / Settings），改动需同步各方
  settings.ts        ← 设置页：讯飞 appId/apiKey/apiSecret/timeout/poll、LLM baseUrl/key/model
  session.ts         ← data.json 读写：mergeSettings 两层深合并、loadPersistedData、createEmptySession、describeState
  record/
    Recorder.ts      ← MeetingRecorder implements Recorder（webm/opus，pause/resume/abort）
  providers/
    xunfei.ts        ← 讯飞录音文件转写（HMAC-SHA1 签名 + upload/getResult 轮询），HttpAdapter 可注入
  panel/
    MeetingPanel.ts  ← ItemView：绑定/录音/转写/整理/预览/写入，ConfirmModal 二次确认
  llm/
    client.ts        ← NewAPI 兼容口（POST {baseUrl}/chat/completions，Bearer）
    organize.ts      ← buildOrganizeMessages / cleanModelOutput / organize（一次调用）
  util/
    crypto.ts        ← sha256Hex、hmacSha1Base64、randomAlphaNumeric
    format.ts        ← formatDuration、recordedMs、sanitizeFileName、buildAudioBaseName
    vault.ts         ← ensureFolder、uniquePath、splitFrontmatter、insertPlayerAtBodyTop、appendMeetingLink
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

- 插件 `data.json`：`{ settings, session }`，每次状态变更即写；`session` 含 `audioPath` / `audioHash` / `orderId` / `signatureRandom` / `state` / `transcript` / `draft` / `error`
- **跨重启不续轮询**：`orderId` 只在转写成功后落库，重启后重新点「转写」会重新上传音频（结果正确、只是重复消耗一次上传/转写）。真正的断点续传未实现，见 PENDING
- **绑定关系（targetFile / meetingFolder / docType）不持久化**，重启即失效，仅作面板工作态；重启后转写/整理/写入需重新绑定页面
- **不在 vault 生成中间文件**（转写稿只存插件 `data.json`，用户明确要求）

## 实现约定与坑（勿回退）

- 讯飞签名：HMAC-**SHA1**，key = APISecret **原始 UTF-8**（勿 base64 解码）；参数按 key 字典序、值 form 编码（空格→`+`）后 `&` 连接；空值不参与签名
- `signatureRandom` 16 位字母数字，上传生成、轮询全程复用；`dateTime` 为 `yyyy-MM-dd'T'HH:mm:ss±HHmm`（偏移无冒号）
- `language` 只能 `autodialect` / `autominor`，写 `autodetect` / `zh_cn` 会返回 `100020`
- 音频格式实测：**webm/opus 可直传**（服务端按内容识别），含 `ffmpeg -f webm -live 1` 生成的**无 Cues、Duration=N/A** 流式文件
- 录音 mimeType 固定 `audio/webm;codecs=opus`（Electron 实测：`audio/ogg;codecs=opus`、`audio/wav` 不被支持）
- HTTP 层统一走可注入的 `HttpAdapter`（默认 `requestUrl`，测试注入 Node fetch）；`requestUrl` **不支持 AbortSignal / 流式响应**
- 播放器与链接写入的契约：`splitFrontmatter` 返回的 `frontmatter` **包含首尾 `---` 及尾换行**，拼回时直接 `${frontmatter}${newBody}`
- 写回时只保留正文第一行的 `.webm` 内嵌作为播放器，其余正文整体被整理稿替换（覆盖风险由「面板预览 + 确认」兜底）
- `stopRecording` 顺序：`createBinary` → **立即建 session 并落库** → 再插播放器/首页链接（后两步失败只提示，不把已保存音频标记成 error）

## 依赖

- 运行时**不依赖** `xdf-base`：绑定靠当前打开文件及其父目录名，不读 base 设置、不读模板
- 模板与建档全部归 base（`src/xdf/templates/**/*.md` → `00.SYSTEM/xdf_base/templates/{build-in,customized}/`），本插件不引用
- frontmatter 键名（date / meeting_number / fiscal_year / section）被 ClassTracker、SQLite 消费，写入时**原样保留**，不新增不改名
- 录音参考 `references/Scuttlebutt/src/recorder.ts`（MIT，不入库）
- 独立 git 仓库，不依赖 base 的构建产物
- **已知风险**：base「周例会记录」对已存在文件有跳过逻辑，需确认在建档后重跑时不会冲掉本插件写入的正文（见 PENDING ⚪ 待定）
- **未验证**：真实 Obsidian（Electron）内的 MediaRecorder 录音与面板渲染/交互，只能在用户环境实测

## 构建

- esbuild → `dist/`（manifest/styles 一并拷入，三件套齐全）；tsc 仅类型检查
- 编译命令用 wsl 风格路径（工作区约定）
- 发布：推 `v*` tag → `.github/workflows/release.yml` 校验 package.json / manifest.json / tag 三处版本一致 → 自动构建发布，不手搓 Release
