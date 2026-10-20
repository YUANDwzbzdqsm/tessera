# Tessera

让模型的回复变成可交互界面的引擎：模型写一种为流式生成设计的标记语言，编译器把它变成一段 JS 程序和一张常量表，程序在 SES 沙箱 Worker 里运行，界面通过 remote-dom 镜像回宿主页面，再由你自己的 React 组件画出来。

思路参考了第三方对 ChatGPT Intelligent UI 的公开分析，是按公开描述做的独立实现：没有使用 ChatGPT 的任何代码，语言语法也是自己定义的。Tessera 是暂用的名字。

> 当前进度：M1–M6 已完成，即非流式闭环、流式编译 + SSE 补丁、隔离加固、数据与传输、真实模型评测、埋点与统计。在 15 个基准提示上，deepseek-flash 一次通过 14/15；doubao-seed-2.1-pro 关思考时 14/15，开思考时 15/15。剩下的偶发错误经过一轮反馈都修好了。详见“评测（M5）”。M6 让每条回答能说清自己由哪些组件组成、用户看了哪些、动了哪些，见“埋点与统计（M6）”。

## 一条回复的旅程

```
模型逐 token 输出（Tessera 标记）
   │  @tessera/stream/server：每隔一段时间把已到达的全部前缀重新编译，只发变化的部分
   │  @tessera/lang：分词 → 建树（截断修补）→ Markdown 转组件 → 表达式守卫 → 代码生成
   ▼
   │  工具结果按名字放进 data 表（模型只写 {p1.price}）；<Image query> 之类交给服务端解析器，结果补进 data
SSE：event: patch  data: {seq, kind, ops}  ← 代码只发变化的那一段（splice）；文字变长只追加常量；结束时附上 Markdown 降级版
   │  @tessera/stream：浏览器端解析 SSE、应用补丁，得到 { text, code, constants, diagnostics, done }
   ▼
{ code, constants }                       ← 纯数据，可以随消息存储、跨 postMessage 传递
   │  @tessera/react：SandboxController 把程序交给沙箱；更新太快时只渲染最新的一个；
   │                  看门狗负责超时、心跳、隔离卡死的程序、重建沙箱
   ▼  MessageChannel（宿主直连 Worker；iframe 只负责启动）
隐藏 iframe：sandbox="allow-scripts"（不透明源）+ CSP default-src 'none'
   └ Web Worker（预构建的 @tessera/runtime/sandbox-worker.js，从 Blob 启动，继承 iframe 的 CSP）
   │  lockdown() 冻结内置对象；程序在独立的 SES Compartment 里求值，拿不到 fetch / 定时器 / DOM
   │  Preact 把程序渲染成 remote-dom 元素（DOM polyfill 里），state 按名字存在程序外
   ▼  remote-dom 变更记录（函数经 @quilted/threads 以代理形式过桥）
宿主页面：RemoteReceiver → 再按目录校验一遍 props → 你的 React 组件
   │
   └─ 用户交互：组件回调 → 沙箱事件 → setState → 重新渲染 → 只发回差异。模型调用 0 次。
      只有 ui.send() 会作为动作交给宿主，由宿主决定是否发一条新消息给模型。
```

## 包

| 包 | 作用 | 运行在 |
| --- | --- | --- |
| `@tessera/catalog` | 组件目录：zod props 模式、事件、子内容类型、服务端解析器（`resolver`）、降级渲染（`fallback`）；校验；生成提示词里的组件说明 | 任意环境 |
| `@tessera/lang` | 编译器 `compile()`（结果里带 `manifest`）、表达式守卫、`systemPrompt()`、`feedbackForModel()`、`toFallbackMarkdown()`、`resolveAll()` | 服务器或浏览器 |
| `@tessera/stream` | 补丁协议（含 `append` / `splice`）、`applyOps`、SSE 编解码、`readTesseraStream`；`@tessera/stream/server` 是流式编译器和 SSE 输出（工具数据、解析器、降级版） | 主入口任意环境；`/server` 在服务器 |
| `@tessera/runtime` | 沙箱运行时。主入口只导出类型；`./worker` 是 Worker 入口源码，`./sandbox-worker.js` 是预构建的单文件版本（给 iframe 用） | Web Worker |
| `@tessera/react` | `<TesseraView>`；沙箱工厂 `iframeSandbox` / `workerSandbox`；`SandboxController`（看门狗）；`useTesseraStream()`；`useTesseraSite()` | 宿主页面（React ≥ 18） |
| `eval` | 基准提示（`cases.mjs`）和 SES 回放 Worker；运行器是 `scripts/eval.mjs` | Node |
| `demo` | 演示页：可编辑源码、实时编译、流式播放（开发服务器里自带一个假模型 + SSE 接口）、诊断、编译结果、系统提示词、动作日志 | 浏览器 |

## 语言

```
## 团队套餐估价
拖动滑块，看看团队**每月**要花多少。
{@state seats = 8}
{@let price = seats * 29}
<Box border padding={3} gap={2}>
<Slider min={1} max={50} value={seats} onChange={setSeats} />
<Title size="xl">{price} 美元/月</Title>
<Button onClick={() => ui.send(`为 ${seats} 人做预算`)}>生成方案</Button>
</Box>
```

| 写法 | 含义 |
| --- | --- |
| Markdown | `#`/`##`/`###` 标题、段落、`- `/`1. ` 列表、`**粗体**`、`*斜体*`、`` `代码` ``、`` ```python `` 代码块，编译成目录里的 Title / Text / List / CodeBlock 等组件 |
| 代码 | 代码块和 `` `代码` `` 里的内容原样显示，不解析：`{`、`<`、`#`、`*` 都只是字符。代码块没写完（流式中途，或模型忘了收尾）时，后面的内容都按代码显示 |
| `<Name prop="文本" prop={表达式} flag />` | 只能用目录里的组件和 props；字面量在编译时就按 zod 校验 |
| `{@state name = 初值}` | 声明 state 和它的 setter `setName`；必须写在顶层、独占一行 |
| `{@let name = 表达式}` | 派生值；顶层、独占一行，只能引用前面声明过的名字 |
| `{表达式}` | 插值。允许算术、比较、三元、模板字符串、数组方法、箭头函数；不允许赋值、`new`、循环、`this`、`constructor` 等 |
| `{#if a}…{:else if b}…{:else}…{/if}` | 条件 |
| `{#each list as item, i}…{/each}` | 循环 |
| `ui.send(text)` / `ui.copy(text)` / `ui.open(url)` | 离开沙箱的动作，由宿主处理 |
| `{p1.price}` | 引用工具结果。值来自 data 表，模型不重抄；没给过的名字会被丢弃，拼错的字段会报 `unknown_field` |
| `<Image query="…" />` | 服务端解析组件：模型只写描述，服务端找图后把结果补进 data；props 必须是字面量 |
| `\{` `\}` `\<` `` \` `` | 代码以外的字面量字符 |

**写到一半也能编译。** 末尾不完整的结构（没闭合的 `{`、没有 `>` 的标签）直接丢弃；已经有内容的未闭合元素自动闭合，空的直接丢弃。每处修补都会记成诊断。所以 M2 只需要对前缀反复调用 `compile()`。

## 试用：接 DeepSeek 的聊天页

`npm run dev` 之后打开 http://localhost:5180/chat.html，就是一个最简单的聊天机器人：

- 每条回复都从 `/api/chat` 流式返回，一边生成一边渲染成界面。
- 按钮里的 `ui.send()` 会直接发出下一条消息。
- 界面状态（滑块位置、勾选、答题结果）和对话记录存在浏览器里，刷新后还在。
- 每条回复下面可以展开模型写的源码和诊断。

开发服务器在服务端读取 key，页面拿不到：

```bash
# 环境变量里已有 DEEPSEEK_API_KEY 就不用配置；也可以写进 demo/.env.local（已在 .gitignore 里）
DEEPSEEK_API_KEY=...
DEEPSEEK_MODEL=deepseek-flash              # 可选，默认 deepseek-flash
DEEPSEEK_BASE_URL=https://api.deepseek.com # 可选；任何 OpenAI 兼容接口都可以
```

服务端逻辑在 `demo/src/server/chat.ts`，约 60 行：
- 拼上 `systemPrompt(catalog)` 和最近 20 条对话（助手消息发回的是它写的 Tessera 源码）。
- 只把模型的正文交给 `createSSEStream`，推理内容不转发。
- 图片用的是演示里的本地占位图解析器，不会调用外部搜索。

## 试用：短视频信息流里的广告位

`npm run dev` 之后打开 http://localhost:5180/feed.html。左边是一部仿短视频信息流的手机，第二条是赞助视频；视频开始一会儿后，底部弹出一张广告卡片。右边的面板负责生成卡片内容。

- **平台和广告各管一半。** 卡片的外框、关闭按钮、什么时候出现，都由宿主页面决定；卡片里面是一段 Tessera 程序。
- **广告目录**（`demo/src/feed/adCatalog.ts`）：`Seal`（锯齿边徽章）、`Headline`、`PromoCode`、`Price`、`Countdown`、`Thumb`、`Perforation`（撕口线）、`Button`，再加入门组件里的 `Box`、`Caption`、`Badge`、`Slider`、`Progress`。外观全部写在 `AdComponents.tsx` 里，模型只能选组件，颜色只能从固定色板里挑。
- **事实只能绑定。** 促销码、价格、截止时间都来自广告数据（data 表），模型写 `{offer.code}`。商品图只能引用素材库里的 `asset:…`，不能写 URL。面板会检查源码里有没有直接抄写数据里的值。
- **三个场景**：包邮券（仿真实广告卡片，点“领取”复制促销码并弹出提示）、限时特价（商品图、划线价、倒计时）、凑单计算（拖动件数，实时算到手价）。每个场景都有手写示例，没配 key 时也能用“回放手写示例”走一遍流式。
- **用模型生成**走 `POST /api/ad`（`demo/src/server/ad.ts`），复用聊天页的 DeepSeek 配置。系统提示词是 `systemPrompt(adCatalog, { intro, data, extra })`，在面板的“系统提示词”页可以看到。生成的变体会记在“生成记录”里，可以来回切换比较。

## 在 DeepSeek Harness 里用

`integrations/dsh-plugin` 是一个 DeepSeek Harness 插件：模型调用 `render_ui` 工具写 Tessera 标记，界面直接出现在 Harness 的聊天记录里，参数还在生成时就开始渲染；按钮的 `ui.send` 会作为用户消息发出，颜色跟着 Harness 的浅色和深色主题走。`npm run build:dsh` 构建，安装方法和工作方式见 [它的 README](integrations/dsh-plugin/README.md)。插件还在本机提供一个统计页（M6），记录每个界面由哪些组件组成、被看了多久、被怎么用。

## 在应用里使用

```tsx
import { defineCatalog } from '@tessera/catalog';
import { compile, feedbackForModel, systemPrompt } from '@tessera/lang';
import { TesseraView, iframeSandbox } from '@tessera/react';
import sandboxWorkerUrl from '@tessera/runtime/sandbox-worker.js?url'; // Vite；其他打包器按各自方式拿到文件 URL

const catalog = defineCatalog();                 // Markdown 组件 + 入门组件集，也可以传你自己的 specs
const sandbox = iframeSandbox({ workerUrl: sandboxWorkerUrl }); // 模块级创建，保持引用稳定

const prompt = systemPrompt(catalog);            // 拼进给模型的系统提示词
const program = compile(modelOutput, { catalog }); // { code, constants, diagnostics }

<TesseraView
  program={program}
  catalog={catalog}
  components={myComponents}                      // { Slider: MySlider, Title: MyTitle, ... }
  sandbox={sandbox}
  initialState={saved}                           // 上次保存的界面状态，刷新后恢复
  onStateChange={(state) => save(state)}         // 每次成功重绘后的状态（只含 JSON 安全的值）
  onAction={(a) => a.type === 'send' && chat.send(a.text)}
  onIssue={(i) => console.warn(i)}
/>

// 下一轮对话时，把上一个界面的问题和用户留下的状态告诉模型：
const note = feedbackForModel(program.diagnostics, { runtimeIssues, state }); // 没什么可说时返回 null
```

不想要 iframe 层时，可以用 `workerSandbox(() => new Worker(new URL('./tessera.worker.ts', import.meta.url), { type: 'module' }))`，那个文件里只写 `import '@tessera/runtime/worker'`。这样更轻，但 Worker 和页面同源、能联网，不建议用来跑模型写的程序。

### 流式（M2）

服务端：把模型的文本流交给 `createSSEStream`，得到一个可以直接作为响应体的 `ReadableStream`。

```ts
import { createSSEStream, sseHeaders } from '@tessera/stream/server';

// modelText: AsyncIterable<string>，比如模型 SDK 的流式输出
const body = createSSEStream(modelText, {
  catalog,
  interval: 120,                    // 最多每 120 毫秒重编译一次；模型停顿时也会按时把缓冲的文字发出去
  onDone: (doc) => saveMessage(doc) // 最终文档：原文、代码、常量表、诊断，可以直接存
});
return new Response(body, { headers: sseHeaders });
```

浏览器：

```tsx
const stream = useTesseraStream();
stream.start((signal) => fetch('/api/chat', { method: 'POST', body, signal }));

<TesseraView program={stream.doc} catalog={catalog} components={myComponents} sandbox={sandbox} />
// stream.status: idle | streaming | done | stopped | error；stream.stats：各类更新次数和字节数
```

每个补丁批次带一个 `kind`：

| kind | 什么时候 | 发什么 |
| --- | --- | --- |
| `structure` | 有组件、语句或代码块写完了，编译出的代码变了 | 新增原文 + 代码中变化的那一段（`splice`）+ 常量变化 |
| `constants` | 代码没变，只是静态文字变长 | 新增原文 + 常量表的 `append` / `add` |
| `text` | 模型正写在没完成的标签中间，界面不变 | 只有新增原文 |
| `data` | 服务端解析的结果到了（比如找到的图片） | data 表里新增一项 |
| `final` | 流结束 | 剩余变化 + Markdown 降级版 + `done: true` |

补丁是 JSON Patch 的一个小子集：`replace`、`add`（`/-` 表示追加到数组），外加两个字符串操作。`append` 用于拼接，文字变长时只传新增的字；`splice` 用于替换一段，重新编译出的程序只在中间有变化，所以只传那一段。每批带 `seq`，客户端发现乱序会报错。

为了让流式顺滑，运行时做了这几件事：

- **根组件稳定。** 每次更新都是一个新程序，但 Preact 看到的根组件始终是同一个包装组件，程序被当作函数调用。所以新程序是和旧树做 diff，而不是整棵树卸载重建，正在拖的滑块不会被打断。
- **代码没变就不重新求值。** 只有常量变化时复用已求值的工厂函数，换一张常量表即可。同一个视图复用一个 Compartment。
- **出错保留上一帧。** 新程序加载失败或渲染抛错时，屏幕上保留上一个能用的输出。
- **合并更新。** `TesseraView` 一次只让沙箱渲染一个程序；渲染期间来了多个新程序，直接跳到最新的那个。

代码差量传输的效果（模型 40 字/秒、每 100 毫秒重编译，同一条流对比）：

| 示例 | 更新次数 | 整段重发代码 | 只发变化的一段 | 整条流 |
| --- | --- | --- | --- | --- |
| 团队估价 | 69 | 代码 9.2 KB，占 41% | 代码 2.0 KB，占 13% | 22.6 → 15.4 KB（−32%） |
| 商品对比 | 120 | 代码 26.2 KB，占 47% | 代码 3.5 KB，占 11% | 55.4 → 32.7 KB（−41%） |

### 工具数据、服务端解析与降级版（M4）

```ts
// 服务端：工具结果按名字传入；解析器在组件标签写完时就开始跑，结果以 data 批次补发
const body = createSSEStream(modelText, {
  catalog,
  data: { p1: product1, p2: product2 },          // 模型写 {p1.price}，值从这里来
  resolvers: { image: (input) => searchImages(input.query) },
  resolveTimeout: 5000,                           // 最终批次最多等这么久
  onDone: (doc) => save(doc),                     // doc.fallback 是 Markdown 降级版
});
// 同一份数据要告诉模型有哪些名字可用：
systemPrompt(catalog, { data: { p1: product1, p2: product2 } });
```

不走流式时，`compile(source, { catalog, data })` 返回 `resolutions`。用 `resolveAll(resolutions, resolvers)` 拿到结果，合进 `data` 再交给 `TesseraView` 即可。

- **值不经过模型。** 编译出的程序里只有 `__D["p1"]`，没有价格本身；端到端检查会确认编译结果里找不到 `2,899`。
- **防编造。** 没提供的名字（如 `{p3.price}`）当作未知标识符丢弃。对固定路径，编译时就核对字段是否存在（如 `{p1.prcie}` 报 `unknown_field`），这条警告也会进入给模型的反馈。
- **解析结果的键是稳定的**：组件名加字面量 props 的哈希。同一张图在流式反复重编译时只请求一次。解析失败或超时，组件就保持“未解析”状态。
- **降级版会求值。** `toFallbackMarkdown(source, { catalog, data, state })` 用一个小解释器，在初始状态（或传入的 `state`）下计算表达式，所以价格、列表项、`{#if}` 分支都是真实的值。ChatGPT 的降级版会丢掉计算出来的内容，这里不会。
  - 每个节点消耗燃料，数组、字符串都有上限，只允许调用一份无副作用的内置函数清单，所以在服务端求值模型写的表达式也一定会结束。
  - 遇到做不到的（`Date.now()`、`Math.random()` 等），就显示 `…`。
  - 组件的 Markdown 形式由目录里的 `fallback` 决定，比如滑块写成 “席位: 8 (1–50)”，按钮写成 “[生成方案]”，图片写成 `![描述](url)`。

**受控输入要保留本地副本。** 回调要先进沙箱、再把新值发回来，中间有一次往返。普通受控 input 在这段时间里会被 React 拉回旧值，所以演示里的 Slider、Checkbox 都先更新本地 state，再等 props 同步（见 `demo/src/components.tsx`）。

### 固定样式的组件

目录里只有组件名和 props，样式全在宿主组件里，所以设计固定的富组件和 Slider 的接法一样：只开放内容类的 props，外观写死在宿主里。演示里的 `<PullRequest>` 是一个例子：示例“合并请求”按剧情走一遍，“PR 状态切换”可以直接切 8 种状态、调分支图的形状。

- **目录**（`demo/src/pullRequest.ts`）：标题、分支、提交数、增删行数、冲突文件，再加一个 `status` 枚举（`opening` → `checking` → `conflicts` / `ready` → `resolving` / `merging` → `merged`，或 `closed`），以及 `onResolve` / `onMerge` 两个事件。
- **宿主**（`demo/src/PullRequestCard.tsx`）：卡片、按真实像素宽度画的分支图、状态行。状态变化时元素不会重新挂载，颜色、合并线、节点都用 CSS 过渡；合并时合并线会自己画出来。点了按钮先显示“解决中 / 合并中”，等新的 `status` 到了再替换。
- **状态从哪来**：示例里按钮直接改沙箱里的 `{@state status}`。真实场景里通常写成 `status={pr.status}` 绑定工具数据，宿主换一份 `data` 再交给同一个 `TesseraView`，卡片就会原地过渡到新状态。

数组、对象类型的 prop 会在提示词里写出结构，比如 `conflicts?: { file: string, count: number(0..) }[]`，不会只写一个 `array`。

### 埋点与统计（M6）

编译器知道一条回答里每个组件写在哪、长什么样，宿主看得到每一次跨沙箱的交互。M6 用一个稳定的 id（site）把这两边连起来，埋点不需要侵入模型写的程序。

```ts
const { manifest } = compile(source, { catalog });
manifest.sites[4];   // { site: 4, component: 'Slider', parent: 3, origin: 'tag', pos: 109,
                     //   literalProps: { min: 1, max: 50 }, dynamicProps: ['value'], events: ['onChange'],
                     //   loopDepth: 0, conditional: false }
manifest.skeleton;   // 'Title Text(Bold) Box(Slider Title Button)'
manifest.state;      // ['seats']，也是宿主收到的 state 的键

// 宿主组件里：自己是哪个组件
function MySlider(props) {
  const site = useTesseraSite();  // '4'；{#each} 里是 '4:0'、'4:1'，嵌套时 '4:1.0'
  …
}
```

- **manifest**：按源码顺序列出程序可能画出的每个组件：父组件、来自标签还是 Markdown、源码位置、通过校验的字面量 props（被丢掉的不在里面）、绑定表达式的 props、事件、外面套了几层 `{#each}`、是否在 `{#if}` 分支里。另外有布局骨架（重复的兄弟写成 `Text×3`，循环里的写成 `Card[]`）和 `@state` / `@let` 的名字。它和程序出自同一棵树，所以和程序完全对应。
- **site 是组件在源码中的顺序号（先父后子）**，不是源码位置：Markdown 转出来的组件没有自己的位置，以组件开头的段落又和那个组件位置相同。模型的输出只往后追加，所以写完的组件在流式重编译、沙箱重建、刷新之后 site 都不变。测试对 4 段示例回答的每个前缀都编译一遍来验证这一点。
- **怎么到宿主**：codegen 给每个组件注入 `"__site"`，运行时把它从 props 里拿出来，作为元素单独的 `site` 属性传过桥（不影响 props 的复用），宿主校验格式后通过 context 交给宿主组件。site 来自不可信的 Worker，只能当提示用；要采信就拿它和 manifest 核对。
- **流式**：SSE 里不带 manifest。服务端在 `onDone` 里 `compile(doc.text, { catalog, data }).manifest` 就能拿到。
- **第一个用上它的地方是 DeepSeek Harness 插件**：每个 `render_ui` 界面把 manifest、每个组件的可见时长、交互、动作、改过的 state 和问题上报给本机的一个小服务，打开 http://127.0.0.1:4317 就是统计页（组件使用量、字面量 props、布局骨架、每个界面逐个组件的明细）。上报什么、口径和边界见 [插件 README 的“统计”](integrations/dsh-plugin/README.md#统计m6)。

## 评测（M5）

`npm run eval` 用真实模型跑 17 个基准提示（`eval/cases.mjs`）。其中 14 个应该出界面：计算器、清单、对比、带图介绍、小测验、代码加小工具等，有 3 个带工具数据。另外 3 个不应该出组件：2 个纯问答，1 个写代码。每条回答走和线上一样的流程：

- **流式请求**：OpenAI 兼容的 Chat Completions。边收边用 `createStreamCompiler` 编译，记录首 token、首屏（第一次有东西可画）、首个可交互组件、总耗时和 token 数。
- **真跑一遍**：编译后在 `worker_threads` 里用 SES 执行程序，并触发每一个事件回调（滑块拉到最大、勾选、点击），收集运行时错误。
- **检查项**：
  - 没有错误级诊断
  - 能渲染，没有运行时问题
  - 界面没有包在代码块里（代码本身放进代码块是对的）
  - 该出界面时出界面，纯问题不出组件
  - 用了预期的组件
  - 降级版里有预期的文字
  - 工具数据的值没有被模型重抄
- **`--repair`**：失败的回答把 `feedbackForModel()` 发回模型，让它改一次，统计修好的比例。
- **`--regrade <结果目录>`**：不调用模型，用当前代码重新评已保存的回答，单独衡量编译器改动的效果。

```bash
# key 只从 --key-env 指定的环境变量里读，不会打印，也不会写进报告
npm run eval -- --base-url https://api.deepseek.com --model deepseek-flash --key-env DEEPSEEK_API_KEY --repair
npm run eval -- --base-url https://ark.cn-beijing.volces.com/api/v3 --model doubao-seed-2-1-pro-260915 \
  --key-env MOOD_ARK_API_KEY --repair --extra '{"thinking":{"type":"disabled"}}'
```

报告写在 `eval/results/<label>/<时间>/`，包括 `report.md`、`report.json` 和每条回答的原文。这个目录不进 git。其他选项：
- `--only`：只跑指定的几条
- `--concurrency`：并发数，默认 3
- `--timeout`：单次请求超时，默认 300 秒
- `--extra`：合并进请求体的 JSON
- `--prompt-extra`：追加到系统提示词末尾

实测结果（并发 3，墙钟时间取中位数）：

| 模型 | 修正前 | M5 之后 | 首屏 | 首个可交互组件 | 总耗时 | 总 token | 修复轮 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| deepseek-flash | 13/15 | 14/15 | 3.9 秒 | 6.6 秒 | 7.0 秒 | 43.9k | 1/1 修好 |
| doubao-seed-2.1-pro（关思考） | — | 14/15 | 1.8 秒 | 5.0 秒 | 10.0 秒 | 26.8k | 1/1 修好 |
| doubao-seed-2.1-pro（开思考） | 13/14，另 1 条超时 | 15/15 | 28.9 秒 | 37.0 秒 | 37.2 秒 | 48.8k | 不需要 |

- 所有运行里，“UI 还是纯文本”的判断全部正确，渲染和触发回调都没有出过运行时错误，也没有模型把回答包进代码块。
- 首屏几乎都在第 2、3 个字符到达时出现：流式编译器一收到标题就开始画。
- 修正之后，每次运行最多剩 1 条失败，而且每次是不同的偶发错误：用了没声明的名字、把草稿和自己的规划文字一起输出、在公式里写了字面量的 `{年数}`。这些都在一轮反馈后修好。

评测发现的问题，以及怎么改的：

| 发现 | 改动 |
| --- | --- |
| 两个模型都会把 `<Divider>` 写成不带 `/` 的形式，后面的内容全被它“吞掉”（deepseek 的测验、doubao 的温度换算因此丢了滑块） | 编译器：不带子元素的组件一律自闭合（`missing_self_close`）；提示词里写明 |
| deepseek 把整个回答连同 `{@state}` / `{@let}` 一起包进 `<Box>`，所有名字都被丢弃，测验点不动 | 编译器：只嵌在元素里的声明提到顶层（`directive_hoisted`）；提示词里写明 |
| doubao（关思考）会写原生 HTML：`<input type="number">`、`<div style={{width…}}>` 画条形图。旧编译器把小写标签当成文字，界面上会直接露出标记，而且旧检查发现不了 | 编译器：已知的 HTML 元素名按标签解析，输入类元素丢弃，容器类元素拆掉、保留内容，都报 `unknown_component`；提示词里写明不能用 HTML 和 style |
| doubao 想画进度条和对比条时没有合适的组件，就借用 `<Slider disabled>` 或 `<Box style>` | 目录：新增只读的 `<Progress value max label tone>`；之后的运行里，打卡表和复利对比都直接用上了它 |
| deepseek 在总结句里把工具数据里的店名、价格重新打了一遍 | 提示词：句子里也只能写引用（`{cheapest.title}`），需要的值用 `@let` 推出来。之后“工具值没被重抄”这一项是 3/3 |
| doubao 开思考时，首屏要等 30 秒左右，复利那条在 180 秒的超时内没写完 | 超时改为可配置，默认 300 秒。界面类回答用关思考的效果差不多，首屏快一个数量级 |

只算编译器改动的效果（用 `--regrade` 重评修正前保存的回答）：deepseek 从 13/15 到 14/15，doubao 从 13/14 到 14/14。剩下那条是重抄工具值，只能靠提示词解决。

## 安全模型

| 层 | 做什么 | 状态 |
| --- | --- | --- |
| 编译器守卫 | acorn 解析每个表达式，按 AST 白名单检查；未知标识符、`this`、`new`、赋值、循环、`constructor`/`__proto__` 访问一律丢弃 | M1 ✅ |
| 目录校验 | 编译时校验字面量；宿主渲染前再按 zod 校验一次（Worker 不可信） | M1 ✅ |
| SES Compartment | 程序在全新的全局对象里求值，只有冻结的 JS 内置对象和显式传入的几个函数；`lockdown()` 冻结所有内置原型 | M1 ✅ |
| Web Worker | 程序与页面不同线程，碰不到 DOM、cookie | M1 ✅ |
| 沙箱 iframe + CSP | `sandbox="allow-scripts"` 让 iframe 成为不透明源（origin 为 `null`），读不到页面、cookie、存储；CSP `default-src 'none'`，只放行内联启动脚本、Blob Worker 和 SES 需要的 `unsafe-eval`。Blob Worker 继承这条 CSP，所以连运行时自己也发不出网络请求 | M3 ✅ |
| 看门狗 | 渲染超时（默认 2 秒）就隔离那个程序、重建沙箱、重画上一个正常的程序；心跳（每 2 秒一次，1.5 秒内要回应）发现事件回调里的卡死；1 分钟内重启超过 3 次就放弃 | M3 ✅ |

两组测试分别守住这几层：
- `packages/runtime/test/program.sandbox.ts` 直接绕过编译器喂恶意程序，验证 Compartment 这一层本身守得住：没有 fetch / 定时器 / postMessage / DOM，不能通过 `constructor` 回到宿主 realm，不能污染原型、改写传入的对象。
- 端到端检查在真实 Chrome 里探测 iframe：`origin` 是 `null`；读 `document.cookie`、`localStorage`、`parent.document` 都抛 `SecurityError`；iframe 和其中的 Worker 发起 `fetch` 都被 CSP 拦下。

## 复用了什么，自己写了什么

| 依赖 | 版本 | 许可 | 用来做什么 |
| --- | --- | --- | --- |
| `zod` | 4.6.7 | MIT | 组件 props 模式、校验、`toJSONSchema` 生成提示词 |
| `acorn` | 8.19.0 | MIT | 解析表达式，做 AST 白名单检查 |
| `ses` | 2.3.0 | Apache-2.0 | `lockdown()` + `Compartment`：程序的隔离边界 |
| `preact` | 10.29.8 | MIT | Worker 里的协调器（diff、事件），不用自己写 reconciler |
| `@remote-dom/core` | 1.12.0 | MIT | Worker 里的远端元素 + DOM polyfill；宿主的 `RemoteReceiver` |
| `@quilted/threads` | 4.1.0 | MIT | 跨 postMessage 调用、函数代理与内存管理 |
| `playwright-core`（开发） | 1.64.1 | Apache-2.0 | 端到端测试，驱动本机已装的 Chrome，不下载浏览器 |
| `vite`（开发） | 7.x | MIT | 演示的开发与构建；库模式把沙箱 Worker 打成单文件 `sandbox-worker.js` |

自己写的部分，以及为什么要自己写：

- **标记语言和编译器**：流式容错（截断修补）、Markdown 与组件混排、常量表、按名字存 state 的代码生成，没有现成库同时满足这些。
- **流式编译器和补丁协议**：每次从头编译整个前缀（实现简单，对半截输入天然稳），再和上一次结果做 diff。字符串 `append` 是标准 JSON Patch 没有的，所以没有用 `fast-json-patch`，自己实现了约 40 行的应用逻辑。
- **React 宿主层（约 300 行）**：`@remote-dom/react` 只支持 React 17/18，还把 `@types/react@18` 列为依赖，会和 React 19 的类型冲突。所以只用 `@remote-dom/core` 的 `RemoteReceiver`，在上面薄薄包一层。
- **按名字存的 state**：放在 Preact 之外。程序重新编译后组件函数会变，Preact 会重新挂载，state 必须活在程序外面才能保住。
- **看门狗（`SandboxController`）**：沙箱的生命周期、渲染队列、超时、心跳、隔离、重启和状态恢复，都放在一个队列里串行执行，避免重启和渲染互相抢。逻辑用假沙箱加假计时器做了单元测试。

## 已知行为与坑

- **SES 必须用 `overrideTaming: 'severe'`。** Preact 用 for-in 复制 vnode，而 vnode 自带一个 `constructor` 属性；复制到普通对象上时会撞上被冻结的 `Object.prototype.constructor`（SES 文档里叫 override mistake）。改成 `moderate` 时第一帧就会报错。
- **元素的 props 作为一个对象过桥。** Worker 把每个元素声明过的 props 打包成一个 `props` 对象，作为唯一的远端属性传给宿主。不这样做的话，Preact 删除一个 prop 时会赋值 `''`，宿主收到的就是一个类型不对的值；Preact 还会把 `width`、`href` 这类名字当作字符串属性处理。结构相同的 props 复用同一个冻结对象，所以流式重编译时没变的元素不会产生更新。
- **SES 用 `localeTaming: 'unsafe'`。** 默认的 `'safe'` 会把 `toLocaleString` 换成 `toString`，把 `localeCompare` 换成按码元比较，所以模型写的 `x.toLocaleString('zh-CN', { maximumFractionDigits: 2 })` 会原样输出 `4490.446878088235`，中文排序也会出错。这个问题是在 DeepSeek 聊天页里试出来的。locale 驯化的目的是确定性和隐藏宿主的地区设置，不是隔离边界，所以关掉它不会让程序多碰到任何东西。lockdown 的配置统一放在 `packages/runtime/src/lockdown-options.ts`，Worker 和沙箱测试都用这一份。
- **SES 2.3 不认识 Chrome 新加的 Iterator helpers**，会在控制台提示移除 `%IteratorPrototype%.join` / `includes`。这是预期行为，不影响程序。
- **state 按名字存在 Worker 里，每个 `TesseraView` 一份。** 同一个视图换一段源码，同名 state 会保留：编辑源码时价格不归零就是靠这一点。聊天场景里每条消息各有一个视图，不会串。
- **演示的流式接口只在 `npm run dev` 下可用。** 它是 Vite 开发服务器里的一个中间件，通过 `ssrLoadModule` 直接加载 TypeScript 源码；静态构建没有后端。真实应用里换成你自己的服务端路由，调用 `createSSEStream` 即可。
- **停止流式时，屏幕保留停止前的输出，编辑器原文不变**（点“恢复编辑”回到原文）。只有正常结束的流才会把文本写回编辑器。
- **沙箱 Worker 必须是经典脚本，不能是 ES 模块。** 不透明源的 iframe 只能从 Blob 启动 Worker。模块 Worker 加载时要做 CORS 同源检查，来自不透明源的 Blob URL 过不了，结果是 “load error”。所以 `sandbox-worker.js` 用 IIFE 格式打包。
- **iframe 里要一直持有 Worker 对象**（挂在 `window` 上），否则启动脚本返回后 Worker 对象可能被回收，Worker 随之终止。
- **改了 `packages/runtime/src` 要重新构建沙箱包**（`npm run build:sandbox`）。`dev` / `build` / `e2e` 会自动先构建一次，但开发服务器不会在你修改后自动重建它。
- **状态镜像只包含 JSON 安全的值**，而且只在一次重绘成功之后才发给宿主。所以宿主手里的永远是“画得出来”的状态，重启后恢复它不会马上再次卡死。
- **重建沙箱的那半秒左右，屏幕停在上一帧，这时的点击会被丢弃**（旧沙箱已经没了）。新沙箱画完后界面才换成新的。
- **演示里的“找图”是本地生成的占位图**（`demo/src/resolvers.ts`），按描述生成一张带文字的 SVG，并模拟 400 毫秒的搜索延迟，不调用任何外部或付费服务。换成真实的图片搜索时，只要返回同样的 `{ url, title, source }` 结构。宿主的 Image 组件只画 `https:` 图片和栅格 / SVG 的 data URL（SVG 放在 `<img>` 里不能执行脚本）。
- **不带子元素的组件一律按自闭合处理。** `<Divider>`、`<Slider …>` 漏写了 `/`，就当作 `<Divider />`，报 `missing_self_close` 警告；配对的 `</Divider>` 直接忽略。像 HTML 的 void 元素那样，它们不会“吞掉”后面的内容。两个评测模型都犯过这个错，修之前会丢掉整段回答。
- **只嵌在元素里的 `{@state}` / `{@let}` 会提到顶层**，报 `directive_hoisted` 警告。元素不引入作用域，所以意思不变。模型常把整个回答包进一个 `<Box>`，连声明一起。放在 `{#if}` / `{#each}` 里的仍然算错误，因为提上来意思就变了。
- **降级版的解释器只覆盖纯表达式的常用子集**：算术、比较、模板字符串、成员访问、`Math.*`、字符串和数组方法（含 `map` / `filter` / `reduce` 等回调）。超出范围的部分显示 `…`，不会报错。
- **`{#if}` 的分支按源码顺序编译**（M6 之前是倒着编译的），这样分支里的 site 在流式时才不变。附带的结果是多分支 `{#if}` 里的诊断也按源码顺序排列。
- **`{#each}` 的循环变量不能以 `__` 开头**，否则报 `reserved_name`、整块丢弃：每层循环有一个隐藏的下标变量（`__k0`、`__k1`），用来给循环里的组件拼实例 id，内外层用同一个下标名也不会互相覆盖。
- **每个组件的代码里多一个 `"__site": "N"`**，没有 props 的组件也从 `null` 变成一个对象，所以生成的代码略长；流式时代码占比的端到端检查仍然通过。
- **体积**（演示构建，gzip 后）：沙箱 Worker 约 50 KB（SES + Preact + remote-dom + threads），只在第一次启动时下载一次。主包约 142 KB，含 React、zod 和 acorn；如果只在服务端编译，acorn 可以不进浏览器。

## 命令

```bash
npm install
npm run dev          # 演示页 http://localhost:5180（含流式接口）；?isolation=worker 切换到纯 Worker 模式；/chat.html 是接 DeepSeek 的聊天页；/feed.html 是短视频广告位
npm run build:sandbox # 重新构建预构建的沙箱 Worker
npm run check        # 类型检查 + 单元测试 + SES 沙箱测试
npm run e2e          # 用本机 Chrome 跑端到端检查（CHROME_PATH 可覆盖路径）：
                     #   阶段 1 生产构建：M1 交互闭环 + M3 隔离与看门狗；阶段 2 开发服务器：M2 流式
npm run eval -- …    # 用真实模型跑基准提示（见“评测（M5）”）
npm run walkthrough  # 重新生成代码导读视频页（见 docs/walkthrough/README.md）
npm run build:dsh    # 构建 DeepSeek Harness 插件（integrations/dsh-plugin/lib）；重启 Harness 后统计页在 http://127.0.0.1:4317
```

当前结果：类型检查通过；单元测试 161 项（含 Harness 插件）、SES 沙箱测试 12 项、端到端检查 28 项通过。其中 `packages/lang/test/data.test.ts` 的“always terminates”按实际耗时判断（1 秒内），机器繁忙时偶尔会超过。端到端截图在 `.e2e/demo.png`。

M6 相关的关键检查：
- 对 4 段示例回答的每个前缀编译一遍：已经写完的组件，site 和最终结果完全一致。
- 真实运行时（SES + remote-dom 的 DOM polyfill）里，宿主收到的 site 和 manifest 一致，props 里没有 `__site`；流式重编译后已在屏幕上的元素 site 不变；`{#each}` 每项一个实例 id，嵌套循环用同一个下标名也对。
- 宿主组件用 `useTesseraSite()` 拿到自己的 site，缺失或格式不对的一律当作没有。
- Harness 插件：收集服务只收本机页面发来的事件，拒绝网站和其他主机名，限制请求体大小，只有统计页能清空；在真实 Chrome 里，只有滚动到的界面才累计可见时长，交互、动作（`copy ← Button`）和 state 归到正确的组件，统计页在浅色、深色和手机宽度下都正常。

M4 相关的关键检查：
- 商品对比里的价格来自 data 表，编译结果里没有价格。
- 两张图在标签写完后由解析器补上，并由宿主画出来。
- 降级版里有绑定的值、算出来的“便宜 400 元”和找到的图。
- 流式时代码占流量的比例在 30% 以下（上表实测约 13%，不拆分时约 41%）。
- 流式商品对比至少收到 2 次 `data` 更新。

M3 相关的关键检查：
- iframe 探测：不透明源；cookie、存储、父页面都读不到；iframe 和其中的 Worker 都联不了网。
- 事件回调卡死：看门狗重建沙箱，计数恢复到卡死前的 2，之后还能正常点到 3。
- 渲染时卡死：该程序被隔离，屏幕保留上一个正常的程序，而且还能继续交互。
- 刷新页面后界面状态保留；“给模型的反馈”里列出被丢弃的内容和用户留下的状态。
- 纯 Worker 模式同样可用。

流式相关的关键检查：
- 客户端应用补丁后的文档，每一步都和服务端一致。
- 最终程序和一次性编译完全相同。
- 滑块在流的中途出现；这时拖动它，流结束后数值仍然保留。
- 停止后保留部分输出，且不覆盖原文。

## 路线图

| 里程碑 | 内容 |
| --- | --- |
| **M1** ✅ | 非流式闭环：目录、编译器、SES Worker、remote-dom、React 宿主、演示、测试 |
| **M2** ✅ | 流式：服务端前缀重编译 + SSE 补丁（structure / constants / text / final）；稳定根组件、工厂缓存、合并更新、出错保留上一帧；`useTesseraStream()` |
| **M3** ✅ | 隔离加固：不透明源 iframe + CSP、看门狗（渲染超时、心跳、隔离、重建、重启上限）、状态镜像（重启恢复、刷新保留）、`feedbackForModel()` |
| **M4** ✅ | 数据与传输：工具结果按 ID 绑定（模型只写引用，字段校验）、服务端解析组件（`<Image query>` + `resolveAll` / 流式 `data` 批次）、会求值的 Markdown 降级版、代码 `splice` 差量传输 |
| **M5** ✅ | 提示词与评测：15 个基准提示 + `npm run eval`（流式计时、SES 回放并触发回调、检查项、反馈修复轮、`--regrade`）；按结果修了编译器（void 组件自闭合、声明提升、原生 HTML 处理）、提示词和目录（`Progress`） |
| **M6** ✅ | 埋点与统计：编译结果带 manifest（每个组件的 site、父组件、来源、字面量 / 绑定 props、事件、循环与条件，布局骨架，state 名）；site 按源码顺序编号、流式不变，经运行时作为元素属性传到宿主，`useTesseraSite()`；Harness 插件的本机统计：收集服务 + 统计页，上报 manifest、可见时长、交互、动作、state 和问题 |
| 之后 | 可选：独立域名的 runner 页面；更多模型和更大的基准集；把埋点做进核心包（`TesseraView` 的事件回调，运行时按 site 归属动作和 state 的变化）；按统计结果调整目录和提示词 |
