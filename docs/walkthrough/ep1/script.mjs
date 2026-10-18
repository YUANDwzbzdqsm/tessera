// Episode 1 script (v2 player): one chat message from the send button to SSE frames on the wire.
// Each beat is one subtitle paragraph, the code or frames on the left, and what the whiteboard on the right draws,
// highlights and animates meanwhile. Line numbers are the repo's real ones at commit aa34cf6.

export const meta = {
  ep: 1,
  title: 'Tessera 代码导读 第 1 集',
  eyebrow: 'TESSERA 代码导读 · 第 1 集 / 共 6 集',
  h1: '消息进门：从发送按钮到 SSE 帧',
  lede: '跟着一条聊天消息走过服务端：左边读真实的代码，右边一边讲一边把架构图画出来，请求、文字碎片、补丁和停止信号都会沿着箭头跑给你看。行号对应 tessera 仓库的提交 aa34cf6。',
  short: '第 1 集 · 消息进门',
  stationWord: '站',
  boardLabel: '第 1 集的架构图',
  wireLabel: 'POST /api/stream',
  finish: '第 1 集看完了',
  next: '下一集：流式编译器，每次重编译，只发变化。',
};

export const files = {
  chatapp: { path: 'demo/src/chat/ChatApp.tsx', from: 103, to: 115 },
  vite: { path: 'demo/vite.config.ts', from: 14, to: 57 },
  chat: { path: 'demo/src/server/chat.ts', from: 26, to: 67 },
  server: { path: 'packages/stream/src/server.ts', from: 154, to: 218 },
  sse: { path: 'packages/stream/src/sse.ts', from: 4, to: 8 },
};

export const stations = [
  { name: 'ChatApp' },
  { name: 'sseRoute' },
  { name: 'chatBody' },
  { name: 'modelText' },
  { name: 'createSSEStream' },
  { name: 'SSE 帧' },
];

// This episode's whiteboard, 520 × 600 board units.
export const localDiagram = {
  w: 520,
  h: 600,
  zones: [
    { id: 'z-browser', x: 8, y: 8, w: 504, h: 100, label: '浏览器' },
    { id: 'z-server', x: 8, y: 124, w: 504, h: 352, label: '开发服务器（Vite 兼职当后端）' },
    { id: 'z-model', x: 8, y: 492, w: 504, h: 100, label: '外部模型' },
  ],
  nodes: [
    { id: 'app', x: 24, y: 40, w: 168, h: 54, label: 'ChatApp', sub: 'send() · fetch' },
    { id: 'reader', x: 320, y: 40, w: 176, h: 54, label: 'readTesseraStream', sub: '第 3 集：浏览器收流', ep: 3 },
    { id: 'route', x: 24, y: 158, w: 168, h: 54, label: 'sseRoute', sub: 'vite.config.ts' },
    { id: 'body', x: 24, y: 278, w: 168, h: 54, label: 'chatBody', sub: 'chat.ts' },
    { id: 'prompt', x: 206, y: 226, w: 112, h: 36, label: 'systemPrompt', sub: '' },
    { id: 'model', x: 24, y: 398, w: 168, h: 54, label: 'modelText', sub: 'chat.ts · 异步生成器' },
    { id: 'pump', x: 320, y: 278, w: 176, h: 54, label: 'createSSEStream', sub: 'stream/server.ts' },
    { id: 'compiler', x: 320, y: 398, w: 176, h: 54, label: 'createStreamCompiler', sub: '第 2 集：流式编译器', ep: 2 },
    { id: 'deepseek', x: 24, y: 524, w: 168, h: 54, label: 'DeepSeek API', sub: 'api.deepseek.com' },
  ],
  edges: [
    { id: 'post', from: 'app', to: 'route', label: 'POST /api/chat', lx: 54 },
    { id: 'open', from: 'route', to: 'body', label: 'open()' },
    { id: 'pr', from: 'prompt', to: 'body', fs: 'l', ts: 'r', label: '' },
    { id: 'hist', from: 'body', to: 'model', label: '提示词 + 历史' },
    { id: 'req', from: 'model', to: 'deepseek', off: [-40, -40], label: '请求', at: 0.3, lx: -22 },
    { id: 'tok', from: 'deepseek', to: 'model', off: [40, 40], label: 'SSE 碎片', at: 0.7, lx: 32 },
    { id: 'yield', from: 'model', to: 'pump', fs: 'r', ts: 'l', off: [-12, -12], label: 'yield 碎片', at: 0.55, ly: -12 },
    { id: 'next', from: 'pump', to: 'model', fs: 'l', ts: 'r', off: [12, 12], label: 'next()', dashed: true, at: 0.5, ly: 14 },
    { id: 'push', from: 'pump', to: 'compiler', off: [-40, -40], label: 'push', lx: -22 },
    { id: 'batch', from: 'compiler', to: 'pump', off: [40, 40], label: '补丁批次', lx: 32 },
    { id: 'pipe', from: 'pump', to: 'route', fs: 't', ts: 'r', off: [0, 12], label: '字节水管', at: 0.45 },
    { id: 'sse', from: 'route', to: 'reader', fs: 'r', ts: 'b', off: [-12, 0], label: 'SSE 帧', at: 0.55 },
  ],
};

const STOP = 'stop';
const PULL = 'pull';

export const chapters = [
  {
    title: '开场：地图上的第一块',
    station: null,
    beats: [
      { view: null, board: { diagram: 'series', all: true, focus: ['ep1'] }, text: '先看全系列的地图。一条消息绕一圈：发出去、编译、流回来、进沙箱、画到屏幕上，一共六集，每集负责一块。这一集是第一块：消息怎么进门。' },
      { view: null, board: { diagram: 'local', add: ['z-browser', 'z-server', 'z-model'] }, text: '这一集我们边走边画。舞台有三块：浏览器、开发服务器、外部模型。每讲到一站，就把它画上去。' },
      { view: null, board: { add: ['app', 'route', 'body', 'model', 'deepseek', 'post', 'open', 'hist', 'req'], focus: ['app', 'route', 'body', 'model', 'deepseek'] }, text: '主线就是这一串：浏览器里的 ChatApp，服务器里的 sseRoute、chatBody、modelText，最后问到 DeepSeek。回来的路，我们讲到的时候再画。' },
    ],
  },
  {
    title: '按下发送',
    station: 0,
    beats: [
      { view: 'code', file: 'chatapp', lines: [103, 105], board: { focus: ['app'] }, text: '第一站在浏览器里。send 是你按发送时调用的函数。104、105 行先去掉首尾空格；空消息，或者上一条还没回完，就直接返回。' },
      { view: 'code', file: 'chatapp', lines: [106, 108], board: { focus: ['app'] }, text: '106、107 行造两条记录：你的消息，和一条空的助手消息，先占个位置，等回复流进来再填。108 行把对话整理成 role 加 content 的列表。' },
      { view: 'code', file: 'chatapp', lines: [112, 114], note: '请求从这里出门', board: { focus: ['post'], flows: [{ edge: 'post', label: 'POST /api/chat', every: 1.8 }] }, link: { ep: 3, label: '第 3 集：回复怎么读回来' }, text: '112 到 114 行，用 fetch 向 /api/chat 发一个 POST，正文就是这份对话历史。看右边，请求沿着箭头出门了。回复怎么读回来，是第三集的事。' },
    ],
  },
  {
    title: '请求进门',
    station: 1,
    beats: [
      { view: 'code', file: 'vite', lines: [22, 24], board: { focus: ['route'] }, text: '第二站是服务器。这个项目没有单独的后端，Vite 开发服务器兼职当后端。23、24 行注册了两个地址：/api/stream 接假模型，/api/chat 接 DeepSeek，都交给 sseRoute。' },
      { view: 'code', file: 'vite', lines: [29, 37], board: { focus: ['route', 'post'], flows: [{ edge: 'post', label: '{ messages: […] }', every: 2.2 }] }, text: 'sseRoute 是所有流式请求的入口。31 行只接受 POST，37 行读出请求正文，解析成 JSON，就是浏览器刚发来的对话历史。' },
      { view: 'code', file: 'vite', lines: [38, 43], note: '连接一断，就取消', board: { stop: ['post'], focus: ['route'], flows: [{ edge: 'post', label: '✕ 连接断开', tone: STOP, every: 2.4 }] }, text: '38 行的 AbortController，可以当成一个取消按钮。40 行监听连接关闭：你点了停止或者关掉页面，就按下它。它会一路传下去，这一集最后会看到它怎么停掉整条链。' },
      { view: 'code', file: 'vite', lines: [39, 39], note: 'open 返回一根字节水管', board: { add: ['pump', 'pipe'], focus: ['open', 'pipe'], flows: [{ edge: 'open', label: 'open(body, signal)', every: 2.4 }] }, text: '39 行最关键：open 返回一个 ReadableStream，可以想成一根字节水管。对 /api/chat 来说，open 调的是 chat.ts 的 chatBody，而水管其实是 createSSEStream 造的，第五站再细看。' },
      { view: 'code', file: 'vite', lines: [44, 51], note: 'content-type: text/event-stream', board: { add: ['sse', 'reader'], focus: ['pipe', 'sse', 'route'], flows: [{ edge: 'pipe', labels: ['read()', 'read()', 'read()'], every: 1.1 }, { edge: 'sse', labels: ['res.write', 'res.write', 'res.write'], every: 1.1, delay: 0.6 }] }, text: '45 行先写响应头，告诉浏览器这是 SSE。46 到 50 行循环：从水管读一块，就往响应里写一块，直到流完。入口就这么简单：读请求，接水管，边读边写。' },
    ],
  },
  {
    title: '整理对话',
    station: 2,
    beats: [
      { view: 'code', file: 'chat', lines: [30, 34], board: { focus: ['body'] }, text: '第三站，chatBody。31 到 34 行在清洗：只留用户和助手两种角色，去掉空消息，只保留最近 20 条，每条最多两万字。浏览器发来的东西，服务端要自己把关。' },
      { view: 'code', file: 'chat', lines: [28, 28], board: { add: ['prompt', 'pr'], focus: ['prompt', 'pr'] }, text: '28 行是系统提示词。systemPrompt 把 Tessera 的写法和可用组件写成一段说明，大约一千二百个 token，每次请求都放在最前面，模型才知道能写哪些组件。' },
      { view: 'code', file: 'chat', lines: [35, 35], note: '问模型 → 编译并发送', board: { add: ['yield'], focus: ['hist', 'yield', 'pipe'], flows: [{ edge: 'hist', label: '提示词 + 20 条历史', every: 2.4 }] }, text: '35 行把它们接起来：提示词加对话历史，交给 modelText 去问模型；modelText 的输出，再交给 createSSEStream。这一行是整条流水线的接头，右边亮着的三段箭头，就是它连起来的。' },
    ],
  },
  {
    title: '去问 DeepSeek',
    station: 3,
    beats: [
      { view: 'code', file: 'chat', lines: [38, 39], note: 'async function*：异步生成器', board: { focus: ['model'] }, text: '第四站，modelText。注意 39 行的 async 和星号：这是异步生成器。它不一次返回整个答案，而是收到一小段，就 yield 吐出一小段。' },
      { view: 'code', file: 'chat', lines: [40, 47], board: { focus: ['req', 'deepseek'], flows: [{ edge: 'req', label: 'stream: true', every: 2.2 }] }, text: '40 行检查 key。41 到 46 行用 fetch 调 DeepSeek，44 行的 stream: true 让它边想边发。key 只在服务器上用，浏览器永远看不到。' },
      { view: 'code', file: 'chat', lines: [49, 55], board: { add: ['tok'], focus: ['tok'], flows: [{ edge: 'tok', labels: ['data: {…}', 'data: {…}', 'data: {…}'], every: 0.8 }] }, text: '有意思的是，DeepSeek 返回的也是 SSE。所以 49 到 55 行一块一块读字节，用 TextDecoder 解成文字，攒进 buffer。' },
      { view: 'code', file: 'chat', lines: [56, 64], board: { focus: ['tok', 'model'], flows: [{ edge: 'tok', labels: ['"##"', '" 你好，"', '"{@"', '"state n"'], every: 0.9 }] }, text: '56 行起按换行切开。以 data: 开头的才是事件；遇到 DONE 就结束；否则解析 JSON，取出 delta.content，也就是新写的几个字。' },
      { view: 'code', file: 'chat', lines: [64, 64], note: '要一块，给一块', board: { add: ['next'], focus: ['yield', 'next'], flows: [{ edge: 'next', label: 'next()', tone: PULL, every: 1.8 }, { edge: 'yield', labels: ['##', ' 你好，', '{@', 'state n'], every: 1.8, delay: 0.9 }] }, text: '64 行 yield 出去。而且是对方要一块，它才给一块：右边蓝色的 next 是 createSSEStream 来要，绿色的是 modelText 从上次停下的地方接着跑，交出下一块。' },
    ],
  },
  {
    title: '边收边编译',
    station: 4,
    beats: [
      { view: 'code', file: 'server', lines: [154, 163], board: { focus: ['pump'] }, text: '第五站是今天的主角，createSSEStream。它吃进那串碎片，返回一个 ReadableStream，就是 sseRoute 一直在读的那根水管。' },
      { view: 'code', file: 'server', lines: [165, 165], note: '流式编译器：第 2 集细讲', board: { add: ['compiler', 'push', 'batch'], focus: ['compiler'] }, link: { ep: 2, label: '第 2 集：流式编译器' }, text: '165 行创建流式编译器。它把目前收到的全部文字重新编译一遍，跟上一次比，只把变化打包成一个补丁批次。它内部怎么做，第二集讲。' },
      { view: 'code', file: 'server', lines: [167, 169], board: { focus: ['batch', 'pipe'], flows: [{ edge: 'batch', label: '补丁批次', every: 1.8 }, { edge: 'pipe', label: 'enqueue', every: 1.8, delay: 0.9 }] }, text: '167 到 169 行的 send：把补丁批次用 encodeEvent 变成 SSE 文本，编码成字节，enqueue 塞进水管。' },
      { view: 'code', file: 'server', lines: [170, 182], board: { focus: ['pump'] }, text: '170 到 182 行处理图片这类要服务器去查的组件，今天先跳过。' },
      { view: 'code', file: 'server', lines: [188, 194], note: '核心循环', board: { focus: ['yield', 'push', 'batch', 'pipe'], flows: [{ edge: 'yield', labels: ['##', ' 你好，', '这是'], every: 1.4 }, { edge: 'push', label: 'push', every: 1.4, delay: 0.7 }, { edge: 'batch', label: '批次', every: 2.8, delay: 1.4 }, { edge: 'pipe', label: '字节', every: 2.8, delay: 2.1 }] }, text: '核心是 188 到 194 行的循环。189 行等下一个碎片；192 行把碎片推给编译器，离上次编译超过 100 毫秒，就得到一个批次，交给 step 发走。右边就是这一圈。' },
      {
        view: 'code',
        file: 'server',
        lines: [193, 193],
        board: {
          focus: ['pump'],
          scene: { type: 'timer', title: '193 行的闹钟：每来一个碎片就重新定时，安静满 100 毫秒就冲刷', arrivals: [0, 35, 60, 90, 120, 330, 350, 470], labels: ['##', '', '你好', '', '这是一个', '会动', '', '的界面'], interval: 100, span: 620, dur: 7 },
        },
        text: '193 行是个小心思：每来一个碎片，就重新定一个闹钟。看下面这条时间线：碎片接连到达时闹钟一直被重置；模型一停顿，闹钟走满 100 毫秒，就把攒着的文字冲刷出去。',
      },
      { view: 'code', file: 'server', lines: [195, 202], board: { focus: ['batch', 'pipe'], flows: [{ edge: 'batch', label: 'done: true', every: 2.6 }] }, text: '模型说完后，197 行最后冲刷一次，199 行等图片查完，200 行发出最终批次，里面带着 done 等于 true。' },
      {
        view: 'code',
        file: 'server',
        lines: [203, 216],
        note: '停止信号怎么传',
        board: {
          stop: ['post', 'pipe', 'yield', 'req'],
          flows: [
            { edge: 'post', label: '✕ 停止', tone: STOP, every: 3.2 },
            { edge: 'pipe', label: 'cancel()', tone: STOP, reverse: true, delay: 0.8, every: 3.2 },
            { edge: 'yield', label: 'return()', tone: STOP, reverse: true, delay: 1.6, every: 3.2 },
            { edge: 'req', label: 'abort', tone: STOP, delay: 2.4, every: 3.2 },
          ],
        },
        text: '出错时，205 行发一个 error 事件。212 行的 cancel 对应停止：看右边红色的信号，连接一断，水管被取消，modelText 跟着停，DeepSeek 的请求也被第二站的取消按钮断开，整条链一起停下。',
      },
    ],
  },
  {
    title: '网线上的 SSE 帧',
    station: 5,
    beats: [
      {
        view: 'code',
        file: 'sse',
        lines: [5, 8],
        note: 'event 一行，data 一行，空行结束',
        board: { focus: ['sse'], scene: { type: 'type', title: 'encodeEvent 写出来的一条消息', lines: ['event: patch', 'data: {"seq":0,"kind":"structure","ops":[…]}', ''] } },
        text: '最后一站，看真正发出去的是什么。encodeEvent 一行写 event，一行写 data，再加一个空行。空行在 SSE 里表示：这条消息结束了。',
      },
      { view: 'wire', frames: [0], board: { focus: ['sse'], flows: [{ edge: 'sse', label: '第 0 帧', every: 2.2 }] }, link: { ep: 3, label: '第 3 集：浏览器怎么解析这些帧' }, text: '这是从开发服务器真实抓到的一条流。要写的是：标题你好，状态 n，一个滑块，一句现在是 n。第 0 帧只收到两个井号，就已经生成了第一版程序。' },
      { view: 'wire', frames: [1], board: { focus: ['sse'], flows: [{ edge: 'sse', label: '第 1 帧 · splice', every: 2.2 }] }, link: { ep: 2, label: '第 2 集：为什么代码会改中间' }, text: '第 1 帧收到你好和半个花括号，两个井号变成了标题。code 用的是 splice：只替换中间变了的一小段，不整段重发。半个花括号算没写完，先丢掉，报个警告。' },
      { view: 'wire', frames: [3, 4], board: { focus: ['sse'], flows: [{ edge: 'sse', labels: ['第 3 帧', '第 4 帧'], every: 1.4 }] }, text: '第 3 帧，state n 写完，代码里多了 useState。第 4 帧开始写 Slider 标签，标签没写完，编译器先不画它，只报一个警告。' },
      { view: 'wire', frames: [5, 6, 7, 8, 9, 10], board: { focus: ['sse'], flows: [{ edge: 'sse', labels: ['5 · text', '6 · text', '7 · text', '8 · text', '9 · text', '10 · text'], every: 0.7 }] }, text: '第 5 到第 10 帧，滑块的属性一点点写进来。这几帧只有 text 的追加，代码没变，所以很小，跑得也快。' },
      { view: 'wire', frames: [11], board: { focus: ['sse'], flows: [{ edge: 'sse', label: '第 11 帧 · Slider', every: 2.2 }] }, text: '第 11 帧，标签终于写完了，代码里出现 Slider，浏览器这时才画出滑块。' },
      { view: 'wire', frames: [14], board: { focus: ['sse'], flows: [{ edge: 'sse', label: 'final · done', every: 2.2 }] }, link: { url: 'https://claude.ai/artifact/RebpJEhp3Ce46JSt7SD1hE', label: '配套动画：SSE 补丁回放' }, text: '最后第 14 帧是 final，带上 Markdown 降级版，和 done 等于 true。浏览器看到它，就知道这条回复完整了。' },
    ],
  },
  {
    title: '回顾与下集',
    station: null,
    beats: [
      {
        view: null,
        board: {
          diagram: 'local',
          all: true,
          flows: [
            { edge: 'post', label: '请求', every: 4, delay: 0 },
            { edge: 'hist', label: '提示词 + 历史', every: 4, delay: 0.8 },
            { edge: 'req', label: 'stream', every: 4, delay: 1.5 },
            { edge: 'tok', label: '碎片', every: 4, delay: 2.2 },
            { edge: 'yield', label: '碎片', every: 4, delay: 2.9 },
            { edge: 'batch', label: '批次', every: 4, delay: 3.4 },
            { edge: 'sse', label: 'SSE 帧', every: 4, delay: 3.9 },
          ],
        },
        text: '回顾一下这张图：ChatApp 发出对话；sseRoute 接住请求，边读边写；chatBody 清洗对话、拼上提示词；modelText 问 DeepSeek，吐出碎片；createSSEStream 边收边编译，把补丁变成 SSE 帧，流回浏览器。',
      },
      { view: null, board: { diagram: 'series', all: true, focus: ['ep1', 'ep2', 's12'], flows: [{ edge: 's12', label: '文字碎片', every: 2 }] }, link: { ep: 2, label: '第 2 集：流式编译器' }, text: '回到全系列的地图。下一集，我们打开右边这一块，流式编译器：它怎么每次重新编译，又怎么算出只发哪一点变化。' },
    ],
  },
];
