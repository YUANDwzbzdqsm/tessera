# Tessera 代码导读

六集“边读代码边画架构”的视频页，加一个 SSE 补丁动画。

每一集都分成两半：
- **左边**：仓库里真实的代码，讲到哪几行就亮哪几行。
- **右边**：一块白板，架构图随讲解一点点画出来，请求、文字碎片、补丁和停止信号沿着箭头跑。

配音用浏览器自带的中文语音，同时有字幕；可以暂停、倒回、按章节跳。

已发布的页面（claude.ai Artifact，默认只有自己能打开，分享在页面的 Share 菜单里）：

| 集 | 内容 | 链接 |
| --- | --- | --- |
| 1 | 消息进门：从发送按钮到 SSE 帧 | https://claude.ai/artifact/XsqRxEeJcNq8F9T7tfpvk7 |
| 2 | 流式编译器：每次重编译，只发变化 | https://claude.ai/artifact/UVJuwjSGTQksLzPAjxoH4P |
| 3 | 浏览器收流：解析 SSE，拼回文档 | https://claude.ai/artifact/DsYLAJzNNxVMKUrW5TgGGr |
| 4 | 编译器内部：从标记到一段 JS | https://claude.ai/artifact/Mx1PVWvsvpgofpYMZJFnJp |
| 5 | 沙箱：iframe、Worker 和 SES | https://claude.ai/artifact/CdrmLHmLHrazvxZoNKTv11 |
| 6 | 画到屏幕上：组件、状态和 ui.send | https://claude.ai/artifact/SxtwPgLfsNnrEMy2GLrUme |
| 番外 | SSE 补丁回放（27 帧、56 个操作的动画） | https://claude.ai/artifact/RebpJEhp3Ce46JSt7SD1hE |

讲稿里的行号对应提交 `aa34cf6`。

## 目录

| 路径 | 作用 |
| --- | --- |
| `series/player.html` | 播放器本身，六集共用：分屏舞台、白板绘制、箭头上的数据包、各种机制小动画、配音、字幕、时间轴 |
| `series/common.mjs` | 全系列地图（每集开头和结尾都用它）、六集列表、已发布的链接 |
| `series/build-lib.mjs` | 共用的构建：从仓库读出真实代码行，检查讲稿里的每个引用，打印每章时长，填进播放器 |
| `series/shots.mjs` | 用无头 Chrome 给指定段落截图，用来检查画面 |
| `epN/script.mjs` | 一集的讲稿：每一段说什么、左边显示哪个文件的哪几行、右边画什么、亮什么、跑什么 |
| `epN/build.mjs` | 一集的构建。第 2、3、4 集会在构建时跑仓库里真实的函数（`stringDiff`、`SSEParser`、`applyOps`、`tokenize`、`parse`），动画用的是这些结果 |
| `ep1/capture.txt`、`sse-anim/capture.txt` | 从开发服务器真实抓下来的 SSE 流（15 帧和 27 帧） |
| `sse-anim/` | SSE 补丁回放的构建和模板 |

## 命令

```bash
npm run walkthrough                                 # 重新生成全部页面，输出在各自目录下的 tessera-epN.html
node docs/walkthrough/ep3/build.mjs                 # 只生成一集
node docs/walkthrough/series/shots.mjs file:///…/tessera-ep3.html docs/walkthrough/shots 6,15   # 截第 6、15 段
```

构建会打印每章时长，按 1.2 倍语速估算：Windows 中文语音在 1 倍速时大约每秒 3.6 个字。

以下引用对不上时，构建会直接报错：
- 不存在的行号范围、帧、文档快照、面板
- 白板上不存在的节点或箭头
- 重名的节点或箭头

生成的页面是没有 `<html>` 外壳的片段，发布为 Artifact 时会自动套上。本地直接用浏览器打开也能看。

## 改了代码之后

讲稿里写死了行号，代码一改，行号就可能错位。构建只检查范围在不在文件里，检查不出“这几行现在讲的已经不是这件事了”。所以改了相关文件以后，要对照 `epN/script.mjs` 里的 `lines` 和讲稿文字更新一遍。

重新抓 SSE 流：先 `npm run dev`，再向 `POST http://localhost:5180/api/stream` 发同样的 `source`。两段原文分别写在 `ep1/script.mjs` 的讲稿里，和 `sse-anim/build.mjs` 里。

## 发布

页面是作为 claude.ai Artifact 发布的，链接写在 `series/common.mjs`。重新生成后，需要再发布一次，同一个链接就会更新。
