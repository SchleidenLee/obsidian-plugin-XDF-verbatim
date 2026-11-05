# PENDING — XDF Verbatim

> 待办清单。分区：**⚪ 待定**（方案未定）/ **🟡 已定待做**（方案已定，等动手）/ **🟢 进行中**。
> 完成一项后：从本文件**删除**该条 → 在 [DEVLOG.md](./DEVLOG.md) 追加一行 → 现状变了就更新 [ARCHITECTURE.md](./ARCHITECTURE.md)。
> 最近修订：2026-11-05（V1~V5 已实现并验收，仅剩发布与实测项）。

---

## 🟢 进行中

（无）

---

## 🟡 已定待做

### V7. PromptSpec 路由表重构（先于 DB 注入，依赖它）

- [ ] **动机**：当前页面类型散在三处硬编码 —— `types.ts` 的 `DocType` 联合类型（只有两种）、`llm/organize.ts` 的 `defaultSections`（两种固定兜底章节）、`SYSTEM_PROMPT`（两种硬规则 + DB 注入 if 逻辑）。加一种新类型（展课等）要改三四处，而且 DB 注入这种 prompt 专属开关无处安放
- [ ] **接口**（新文件 `src/llm/prompts.ts`）：
  ```ts
  export interface PromptSpec {
    docType: string;                 // 内部标识，如 "meeting" / "research" / "demo"
    displayName: string;             // 面板绑定弹窗给用户看的
    matchBasenames: string[];        // 哪些文件名自动匹配，如 ["会议记录"]
    defaultSections: string[];       // 页面空壳时的兜底章节（从 base 模板来）
    systemRules: string[];           // 追加到 system prompt 的专属硬规则
    needsDbInjection: boolean;       // 要不要查 DB 拼 <周报待办数据>（V7 用）
  }
  ```
- [ ] **路由表**（会议记录 / 教研笔记先注册，对齐 base 已改模板）：

  | docType | matchBasenames | defaultSections | needsDbInjection |
  |---|---|---|---|
  | meeting | ["会议记录"] | 本周工作(含课量子项) / 问题与协调 / 会议内容(含学习内容子项) / 下周计划 | **true** |
  | research | ["教研笔记"] | 问题沟通 / 批课磨课 | false |

  展课、一对一、班课等后续加一行就行
- [ ] **各模块改动**：
  - `types.ts`：`DocType` 保留但新增 `docType: string` 字段到 `Binding`（或直接用 `string` 替换联合类型，路由表即单一真相源）
  - `llm/organize.ts`：`buildOrganizeMessages(docType, transcript, pageContent)` 改为 `buildOrganizeMessages(spec, transcript, pageContent, weeklyContext?)` —— 路由表提供 `defaultSections` 做兜底、`systemRules` 拼进 system prompt
  - `main.ts`：绑定弹窗改为**读路由表**动态生成选项（不再写死两种）；`organize()` 里 `const spec = PROMPT_SPECS[docType]`，`spec.needsDbInjection` 才查 DB
  - 面板绑定 UI：列表来源从 `DOC_TYPES` 常量改为 `Object.values(PROMPT_SPECS).map(s => ({value: s.docType, label: s.displayName}))`
- [ ] **兼容**：binding 里的 `docType` 只在面板内存和 session 里用，重启即失效；现有数据.json 无历史包袱
- [ ] **验收**：能注册两种以上 spec；改 spec.defaultSections 后 LLM 输出章节自动对齐新增的 spec；旧 binding 重启后失效（因为不持久化）

### V8. 注入 xdf-base 只读 DB — 周报数据自动补全

> 依赖 V7：`needsDbInjection` 就是 PromptSpec 的字段，DB 注入只在 spec 标记为 true 时触发

- [ ] **动机**：钉钉周报「待考试学生统计 / 考试时间 / 出分结果 / 是否录入系统」四字段，数据在 `xdf-base` DB 的 `student_profile` 表，录音转写拿不到
- [ ] **Schema 映射**（base schema v3）：

  | 周报字段 | DB 字段 | 关联路径 |
  |---|---|---|
  | 待考试学生统计 | `ielts_needed = 1` | `student_profile.student_id` → `students.id` → `students.name` |
  | 考试时间 | `exam_date` | 同上 |
  | 出分结果 | `exam_score` | 同上 |
  | 是否录入系统 | `exam_date IS NOT NULL AND exam_score IS NOT NULL` | 派生 |

- [ ] **适配层**：抄 `xdf-toolkits/src/xdf/db.ts` 的 `createXdfDb(app)` 模式 —— 两条路径兼容（`_xdfBase.getDBApi()` / `api.db.query`），版本校验 ≥1.5.1
- [ ] **SQL**：
  ```sql
  SELECT s.name, sp.exam_date, sp.exam_score
  FROM students s JOIN student_profile sp ON sp.student_id = s.id
  WHERE sp.ielts_needed = 1
  ORDER BY COALESCE(sp.exam_date, '9999-12-31') ASC, s.name
  ```
- [ ] **注入点**：`main.ts` 的 `organize()` 里，转写完、调 LLM 之前 —— 只有 `spec.needsDbInjection === true` 才查；结果作为 `<周报待办数据>` 块拼进 prompt，system prompt 硬规则要求 LLM 填进对应的空章节（会议记录模板里预留的「待考试学生统计」）
- [ ] **降级**：base 未启用 / 版本不够 / DB 查询失败 → `console.warn` + Notice 提示，主流程照常
- [ ] **加载顺序**：`manifest.json` 加 `"dependencies": { "xdf-base": ">=1.5.1" }`
- [ ] **base 模板配合**：会议记录.md 里加空章节 `## 待考试学生统计`（让 LLM 有地方填）

### Bug：写回后正文出现两份音频播放器

- [ ] 现象：`stopRecording` 已在正文首行插了 `![[xxx.webm]]`；`organize()` 把**含播放器行**的正文原封不动发给 LLM，LLM 因硬规则"页面现有内容优先照搬"把播放器抄进了 draft；`writeToNote()` 又从旧正文挖了一次播放器行插在 draft 顶部 → 最终 `frontmatter + ![播放器(挖的)] + ![播放器(LLM带的)] + 正文`，两份
- [ ] 根因：插件写回逻辑假设「LLM 输出纯正文不含播放器」，但发给 LLM 的 `<页面现有内容>` 里又包含了播放器行 —— 两边哲学不一致，各自维护播放器
- [ ] 修复方案：**单一真相源**「插件管播放器，LLM 管正文」
  - **主修复**：`main.ts` 的 `organize()` 方法里，读 `body` 后、发给 `organizeTranscript()` 前，剥离首行 `![[*.webm]]`（插件技术性占位，不属于页面内容）
  - **防御性兜底**：`writeToNote()` 里检查 `draft` 首行是否已是播放器，是则不再从旧 body 挖第二次（不怕 LLM 没听话）
- [ ] 验收：写回后正文顶部**只有一份** `![[xxx.webm]]`

### V6. 发布

- [x] `pnpm install --lockfile-only` 生成并提交 `pnpm-lock.yaml`（release CI 用 `--frozen-lockfile`）
- [ ] 推 `v*` tag 走 `.github/workflows/release.yml`：package.json / manifest.json / tag 三处版本一致 → 自动构建发布
- [ ] 发布前确认 `manifest.json` 的 `minAppVersion` 与 `isDesktopOnly`（录音依赖 Electron，应保持 `true`）

### 待实测（需用户在真实 Obsidian 环境验证）

- [ ] 面板内 MediaRecorder 录音：开始 / 暂停 / 继续 / 停止，产出 webm 能被讯飞正常转写
- [ ] 面板渲染与交互：绑定 → 录音 → 转写 → 整理 → 预览 → 确认写入全流程
- [ ] 录音文件在 Obsidian 内嵌播放器中可播放（`![[xxx.webm]]`）

---

## ⚪ 待定

- **base「周例会记录」对已存在文件的覆盖策略**：该脚本对已存在文件有跳过逻辑。若 base 先建空壳 → 本插件写入整理稿 → 用户再跑一次 base 记录命令，是否会冲掉整理结果？需实测后决定（可能让 verbatim 写入后打标记，或 base 侧增加「正文非空不覆盖」判断）。
- **跨重启续轮询**：当前 `orderId` 只在转写成功后落库，重启后重新点「转写」会重新上传。若要真断点续传，需让 provider 在上传成功时通过回调把 `orderId` / `signatureRandom` 交给上层并支持「只轮询不重传」。当前不做（成本高、收益低）。
- **面板感知外部启停**：通过命令 / Ribbon 启停录音时，面板靠 `notify()` 重渲染，但本地 `isRecording` 计时器状态可能与真实录音态短暂不一致。当前不做（v1 只在面板内操作）。
- **`AbortSignal` 不生效**：`requestUrl` 不支持中断，`transcribe` 的 signal 只在轮询 sleep 与请求间检查。当前接受。

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
