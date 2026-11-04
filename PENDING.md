# PENDING — XDF Verbatim

> 待办清单。分区：**⚪ 待定**（方案未定）/ **🟡 已定待做**（方案已定，等动手）/ **🟢 进行中**。
> 完成一项后：从本文件**删除**该条 → 在 [DEVLOG.md](./DEVLOG.md) 追加一行 → 现状变了就更新 [ARCHITECTURE.md](./ARCHITECTURE.md)。
> 最近修订：2026-11-05（V1~V5 已实现并验收，仅剩发布与实测项）。

---

## 🟢 进行中

（无）

---

## 🟡 已定待做

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
