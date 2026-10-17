# Tessera

让模型的回复变成可交互界面的引擎：模型写一种为流式生成设计的标记语言，编译器把它变成一段 JS 程序和一张常量表，程序在 SES 沙箱 Worker 里运行，界面通过 remote-dom 镜像回宿主页面，再由你自己的 React 组件画出来。

思路参考了第三方对 ChatGPT Intelligent UI 的公开分析，是按公开描述做的独立实现：没有使用 ChatGPT 的任何代码，语言语法也是自己定义的。Tessera 是暂用的名字。

> 当前进度：**M1 非流式闭环**、**M2 流式编译 + SSE 补丁**已完成。iframe 隔离层、数据绑定等见文末路线图。

## 一条回复的旅程

```
模型逐 token 输出（Tessera 标记）
   │  @tessera/stream/server：每隔一段时间把已到达的全部前缀重新编译，只发变化的部分
   │  @tessera/lang：分词 → 建树（截断修补）→ Markdown 转组件 → 表达式守卫 → 代码生成
   ▼
SSE：event: patch  data: {seq, kind, ops}  ← 结构变了才重发代码；文字变长只追加常量
   │  @tessera/stream：浏览器端解析 SSE、应用补丁，得到 { text, code, constants, diagnostics, done }
   ▼
{ code, constants }                       ← 纯数据，可以随消息存储、跨 postMessage 传递
   │  @tessera/react：TesseraView 把程序交给沙箱；更新太快时只渲染最新的一个
   ▼
Web Worker（@tessera/runtime/worker）
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
| `@tessera/catalog` | 组件目录：zod props 模式、事件、子内容类型；校验；生成提示词里的组件说明 | 任意环境 |
| `@tessera/lang` | 编译器 `compile()`、表达式守卫、`systemPrompt()` | 服务器或浏览器 |
| `@tessera/stream` | 补丁协议、`applyOps`、SSE 编解码、`readTesseraStream`；`@tessera/stream/server` 是流式编译器和 SSE 输出 | 主入口任意环境；`/server` 在服务器 |
| `@tessera/runtime` | 沙箱运行时。主入口只导出类型；`@tessera/runtime/worker` 是 Worker 入口 | Web Worker |
| `@tessera/react` | `<TesseraView>`：启动沙箱、接收远端树、用你的组件渲染；`useTesseraStream()` 读取流 | 宿主页面（React ≥ 18） |
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
| Markdown | `#`/`##`/`###` 标题、段落、`- `/`1. ` 列表、`**粗体**`、`*斜体*`、`` `代码` ``，编译成目录里的 Title / Text / List 等组件 |
| `<Name prop="文本" prop={表达式} flag />` | 只能用目录里的组件和 props；字面量在编译时就按 zod 校验 |
| `{@state name = 初值}` | 声明 state 和它的 setter `setName`；必须写在顶层、独占一行 |
| `{@let name = 表达式}` | 派生值；顶层、独占一行，只能引用前面声明过的名字 |
| `{表达式}` | 插值。允许算术、比较、三元、模板字符串、数组方法、箭头函数；不允许赋值、`new`、循环、`this`、`constructor` 等 |
| `{#if a}…{:else if b}…{:else}…{/if}` | 条件 |
| `{#each list as item, i}…{/each}` | 循环 |
| `ui.send(text)` / `ui.copy(text)` / `ui.open(url)` | 离开沙箱的动作，由宿主处理 |
| `\{` `\}` `\<` | 字面量字符 |

**写到一半也能编译。** 末尾不完整的结构（没闭合的 `{`、没有 `>` 的标签）直接丢弃；已经有内容的未闭合元素自动闭合，空的直接丢弃。每处修补都会记成诊断。所以 M2 只需要对前缀反复调用 `compile()`。

## 在应用里使用

```tsx
// tessera.worker.ts
import '@tessera/runtime/worker';
```

```tsx
import { defineCatalog } from '@tessera/catalog';
import { compile, systemPrompt } from '@tessera/lang';
import { TesseraView } from '@tessera/react';

const catalog = defineCatalog();                 // Markdown 组件 + 入门组件集，也可以传你自己的 specs
const createWorker = () =>                       // 模块级定义，保持引用稳定
  new Worker(new URL('./tessera.worker.ts', import.meta.url), { type: 'module' });

const prompt = systemPrompt(catalog);            // 拼进给模型的系统提示词
const program = compile(modelOutput, { catalog }); // { code, constants, diagnostics }

<TesseraView
  program={program}
  catalog={catalog}
  components={myComponents}                      // { Slider: MySlider, Title: MyTitle, ... }
  createWorker={createWorker}
  onAction={(a) => a.type === 'send' && chat.send(a.text)}
  onIssue={(i) => console.warn(i)}
/>
```

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

<TesseraView program={stream.doc} catalog={catalog} components={myComponents} createWorker={createWorker} />
// stream.status: idle | streaming | done | stopped | error；stream.stats：各类更新次数和字节数
```

每个补丁批次带一个 `kind`：

| kind | 什么时候 | 发什么 |
| --- | --- | --- |
| `structure` | 有组件、语句或代码块写完了，编译出的代码变了 | 新增原文 + 整段代码 + 常量变化 |
| `constants` | 代码没变，只是静态文字变长 | 新增原文 + 常量表的 `append` / `add` |
| `text` | 模型正写在没完成的标签中间，界面不变 | 只有新增原文 |
| `final` | 流结束 | 剩余变化 + `done: true` |

补丁是 JSON Patch 的一个小子集：`replace`、`add`（`/-` 表示追加到数组），外加一个字符串拼接用的 `append`，这样文字变长时只传新增的字。每批带 `seq`，客户端发现乱序会报错。

为了让流式顺滑，运行时做了这几件事：

- **根组件稳定。** 每次更新都是一个新程序，但 Preact 看到的根组件始终是同一个包装组件，程序被当作函数调用。所以新程序是和旧树做 diff，而不是整棵树卸载重建，正在拖的滑块不会被打断。
- **代码没变就不重新求值。** 只有常量变化时复用已求值的工厂函数，换一张常量表即可。同一个视图复用一个 Compartment。
- **出错保留上一帧。** 新程序加载失败或渲染抛错时，屏幕上保留上一个能用的输出。
- **合并更新。** `TesseraView` 一次只让沙箱渲染一个程序；渲染期间来了多个新程序，直接跳到最新的那个。

演示里一次完整的“团队估价”流式（600 字/秒，每 100 毫秒重编译）：19 次更新，其中结构 9、常量 2、纯文本 7、结束 1；共 11.6 KB，重发代码占 49%。按结构哈希缓存代码、只发代码差异，是后面可以继续压缩的地方。

**受控输入要保留本地副本。** 回调要先进沙箱、再把新值发回来，中间有一次往返。普通受控 input 在这段时间里会被 React 拉回旧值，所以演示里的 Slider、Checkbox 都先更新本地 state，再等 props 同步（见 `demo/src/components.tsx`）。

## 安全模型

| 层 | 做什么 | 状态 |
| --- | --- | --- |
| 编译器守卫 | acorn 解析每个表达式，按 AST 白名单检查；未知标识符、`this`、`new`、赋值、循环、`constructor`/`__proto__` 访问一律丢弃 | M1 ✅ |
| 目录校验 | 编译时校验字面量；宿主渲染前再按 zod 校验一次（Worker 不可信） | M1 ✅ |
| SES Compartment | 程序在全新的全局对象里求值，只有冻结的 JS 内置对象和显式传入的几个函数；`lockdown()` 冻结所有内置原型 | M1 ✅ |
| Web Worker | 程序与页面不同线程，碰不到 DOM、cookie | M1 ✅ |
| 沙箱 iframe + CSP `default-src 'none'` | 把 Worker 再套一层无网络权限的 iframe | M3 |
| 看门狗 | 程序超时无响应就终止并重建 Worker | M3 |

`packages/runtime/test/program.sandbox.ts` 直接绕过编译器喂恶意程序，验证 Compartment 这一层本身守得住：没有 fetch / 定时器 / postMessage / DOM，不能通过 `constructor` 回到宿主 realm，不能污染原型、改写传入的对象。

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

自己写的部分，以及为什么要自己写：

- **标记语言和编译器**：流式容错（截断修补）、Markdown 与组件混排、常量表、按名字存 state 的代码生成，没有现成库同时满足这些。
- **流式编译器和补丁协议**：每次从头编译整个前缀（实现简单，对半截输入天然稳），再和上一次结果做 diff。字符串 `append` 是标准 JSON Patch 没有的，所以没有用 `fast-json-patch`，自己实现了约 40 行的应用逻辑。
- **React 宿主层（约 300 行）**：`@remote-dom/react` 只支持 React 17/18，还把 `@types/react@18` 列为依赖，会和 React 19 的类型冲突。所以只用 `@remote-dom/core` 的 `RemoteReceiver`，在上面薄薄包一层。
- **按名字存的 state**：放在 Preact 之外。程序重新编译后组件函数会变，Preact 会重新挂载，state 必须活在程序外面才能保住。

## 已知行为与坑

- **SES 必须用 `overrideTaming: 'severe'`。** Preact 用 for-in 复制 vnode，而 vnode 自带一个 `constructor` 属性；复制到普通对象上时会撞上被冻结的 `Object.prototype.constructor`（SES 文档里叫 override mistake）。改成 `moderate` 时第一帧就会报错。
- **元素的 props 作为一个对象过桥。** Worker 把每个元素声明过的 props 打包成一个 `props` 对象，作为唯一的远端属性传给宿主。不这样做的话，Preact 删除一个 prop 时会赋值 `''`，宿主收到的就是一个类型不对的值；Preact 还会把 `width`、`href` 这类名字当作字符串属性处理。结构相同的 props 复用同一个冻结对象，所以流式重编译时没变的元素不会产生更新。
- **SES 2.3 不认识 Chrome 新加的 Iterator helpers**，会在控制台提示移除 `%IteratorPrototype%.join` / `includes`。这是预期行为，不影响程序。
- **state 按名字存在 Worker 里，每个 `TesseraView` 一份。** 同一个视图换一段源码，同名 state 会保留：编辑源码时价格不归零就是靠这一点。聊天场景里每条消息各有一个视图，不会串。
- **演示的流式接口只在 `npm run dev` 下可用。** 它是 Vite 开发服务器里的一个中间件，通过 `ssrLoadModule` 直接加载 TypeScript 源码；静态构建没有后端。真实应用里换成你自己的服务端路由，调用 `createSSEStream` 即可。
- **停止流式时，屏幕保留停止前的输出，编辑器原文不变**（点“恢复编辑”回到原文）。只有正常结束的流才会把文本写回编辑器。
- **体积**（演示构建，gzip 后）：Worker 约 50 KB（SES + Preact + remote-dom + threads）。主包约 142 KB，含 React、zod 和 acorn；如果只在服务端编译，acorn 可以不进浏览器。

## 命令

```bash
npm install
npm run dev          # 演示页 http://localhost:5180（含流式接口）
npm run check        # 类型检查 + 单元测试 + SES 沙箱测试
npm run e2e          # 用本机 Chrome 跑端到端检查（CHROME_PATH 可覆盖路径）：
                     #   阶段 1 生产构建：M1 交互闭环；阶段 2 开发服务器：M2 流式
```

当前结果：类型检查通过；单元测试 53 项、SES 沙箱测试 8 项、端到端检查 14 项全部通过。端到端截图在 `.e2e/demo.png`。

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
| M3 | 隔离加固：iframe + CSP、看门狗、编译诊断回传给模型；传输优化：代码按结构哈希缓存、只发代码差异 |
| M4 | 数据与动作：工具结果按 ID 绑定（模型只写引用）、服务端解析组件（如按描述搜图）、Markdown 降级版本 |
| M5 | 提示词与评测：一组基准提示，统计解析成功率、诊断数、首屏 token 数 |
