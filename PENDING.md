# PENDING — XDF Verbatim

> 待办清单。分区：**⚪ 待定**（方案未定）/ **🟡 已定待做**（方案已定，等动手）/ **🟢 进行中**。
> 完成一项后：从本文件**删除**该条 → 在 [DEVLOG.md](./DEVLOG.md) 追加一行 → 现状变了就更新 [ARCHITECTURE.md](./ARCHITECTURE.md)。
> 本文件当前为**设计定稿**（2026-10-31 多轮确认），动手时照此实现，不做发散。

---

## 🟢 进行中

（无）

---

## 🟡 已定待做

> 建议实现顺序：V5 模板机制 → V6 base 命令改造（这条链路不依赖转写，可先跑通）→ V1 讯飞 provider → V2 状态机 → V3 面板 → V4 LLM。

### V1. 讯飞「录音文件转写」provider

- [ ] 照抄改造 `references/obsidian-local-audio-plus/src/providers/xunfei.ts`（根工作区 references 目录，勿入库）
  - 签名要点（上游踩过的坑，勿改）：
    - HMAC-**SHA1**（不是 SHA256）；key = APISecret **原始 UTF-8**（勿 base64 解码）
    - 参数按 key **字典序**排列，值 form 编码（空格→`+`），join `&` 得 baseString
    - `signatureRandom`：上传时生成 16 位随机字母数字，**轮询全程复用同一个值**
    - `dateTime` 格式：`YYYY-MM-DDTHH:mm:ss±HH:MM`（本地时区偏移）
    - 上传成功拿 `orderId`；轮询 `getResult`：`status 4`=成功、`-1`=失败、其余继续等；超时上限 = `timeoutSeconds` 设置
    - 传输用 Obsidian `requestUrl`（讯飞国内直连，不做代理层）
  - 依赖：Node `crypto`（HMAC + 音频 SHA-256 指纹），零三方依赖
  - 发言人分离：`roleType=1`（可带 `roleNum`），解析 `orderResult.lattice`，`rl` 非零 → `Speaker N`

### V2. 会话状态机 + 断点续传

- [ ] `session` 持久化到插件 `data.json`，每次状态变更即写盘：
  - `session = { audioPath, audioHash(SHA-256), folder, orderId, signatureRandom, state, transcript, docs: { 会议记录: {draft, merged}, 教研笔记: {draft, merged} } }`
  - 插件 `onload` 发现未完成 `orderId` → 自动恢复轮询（断点续传）
- [ ] 音频缓存：读取前先算 SHA-256，命中缓存（已有转写稿）→ 直接跳到「已转写」，不重花钱

### V3. 侧边面板（ItemView）

- [ ] 流水线按钮组 + 状态可视化，v1 限制：**单音频/会话**：
  1. 「读取录音」：选音频 → 绑定文件名+母文件夹并显示；校验：例会文件夹内必须存在 `会议记录.md` **和** `教研笔记.md`（存在性检查，其余文件无视），不满足报错、禁止下一步，提示先跑「周例会记录」命令
  2. 例会文件夹绑定：音频父目录名匹配 `^\d{4}-\d{2}-\d{2} 第\d+次例会$` → 自动绑定；否则弹文件夹选择器（扫描 `{admin}/周例会` 下例会文件夹，最近优先）
  3. 读取完毕 → 灰色「转写」按钮点亮 → 状态显示：上传中 → 转写中 → 成功/失败
  4. 转写稿面板内查看、**可手动编辑**；持久化只存 `data.json`，**不生成可见原稿文件**（用户明确要求）
  5. 按绑定的文件名出「整理会议记录」「整理教研笔记」按钮（两支线独立）
  6. 整理稿面板预览；可选「merge」按钮（每文件独立）
  7. 「写入」：**强确认弹窗显示将被覆盖的行数** → 保留原文件 frontmatter、只换正文 → 例会首页 `📂 本次会议文件` 追加 `- [[录音名|🎧 会议录音]]`

### V4. LLM 整理与 merge

- [ ] NewAPI 兼容口（baseUrl + key，同 aichatbot / toolkits 惯例），设置面板配置
- [ ] 「整理」：转写稿 + 对应模板 → LLM → **只产正文 section**，frontmatter 由插件拼装
- [ ] 「merge」：目标文件现有手打内容 + 整理稿 → LLM；prompt 硬规则：**手打条目一条不丢、不编造、去重归类**（查的是手打遗漏，非录音遗漏）
- [ ] v1 不分段：1~2h 会议约几万字，128k 上下文模型放得下

### V5. 模板机制（固定路径 · 属 base 资产）

- [ ] 模板目录**固定**为 `00.SYSTEM/xdf_base/templates/meeting/`，**不做设置项**；脚本顶部一个常量 `TPL_DIR`（要换目录只改这一行）
  - 理由：base 既有惯例就是硬常量（`ScriptReleaser.ts` 的 `SYSTEM_DIR = "00.SYSTEM/xdf_base"`）。设置项会引入插件间依赖（base 脚本得读别的插件的 settings）、配置漂移（备份还原时设置不带、模板找不到）、脚本单独拷走即失效
- [ ] 模板 = vault 内 markdown 文件，支持 `{{占位符}}`；**文件名 = 页面类型**（扫目录自动发现，新增类型零代码；不用绝对路径、不做特殊层级）
- [ ] 变量集（克制，不搞模板引擎）：`date` / `meetingNumber` / `fiscalYear` / `season` / `section`
- [ ] 占位符未知或缺失 → Notice 报错**中止写入**（禁写半成品）
- [ ] **首次释放「缺才补」**：模板**不进** ScriptReleaser 的 SCRIPTS/ASSETS 清单（那份清单无条件覆盖，会冲掉用户改过的模板）；改为目录内缺文件时才写入默认模板
- [ ] 一份模板两用（默认采纳）：base 命令做变量替换生成空壳；verbatim 的 LLM 整理只取节骨架（去 frontmatter、去占位符）
- [ ] frontmatter 键名**不可改**（date / meeting_number / fiscal_year / section，被 ClassTracker、SQLite 消费）

### V6. base 三个命令改造（模板驱动，**不迁移**）

- [ ] 三个 preset 留在 base，只把硬编码正文换成模板渲染：**周例会记录 / 周例会建档 / 例会添加页面**
  - 共享逻辑抽成 asset：`src/xdf/scripts/assets/MeetingTemplates.ts` → 释放为 `00.SYSTEM/xdf_base/scripts/assets/MeetingTemplates.js`（照 `ArchiveUtils.ts` 惯例，三个命令 load 它）
  - 替换点：`周例会记录.ts` 的 homeContent / recordContent / researchContent、`周例会建档.ts` 的 summaryHome 等、`例会添加页面.ts` 的 PAGES 字典（每类型一个模板文件）
  - 通用/新建笔记/追加到笔记**不动**；档案管理脚本模板外置 = 后续批次，本批不动
  - **不清理任何已释放脚本**（没有迁移，`00.SYSTEM/xdf_base/scripts/presets/行政工作/*.js` 继续照常释放）
- [ ] admin 根路径仍读 base settings `folderStructure.admin`，缺省 `"Admin"`（同现状）

### V7. 发布前置

- [ ] 动手时先 `pnpm install` 生成 lockfile 并提交（release CI 用 `--frozen-lockfile`）
- [ ] 发布走 `.github/workflows/release.yml`：推 `v*` tag，三处版本一致后自动构建发布

---

## ⚪ 待定

- 录音插件选型：用户录音插件未定（Obsidian 自带录音不能自定义保存路径）。面板「读取录音」为两段式绑定设计，已兼容任意录音插件，不阻塞本插件。

---

## 附：例会 vault 结构约定（V6 base 命令改造照此实现）

```
{admin}/周例会/                     ← admin 取 base settings，默认 "Admin"
  FY27/                             ← 财年文件夹（7 月起始：m>=7 ? y+1 : y）
    2026秋季/                       ← Section 1（7~12 月，日历年 = FY 起始年）
      2026秋季.md                   ← 导航页（fiscal_year/section/starting_date/ending_date + 📚 会议索引）
      2026-10-29 第3次例会/         ← 例会文件夹（日期 + 第N次例会；N = 同目录 max+1；默认周四）
        2026-10-29 第3次例会.md      ← 首页（date/meeting_number/fiscal_year/section + 📂本次会议文件 / ✅待办 / 📝备注）
        会议记录.md                 ← 本周工作/学生情况/问题与协调/下周计划；tags: 行政+周例会
        教研笔记.md                 ← 主题/内容纪要/要点总结；tags: 教研+周例会
    2027春季/                       ← Section 2（1~6 月，日历年 = FY 起始年+1）
```

- 总结会 = 每学期第一次会议（meeting_number: 1 + 额外 `#总结会` tag），节结构同例会
- 写入时首页追加：`- [[录音名|🎧 会议录音]]`（进 📂 本次会议文件 区）
