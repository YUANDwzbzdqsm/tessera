# dsh-plugin-tessera

把 Tessera 接进 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)。装上以后，模型在对话里可以调用 `render_ui` 工具，用 Tessera 标记写一个交互界面。界面直接出现在聊天记录里，模型一边写，界面一边长出来；按钮、滑块、勾选都在沙箱里运行，点了 `ui.send` 的按钮就相当于用户发了一条消息。

和 Harness 自己的插件一样，它不改 Harness 的任何代码，运行时也不 import Harness 的包，只用文档里写明的扩展点。

## 安装

先在 Tessera 仓库根目录构建：

```bash
npm run build:dsh
```

这一步会生成 `integrations/dsh-plugin/lib/index.js`（服务端）和 `lib/client.js`（浏览器端）。两个文件已经把 Tessera、zod、acorn 都打包进去了，Harness 那边不用装任何依赖。

然后二选一，把插件加进你用的 profile（桌面版是 `desktop`）：

1. **用 Harness 自带的插件命令**（推荐）。它会把这个目录链接进 profile，并把它加进 bundles 列表：

   ```bash
   dsh plugin --profile desktop add C:/Users/yuand/Desktop/my-channel/tessera/integrations/dsh-plugin
   ```

2. **像其他本地插件一样按路径插入**。在 `~/.dsh/profiles/desktop/cordis.patch.yml` 末尾加一行：

   ```yaml
   - insert:
       - id: tessera
         name: C:/Users/yuand/Desktop/my-channel/tessera/integrations/dsh-plugin/lib/index.js
   ```

改完重启 DeepSeek Harness。之后改了插件代码，重新跑 `npm run build:dsh` 再重启就行。

不想动正在用的 profile，可以先用 web 版试：

```bash
dsh web --patch ./tessera.patch.yml --port 3091
```

`tessera.patch.yml` 的内容就是上面第 2 种写法里那一段。

## 怎么工作

```
模型调用 render_ui({ source: "<Tessera 标记>", data: [{ name, tool, match }] })
   │
   ├─ 服务端（lib/index.js）：按 data 从会话里最近的工具结果中取值，带着这张 data 表编译一遍，
   │    把绑定到的名字和字段、被丢掉的部分（未知组件、非法 prop、被拦下的表达式、不存在的字段）作为工具结果告诉模型；
   │    data 表本身放进这次结果的 meta，存进会话日志，但不发给模型
   │
   └─ 浏览器（lib/client.js）：
        Conversation Definition 跟着这次调用走：从第一段流式参数（tool-call-delta）开始，经过完整的 tool/call，
        到 render_ui 自己的 tool/result 为止
        → 从还没写完的 JSON 参数里解出 source 的前缀，每次都重新编译；结果到了以后带上 meta 里的 data 表再编译
        → 聊天里一个 "tessera-ui" 行，用 TesseraView 在不透明源 iframe + SES Worker 里运行
```

- **流式**：参数还在生成时界面就开始出现。历史记录里只有完整的 `tool/call`，所以刷新页面后同一行会从完整参数重新画出来。
- **位置**：这一行放在 Session 层级、锚定在调用的位置。Harness 的聊天会把它不认识的行折进“已完成，用时 N 秒”的过程分组里，那样界面会被收起来；放在 Session 层级后，它显示在调用发生的位置，过程分组会在它前后断开。
- **`ui.send`**：把文字放进输入框并发送。如果输入框里已经有用户没发出的内容（文字或附件），不会覆盖，而是在界面下面提示先处理掉。`ui.copy` 写剪贴板，`ui.open` 只打开 http(s) 链接。
- **状态**：每个界面的状态（滑块位置、勾选等）按“会话 + 调用”存在浏览器的 localStorage 里，刷新后还在。
- **主题**：`src/theme.css` 把组件用到的几个颜色变量映射到 Harness 的主题变量上，浅色、深色模式都跟着 Harness 走。组件本身的样式和演示页共用 `demo/src/components.css`。

## 工具数据

和 Tessera 的 data 表一样，界面可以按名字引用之前的工具结果（`{pkg.version}`），值不经过模型：模型在 `data` 参数里给一次早先的调用起个名字，source 里只写名字。

```json
{
  "data": [
    { "name": "pkg", "tool": "read", "match": "package.json" },
    { "name": "log", "tool": "pwsh", "match": "git log" }
  ],
  "source": "{@let lines = log.trim().split(\"\\n\")}\n# {pkg.name}\n最近 {lines.length} 次提交"
}
```

- **怎么选中一次调用**：`tool` 是工具名，`match` 可选，是那次调用参数里的一段文字（路径、命令的一部分；不分大小写，`\` 和 `/` 视为相同）。取最近一次匹配并且已经成功返回的调用。模型看不到调用 id，所以不用 id。
- **名字里装的是什么**：那次调用返回的文字。`read` 取文件原文（来自结果 meta 里的 `lines`，不带行号），命令行工具取它的输出，其他工具取模型看到的文字。整段文字是 JSON 对象或数组时会被解析，所以 `{pkg.version}` 能用；否则就是字符串，用字符串方法拆。
- **模型听到什么**：工具结果里列出每个名字绑到了哪次调用、有哪些字段（`pkg: read …/package.json → { name, private, scripts, … }`，只有字段名，没有值）；用了不存在的字段会有 `unknown_field`（`{pkg.version ?? "未声明"}`、`||`、`?.` 这类已经兜底的写法除外），绑不上的名字会说明原因（没有这样的调用、还没返回、失败了、太大）并列出最近几次调用。
- **服务端从哪里取**：插件注册了一个只在服务端用的会话投影（`ctx.sessionProjections`，键 `tessera.toolOutputs`），从会话日志的 `tool/call` 和 `tool/result` 折叠出最近 24 次调用的结果。投影是从日志算出来的，所以 Harness 重启后，引用重启前的调用也照样能绑上。没有这个服务时插件照常工作，只是绑不了数据，并在结果里说明。
- **浏览器从哪里取**：服务端把解析好的 data 表放进 render_ui 结果的 `presentationMeta`（`meta.tesseraData`）。它和结果一起存进会话日志，不进模型的上下文。浏览器那一行从这次调用自己的结果里读 data，所以刷新页面、重启 Harness 后都能从历史重建，被引用的那次调用不在已加载的历史窗口里也没关系。
- **流式时**：参数还在生成时还没有 data，绑定的名字暂时显示为空；render_ui 的结果一到，值就填进去。写法错误的提示也等结果到了才显示。

## 统计（M6）

插件在本机起一个小服务，记录每个界面是怎么被看、怎么被用的。它建立在 Tessera 的 M6 上：编译结果里的 manifest 说明界面由哪些组件组成，每个组件的 site 把屏幕上发生的事对回到组件（见[主 README 的“埋点与统计”](../../README.md#埋点与统计m6)）。Harness 运行时打开 http://127.0.0.1:4317 就是统计页（每 3 秒刷新），有组件使用量、字面量 props（样式）、布局骨架、动作、改过的 state、诊断，以及每个界面逐个组件的明细。

| 事件 | 什么时候 | 内容 |
| --- | --- | --- |
| `generated` | 界面定稿（render_ui 的结果到了） | 编译器的 manifest：每个组件的 site、父组件、字面量 props、事件，布局骨架，诊断码 |
| `exposure` | 每 5 秒汇总一次 | 每个组件、以及整个界面“至少一半在屏幕上”的时长 |
| `interaction` | 每 5 秒汇总一次 | 每个组件的事件被触发了几次；滑块、勾选记最后的值 |
| `action` | 立刻 | `ui.send` / `copy` / `open`，以及动作前 1.5 秒内碰过的组件 |
| `state` | 立刻 | 值变了的 state 名；数字和布尔值带上新值 |
| `issue` | 立刻 | 宿主或运行时报的问题码 |

- **怎么连上的**：服务端起好以后，把地址放进 render_ui 结果的 meta（`tesseraTelemetry`），浏览器那半拿到地址才上报。服务没起来（关了、端口被占）时，浏览器什么都不发。
- **数据在哪**：`integrations/dsh-plugin/.telemetry/events.ndjson`，一行一个事件，不进 git。统计页上的“清空数据”会清掉它。
- **边界**：只监听 127.0.0.1；只收本机页面（或桌面版的 app 协议）发来的事件，网站发不进来；只有统计页自己能清空。数据不经过模型，也不出本机。
- **口径**：
  - 可见时长按秒计。只有页面可见、窗口有焦点、并且确实在绘制时才计时；比视口还高的组件，占到半屏就算可见。
  - `{#each}` 的每个实例分开上报，统计时加到同一个组件上。
  - 刷新页面会把历史里的界面再报一次 `generated`，统计时每个界面只算最新的那份。
- **怎么定位组件**：插件把每个宿主组件包一层，在它前面放一个 `display: none` 的标记，用标记后面的元素计时；事件 prop 在调用前先计数。不画自己元素的组件只计交互，不计时长。
- **关掉或换端口**：在 profile 的 `cordis.patch.yml` 里给这一项加 config：

  ```yaml
  - insert:
      - id: tessera
        name: C:/Users/yuand/Desktop/my-channel/tessera/integrations/dsh-plugin/lib/index.js
        config:
          telemetry: false            # 关掉；或者 { port: 4318, dir: D:/somewhere }
  ```

  桌面版和 `dsh web` 同时开时，后启动的那个拿不到 4317，日志里会提示，那边就不统计。

## 目录里有什么

除了 Markdown 组件，还有入门组件集里的 Box、Slider、Checkbox、Button、Caption、Badge、Progress、Divider，以及 [PullRequest 卡片](../../demo/src/pullRequest.ts)，适合编码 Agent 汇报一个分支的状态。

去掉了 `<Image>`：它要靠服务端的找图解析器，Harness 里没有。

## 已知限制

- **每个界面一个沙箱。** 每一行都会启动自己的 iframe 和 Worker（SES + Preact；代码已经打进 client.js，不会再下载）。一个会话里界面很多时，内存会跟着涨。
- **工具数据有上限。** 只记最近 24 次调用；一次结果超过 10 万字符就不能绑定（会让模型先用 head、jq 或更小的 read 缩小范围）；一次 render_ui 最多绑 8 个名字。只认原生的工具调用，`run_code` 里的子调用不在其中。
- **data 表会在日志里多存一份。** 绑定的值会随 render_ui 的结果再存一次，这样历史才能独立重建；绑大文件会让会话日志变大。- **通用工具行还在。** Harness 会照常为每次调用画一个可折叠的工具行（`render_ui · …`），界面行在它旁边。
- **流式效果取决于模型。** 模型一次性吐出整段工具参数时，界面会在参数结束时一下子出现，而不是慢慢长出来。
- **组件代码来自演示页。** 宿主组件（`demo/src/components.tsx`、PullRequest 卡片）和样式现在直接从 `demo/src` 引入。以后如果还有别的宿主，值得把它们抽成单独的包。

## 测试

```bash
npm test               # 含 integrations/dsh-plugin/test：流式参数解码、Definition 的折叠逻辑、工具反馈、工具数据的投影与绑定
```

在真实的 Harness（桌面版 0.2.0-rc.2 自带的 `dsh web`）里手动验证过：模型调用 `render_ui` 后界面出现在聊天里，可以拖动；点按钮会发出消息并开始新一轮；输入框有草稿时不会被覆盖；刷新后从历史恢复并保留状态；PR 卡片在流式时出现；浅色和深色主题都正常。

工具数据也在 `dsh web` 里验证过：模型先 `read` package.json、用 `pwsh` 跑 `git log --oneline -5`，再用 `data` 绑定两者调用 `render_ui`，卡片显示包名和 5 次提交，而 render_ui 的 source 里没有这些值；刷新页面、重启 `dsh web` 之后卡片都从历史重建；重启后让模型不重新读文件、直接绑定重启前那次 `read`，也能列出全部 scripts。
