# PENDING — XDF Verbatim

> 待办清单。分区：**⚪ 待定**（方案未定）/ **🟡 已定待做**（方案已定，等动手）/ **🟢 进行中**。
> 完成一项后：从本文件**删除**该条 → 在 [DEVLOG.md](./DEVLOG.md) 追加一行 → 现状变了就更新 [ARCHITECTURE.md](./ARCHITECTURE.md)。
> 最近修订：2026-11-20（v0.2.0 已发布，V6 删除；V13 已实现，移入待实测；V7 描述同步删兜底）。

---

## 🟢 进行中

暂无。V9 找回录音已实机通过；V13 整理 prompt 重规划已实现，实机效果见下方待实测。

---

## 🟡 已定待做

### V11. 关闭再打开面板，恢复原工作状态且录音不中断

- [ ] **目标**：关闭面板只关闭操作窗口，不停止或暂停正在进行的录音；重新打开后接着原工作状态使用。
- [ ] **方案**：录音状态、累计录音时长及当前计时起点由插件统一保管，面板通过状态快照恢复显示并订阅变化，不再把面板自己的状态作为唯一依据。面板关闭只解除界面订阅和界面计时刷新，不销毁录音器、不取消后台转写或整理任务。
- [ ] **恢复范围**：同一插件运行期间，重新打开面板时恢复绑定页面、录音中 / 暂停状态、累计录音时长、转写 / 整理进度及当前转写稿 / 整理稿。关闭前尚在防抖保存期内的编辑内容不得丢失。
- [ ] **边界**：不包含退出 Obsidian、关闭仓库、禁用或重载插件后的持续录音，也不扩展成跨重启续转写。
- [ ] **涉及文件**：`src/main.ts`、`src/panel/MeetingPanel.ts`、`src/types.ts`；按接口需要调整 `src/record/Recorder.ts`，并补充对应状态与生命周期测试。
- [ ] **验收**：
  - 录音中关闭再打开面板，录音不中断，显示仍为录音中、时长连续；停止保存后音频包含关闭面板期间的内容，且只保存一份。
  - 暂停时关闭再打开，仍显示暂停，暂停期间不累计时长；点击继续后正常续录。
  - 转写或整理过程中关闭再打开，绑定与任务状态正确，任务继续运行，完成内容可见。
  - 编辑转写稿或整理稿后立即关闭再打开，内容不丢失；反复开关不产生重复订阅、重复计时或重复任务。
- [ ] **风险**：后台录音在面板关闭后仍会使用麦克风；重开时不能误显示为空闲。计时源与录音生命周期必须一致，不能因面板销毁误停录音，也不能因重复挂载保存多份音频。

### V12. 中断本地转写，放弃旧任务并允许重新转写

- [ ] **目标**：在上传或等待讯飞转写期间提供「中断转写」按钮；点击后本地放弃旧任务，立即恢复可操作状态，再次点击「转写」建立全新任务。
- [ ] **方案**：每次转写使用独立任务标识与取消信号；中断时立即使旧标识失效，停止后续查询并解除本地忙碌状态。已经发出的请求可能无法立即断开，但其晚到的结果、进度、异常及收尾逻辑必须全部忽略，不得改动当前会话或新任务。
- [ ] **数据规则**：保留本地音频与已有用户内容，不删除录音；对没有转写结果的当前录音恢复为可转写状态。旧任务返回的 `orderId`、结果或错误不再写入当前会话；再次转写重新上传，不复用旧订单。
- [ ] **界面说明**：明确提示「仅停止本地等待，讯飞任务可能继续处理；重新转写可能再次消耗额度」。面板关闭再打开仍能正确显示当前有效任务，不能让已中断任务恢复成忙碌。
- [ ] **涉及文件**：`src/main.ts`、`src/panel/MeetingPanel.ts`、`src/types.ts`、`src/providers/xunfei.ts`；按状态落盘需要调整 `src/session.ts`，并补充取消与旧任务隔离测试。
- [ ] **验收**：
  - 上传中、轮询等待中均可中断；界面立即退出忙碌，录音仍可再次转写，不必等待旧网络请求返回。
  - 中断后不再为旧任务发起新的结果查询；再次转写确实建立新任务。
  - 用可控延迟响应模拟旧请求晚到的成功、进度与失败，均不能覆盖新任务结果、错误或状态，也不能提前解除新任务的忙碌状态。
  - 连续执行「转写 → 中断 → 再转写」不会串任务；中断操作可安全重复，关闭再打开面板后状态一致。
- [ ] **风险与服务边界**：讯飞服务端旧任务可能成为不再取回结果的遗留任务，并继续消耗额度；本功能不承诺服务端撤单或退费。当前所用官方 API 未公开可调用的取消接口，计费与额度返还规则未明确。参考：https://www.xfyun.cn/doc/spark/asr_llm/Ifasr_llm.html 、https://www.xfyun.cn/services/lfasr 。

### V7. PromptSpec 路由表重构（本地已实现，未实机验收）

> 2026-11-05 DEVLOG 记录已落地 `src/llm/prompts.ts`。本条保留到实机验收，不计入已发布。DB 注入仍是 V8，未做。

- [ ] **动机**：当前页面类型散在三处硬编码 —— `types.ts` 的 `DocType` 联合类型（只有两种）、`llm/organize.ts` 的 `defaultSections`（两种固定兜底章节）、`SYSTEM_PROMPT`（两种硬规则 + DB 注入 if 逻辑）。加一种新类型（展课等）要改三四处，而且 DB 注入这种 prompt 专属开关无处安放
- [ ] **接口**（新文件 `src/llm/prompts.ts`；V13 已删 `defaultSections`，页面模板为唯一结构权威）：
  ```ts
  export interface PromptSpec {
    docType: string;                 // 内部标识，如 "meeting" / "research" / "demo"
    displayName: string;             // 面板绑定弹窗给用户看的
    matchBasenames: string[];        // 哪些文件名自动匹配，如 ["会议记录"]
    systemRules: string[];           // 追加到 system prompt 的专属硬规则
    needsDbInjection: boolean;       // 要不要查 DB 拼 <周报待办数据>（V7 用）
  }
  ```
- [ ] **路由表**（会议记录 / 教研笔记先注册，对齐 base 已改模板）：

  | docType | matchBasenames | needsDbInjection |
  |---|---|---|
  | meeting | ["会议记录"] | **true** |
  | research | ["教研笔记"] | false |

  展课、一对一、班课等后续加一行就行
- [ ] **各模块改动**：
  - `types.ts`：`DocType` 保留但新增 `docType: string` 字段到 `Binding`（或直接用 `string` 替换联合类型，路由表即单一真相源）
  - `llm/organize.ts`：`buildOrganizeMessages(docType, transcript, pageContent)` 改为 `buildOrganizeMessages(spec, transcript, pageContent, weeklyContext?)` —— 路由表提供 `systemRules` 拼进 system prompt（V13 起无兜底章节）
  - `main.ts`：绑定弹窗改为**读路由表**动态生成选项（不再写死两种）；`organize()` 里 `const spec = PROMPT_SPECS[docType]`，`spec.needsDbInjection` 才查 DB
  - 面板绑定 UI：列表来源从 `DOC_TYPES` 常量改为 `Object.values(PROMPT_SPECS).map(s => ({value: s.docType, label: s.displayName}))`
- [ ] **兼容**：binding 里的 `docType` 只在面板内存和 session 里用，重启即失效；现有数据.json 无历史包袱
- [ ] **验收**：能注册两种以上 spec；改 spec.systemRules 后 LLM 输出专属规则自动对齐；旧 binding 重启后失效（因为不持久化）

### V10. 一页多音频（同一次例会录多段）

- [ ] **现状**：`Session` 是单条结构（`audioPath/transcript/draft/state`），第二次录音 `createEmptySession()` **直接覆盖**上一条会话；第一段 webm 仍在磁盘，但转写稿丢失且无入口再转
- [ ] **目标**：同一页面可挂多段录音，逐段转写，整理时按时间序合并
- [ ] **数据模型**：`session` 改为数组 `Session[]`（每段一条，字段不变，另加 `createdAt`），`data.json` 兼容旧单对象（读到时包成单元素数组）
- [ ] **录制**：不再覆盖，`push` 一条新 session；正文播放器与首页链接各追加一条（已是该行为，无需改）
- [ ] **面板**：转写区改为「录音清单」—— 每条显示文件名/时长/状态/转写字数，支持单选后转写、重新转写、删除；只有全部转写完成才允许整理
- [ ] **整理**：把多份 transcript 按 `createdAt` 拼接（加 `[第1段]` / `[第2段]` 分隔）后一次性喂 LLM
- [ ] **写回**：`resolvePlayerLine` 需要支持多播放器（正文顶部保留全部 `![[*.webm]]`）
- [ ] **验收**：一页录 2 段 → 都可分别转写 → 整理稿包含两段内容 → 正文两个播放器都在

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

### 待实测（需用户在真实 Obsidian 环境验证）

- [ ] V13 整理新 prompt 实机效果：对照样例图验收（全面但精简、议题加粗标签、层级嵌套、无关录音内容过滤、章节照页面模板）
- [ ] 面板内 MediaRecorder 录音：开始 / 暂停 / 继续 / 停止，产出 webm 能被讯飞正常转写
- [ ] 面板渲染与交互：绑定 → 录音 → 转写 → 整理 → 预览 → 确认写入全流程
- [ ] 录音文件在 Obsidian 内嵌播放器中可播放（`![[xxx.webm]]`）

---

## ⚪ 待定

暂无。面板状态恢复与本地中断转写已移至上方 V11 / V12。Base 新建记录保留编号加一及已有记录不覆盖的现状，不增加同日限制，不列为改造待办（2026-11-07 用户确认）。

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
