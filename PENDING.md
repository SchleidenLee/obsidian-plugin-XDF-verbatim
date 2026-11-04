# PENDING — XDF Verbatim

> 待办清单。分区：**⚪ 待定**（方案未定）/ **🟡 已定待做**（方案已定，等动手）/ **🟢 进行中**。
> 完成一项后：从本文件**删除**该条 → 在 [DEVLOG.md](./DEVLOG.md) 追加一行 → 现状变了就更新 [ARCHITECTURE.md](./ARCHITECTURE.md)。
> 本文件当前为**设计定稿**（2026-10-31 初版，2026-11-05 修订：改为插件内录音 + 绑定页面 + 一步整理），动手时照此实现，不做发散。

---

## 🟢 进行中

（无）

---

## 🟡 已定待做

> 实现顺序：V1 讯飞 provider（独立可测）→ V2 录音器 → V3 状态机 → V4 面板 → V5 LLM 整理 → V6 发布前置。
> 建档 / 记录 / 模板 / 目录命名仍归 xdf-base；本插件额外负责建 `attachment/` 子目录（base 暂无此能力）。

### V1. 讯飞「录音文件转写」provider

- [ ] 照抄改造 `references/obsidian-local-audio-plus/src/providers/xunfei.ts`（根工作区 references 目录，勿入库）
  - 签名要点（上游踩过的坑，勿改）：
    - HMAC-**SHA1**（不是 SHA256）；key = APISecret **原始 UTF-8**（勿 base64 解码）
    - 参数按 key **字典序**排列，值 form 编码（空格→`+`），join `&` 得 baseString
    - `signatureRandom`：上传时生成 16 位随机字母数字，**轮询全程复用同一个值**
    - `dateTime` 格式：`yyyy-MM-dd'T'HH:mm:ss±HHmm`（本地时区偏移，**偏移量无冒号**，如 `2026-11-04T23:14:39+0800`）
    - `language` **必传**，官方只认两个值：`autodialect`（中英 + 202 种方言免切）、`autominor`（37 语种，需单独提交工单）；写 `autodetect` / `zh_cn` 会返回 `100020 auth service verification failed`（签名其实是过的，报错里会回显非法值）
    - 音频格式：文档列 `mp3 / wav / pcm / opus / flac / ogg / speex`（未提 webm），但 2026-11-04 实测 **webm/opus 可直接上传** —— mp3 / opus / ogg / webm 四种 20s 样本全部 `code 000000` 转写成功；服务端按内容识别，不看后缀。上限 5 小时 / 500MB
    - **2026-11-05 补充实测**：`ffmpeg -f webm -live 1` 生成的**无 Cues 索引、Duration=N/A** 的流式 webm 同样上传成功（`orderId DKHJQ20261104234020598GD03gNdOpk3sH4Qp`，3 段 109 字），证明讯飞按顺序流式解码、不依赖 seek。MediaRecorder 实时产出的正是这种形态
    - 上传成功拿 `orderId`；轮询 `getResult`：`status 4`=成功、`-1`=失败、其余继续等；超时上限 = `timeoutSeconds` 设置
    - 传输用 Obsidian `requestUrl`（讯飞国内直连，不做代理层）
  - 依赖：Node `crypto`（HMAC + 音频 SHA-256 指纹），零三方依赖
  - 发言人分离：`roleType=1`（可带 `roleNum`），解析 `orderResult.lattice`，`rl` 非零 → `Speaker N`

### V2. 录音器（Recorder）

- [ ] 照抄 `references/Scuttlebutt/src/recorder.ts`（MIT，169 行），mimeType 保持 `audio/webm;codecs=opus` **不改**
  - `getUserMedia` → `MediaRecorder.start(1000)` → `stop()` 返回 `Blob`
  - 支持 `pause()` / `resume()` / `abort()`；异常路径必须清理麦克风轨道
  - 多源混音（Web Audio `createMediaStreamDestination`）可保留，v1 只接麦克风
- [ ] 录音计时器：排除暂停时长（参考 Scuttlebutt `utils.ts` 的 `recordedMs`）

### V3. 会话状态机 + 断点续传

- [ ] **绑定关系是临时的**：只存面板内存，不写 `data.json`，重启 Obsidian 即失效
  - `binding = { targetFile, meetingFolder, attachmentDir, audioBaseName, docType: '会议记录' | '教研笔记' }`
- [ ] **转写任务持久化**到插件 `data.json`，每次状态变更即写盘：
  - `session = { audioPath, audioHash(SHA-256), orderId, signatureRandom, state, transcript, draft }`
  - 插件 `onload` 发现未完成 `orderId` → 自动恢复轮询（断点续传）
- [ ] 音频缓存：读取前先算 SHA-256，命中缓存（已有转写稿）→ 直接跳到「已转写」，不重花钱

### V4. 侧边面板（ItemView）

- [ ] 单音频 / 单会话，流程：
  1. **绑定页面**：取当前打开的笔记 → 用户确认类型（**会议记录** / **教研笔记**）→ 校验：
     - 文件名必须是 `会议记录.md` 或 `教研笔记.md`
     - 父目录名匹配 `^\d{4}-\d{2}-\d{2} 第\d+次例会$`
     - 不满足报错、禁止录音，提示先跑 base 的「周例会记录」命令
  2. **录音**：开始 / 暂停 / 继续 / 停止；实时计时；未绑定则按钮置灰
  3. **停止 → 落盘**：
     - 文件名 `{YYYY-MM-DD} {会议记录|教研笔记}.webm`（类型跟实际文件名走，不叫"教研记录"）
     - 目录 `{meetingFolder}/attachment/`，**不存在则由本插件创建**
     - 重名追加 ` 1` / ` 2`（`uniquePath`）
     - `vault.createBinary` 写盘
  4. **插引用**（两处）：
     - 绑定页面正文**最顶部**（frontmatter 之下第一行）插入内嵌播放器 `![[录音名.webm]]`
     - 例会首页 `📂 本次会议文件` 区追加 `- [[录音名|🎧 会议录音]]`，重复写入去重
  5. **转写**：上传中 → 转写中 → 成功/失败；转写稿面板内查看、**可手动编辑**；只存 `data.json`，**不生成可见原稿文件**
  6. **整理**：点「整理」→ 一次 LLM 调用（见 V5）
  7. **预览**：整理稿在面板内预览、可编辑
  8. **写入**：用户点「确认写入」→ 保留原文件 frontmatter、整体替换正文

### V5. LLM 整理（一步全干）

- [ ] NewAPI 兼容口（baseUrl + key，同 aichatbot / toolkits 惯例），设置面板配置
- [ ] **一次调用，无 merge、无多轮**：
  - system prompt：角色设定（如「你是资深会议记录整理专家」）+ 该类型的默认章节规范兜底
  - user message：**转写 raw 全文** + **绑定页面现有全文**（作为内容与格式约束）
  - 输出：最终正文，直接用于预览
- [ ] 默认章节兜底（页面为空壳时生效）：
  - 会议记录：本周工作 / 学生情况 / 问题与协调 / 下周计划
  - 教研笔记：主题 / 内容纪要 / 要点总结
- [ ] frontmatter **不交给模型**；写盘时原样保留（键名被 ClassTracker / SQLite 消费）
- [ ] 手打内容被覆盖由「面板预览 + 用户确认」兜底，不做 merge、不保留条目
- [ ] v1 不分段：1~2h 会议约几万字，128k 上下文模型放得下

### V6. 发布前置

- [ ] 动手时先 `pnpm install` 生成 lockfile 并提交（release CI 用 `--frozen-lockfile`）
- [ ] 发布走 `.github/workflows/release.yml`：推 `v*` tag，三处版本一致后自动构建发布

---

## ⚪ 待定

- **base「周例会记录」对已存在文件的覆盖策略**：该脚本对已存在文件有跳过逻辑。若 base 先建空壳 → 本插件写入整理稿 → 用户再跑一次 base 记录命令，是否会冲掉整理结果？需实测后决定（可能让 verbatim 写入后打标记，或 base 侧增加「正文非空不覆盖」判断）。

---

## 附：例会 vault 结构约定（建档归 xdf-base，此处仅供本插件定位参照）

```
{admin}/周例会/                     ← admin 取 base settings，默认 "Admin"
  FY27/                             ← 财年文件夹（7 月起始：m>=7 ? y+1 : y）
    2026秋季/                       ← Section 1（7~12 月，日历年 = FY 起始年）
      2026秋季.md                   ← 导航页（fiscal_year/section/starting_date/ending_date + 📚 会议索引）
      2026-10-29 第3次例会/         ← 例会文件夹（日期 + 第N次例会；N = 同目录 max+1；默认周四）
        2026-10-29 第3次例会.md      ← 首页（date/meeting_number/fiscal_year/section + 📂本次会议文件 / ✅待办 / 📝备注）
        会议记录.md                 ← 本周工作/学生情况/问题与协调/下周计划；tags: 行政+周例会
        教研笔记.md                 ← 主题/内容纪要/要点总结；tags: 教研+周例会
        attachment/                 ← 本插件创建，存 webm 录音
    2027春季/                       ← Section 2（1~6 月，日历年 = FY 起始年+1）
```

- 总结会 = 每学期第一次会议（meeting_number: 1 + 额外 `#总结会` tag），节结构同例会
