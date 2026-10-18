// Episode 5 script (v2 player): the sandbox. iframe, Worker, SES lockdown and Compartment, and the watchdog.
// Lines at commit aa34cf6.

export const meta = {
  ep: 5,
  title: 'Tessera 代码导读 第 5 集',
  eyebrow: 'TESSERA 代码导读 · 第 5 集 / 共 6 集',
  h1: '沙箱：iframe、Worker 和 SES',
  lede: '模型写的程序在哪里运行：左边读代码，右边把一层套一层的盒子画出来，看程序怎样被关在 iframe、Web Worker 和 SES 隔离舱里，只能通过一个端口说话，卡死了还有看门狗换新的。行号对应 tessera 仓库的提交 aa34cf6。',
  short: '第 5 集 · 沙箱',
  stationWord: '步',
  boardLabel: '一层套一层的沙箱',
  wireLabel: '',
  finish: '第 5 集看完了',
  next: '最后一集：画到屏幕上，组件、状态和 ui.send，地图绕成一个圈。',
};

export const files = {
  sandbox: { path: 'packages/react/src/sandbox.ts', from: 13, to: 99 },
  worker: { path: 'packages/runtime/src/worker.ts', from: 1, to: 22 },
  lockopts: { path: 'packages/runtime/src/lockdown-options.ts', from: 1, to: 16 },
  program: { path: 'packages/runtime/src/program.ts', from: 76, to: 110 },
  runtime: { path: 'packages/runtime/src/runtime.ts', from: 9, to: 174 },
  controller: { path: 'packages/react/src/controller.ts', from: 84, to: 252 },
};

export const stations = [{ name: '两层盒子' }, { name: '只给一个端口' }, { name: '冻结世界' }, { name: '隔离舱' }, { name: '画但不画' }, { name: '看门狗' }];

export const localDiagram = {
  w: 520,
  h: 600,
  zones: [
    { id: 'z-page', x: 8, y: 8, w: 504, h: 142, label: '宿主页面：你的应用' },
    { id: 'z-iframe', x: 8, y: 160, w: 504, h: 432, label: 'iframe：allow-scripts · 不透明源 · CSP 不许联网' },
    { id: 'z-worker', x: 22, y: 232, w: 476, h: 346, label: 'Web Worker：lockdown() 之后' },
    { id: 'z-comp', x: 180, y: 318, w: 160, h: 124, label: 'SES Compartment' },
  ],
  nodes: [
    { id: 'view', x: 24, y: 30, w: 140, h: 46, label: 'TesseraView', sub: '交来 program' },
    { id: 'ctrl', x: 180, y: 30, w: 160, h: 46, label: 'SandboxController', sub: '看门狗' },
    { id: 'recv', x: 356, y: 30, w: 148, h: 46, label: 'RemoteReceiver', sub: '收变更记录' },
    { id: 'net', x: 24, y: 92, w: 140, h: 46, label: '网络 · DOM · cookie', sub: '沙箱碰不到' },
    { id: 'host', x: 356, y: 92, w: 148, h: 46, label: '你的组件', sub: '第 6 集：画出来', ep: 6 },
    { id: 'boot', x: 180, y: 176, w: 160, h: 40, label: '启动脚本', sub: '从 Blob 启动 Worker' },
    { id: 'runtime', x: 180, y: 250, w: 160, h: 46, label: 'createRuntime', sub: 'mount · render · ping' },
    { id: 'lock', x: 36, y: 300, w: 130, h: 46, label: 'lockdown()', sub: '冻结内置对象' },
    { id: 'prog', x: 190, y: 344, w: 140, h: 42, label: 'TesseraProgram', sub: '模型写的代码' },
    { id: 'endow', x: 190, y: 394, w: 140, h: 40, label: 'h · ui · __C · __D', sub: '显式递进去' },
    { id: 'preact', x: 356, y: 344, w: 134, h: 44, label: 'Preact', sub: '算出组件树' },
    { id: 'remote', x: 356, y: 470, w: 134, h: 46, label: 'remote-dom 元素', sub: '不画，只记变更' },
  ],
  edges: [
    { id: 'rq', from: 'view', to: 'ctrl', label: 'program', ly: -12 },
    { id: 'hand', from: 'ctrl', to: 'boot', label: 'postMessage', lx: 44 },
    { id: 'start', from: 'boot', to: 'runtime', label: '端口', lx: 20 },
    { id: 'chan', from: 'ctrl', to: 'runtime', fs: 'r', ts: 'r', off: [8, 0], via: [[348, 61], [348, 273]] },
    { id: 'eval', from: 'runtime', to: 'prog', off: [50, 40], label: 'evaluate', lx: 32 },
    { id: 'gift', from: 'endow', to: 'prog' },
    { id: 'pr', from: 'prog', to: 'preact', label: '组件树', ly: -10 },
    { id: 'p2r', from: 'preact', to: 'remote', label: '元素', lx: 20 },
    { id: 'back', from: 'remote', to: 'recv', fs: 'r', ts: 'r', via: [[506, 493], [506, 53]], label: '变更记录', at: 0.5, lx: -30 },
    { id: 'show', from: 'recv', to: 'host', label: 'props 再校验', lx: 46 },
    { id: 'reach', from: 'prog', to: 'net', fs: 'l', ts: 'l', via: [[14, 365], [14, 115]], dashed: true },
  ],
};

const STOP = 'stop';

export const chapters = [
  {
    title: '开场：程序在哪里跑',
    station: null,
    beats: [
      { view: null, board: { diagram: 'series', all: true, focus: ['ep5', 's35'], flows: [{ edge: 's35', label: 'program', every: 2.2 }] }, text: '回到地图。程序已经编好、流到浏览器了。这一集是第五块：它在哪里运行，又是怎样被关起来的。' },
      { view: null, board: { diagram: 'local', add: ['z-page', 'view', 'ctrl', 'rq'], focus: ['view', 'ctrl'], flows: [{ edge: 'rq', label: 'program', every: 2.2 }] }, text: 'TesseraView 拿到 program，交给 SandboxController。真正运行它的地方在下面，是一层套一层的盒子。' },
      { view: null, board: { add: ['z-iframe', 'z-worker', 'z-comp', 'boot', 'runtime', 'prog'], focus: ['boot', 'runtime', 'prog'] }, text: '从外到里：一个看不见的 iframe，里面一个 Web Worker，Worker 里再用 SES 开一个隔离舱。分六步看：两层盒子、只给一个端口、冻结世界、隔离舱、画但不画、看门狗。' },
    ],
  },
  {
    title: '两层盒子',
    station: 0,
    beats: [
      { view: 'code', file: 'sandbox', lines: [72, 81], note: 'sandbox="allow-scripts"', board: { focus: ['z-iframe', 'boot'] }, text: '第一步在 sandbox.ts 的 iframeSandbox。72 到 81 行建一个隐藏的 iframe，73 行最关键：sandbox 等于 allow-scripts。它能跑脚本，但拿到的是一个不透明的源，读不到你页面的 cookie、存储和 DOM。' },
      { view: 'code', file: 'sandbox', lines: [13, 18], note: "default-src 'none'", board: { add: ['net', 'reach'], stop: ['reach'], focus: ['net'], flows: [{ edge: 'reach', label: '✕ fetch', tone: STOP, every: 2.6 }] }, text: "18 行是 iframe 自己的 CSP：default-src 'none'，什么都不许加载、不许联网；只放行内联的启动脚本、Blob 来的 Worker，和 SES 需要的 unsafe-eval。" },
      { view: 'code', file: 'sandbox', lines: [22, 31], board: { add: ['start'], focus: ['boot', 'start'], flows: [{ edge: 'start', label: 'new Worker', every: 2.4 }] }, text: '22 到 31 行是 iframe 里唯一的脚本：收到宿主发来的代码，用 Blob 造一个 URL，27 行启动 Worker。从 Blob 启动的 Worker 会继承这条 CSP，所以连运行时自己也发不出请求。' },
      { view: 'code', file: 'sandbox', lines: [[20, 21], [29, 29]], note: '两个写进注释的坑', board: { focus: ['boot'] }, text: '两个坑写在注释里：Worker 必须是经典脚本，不能是 ES 模块，不透明源下模块 Worker 过不了同源检查；29 行把 Worker 挂在 window 上，不然它可能被垃圾回收，跟着就停了。' },
    ],
  },
  {
    title: '只给一个端口',
    station: 1,
    beats: [
      { view: 'code', file: 'sandbox', lines: [35, 48], board: { add: ['chan'], focus: ['chan', 'ctrl', 'runtime'] }, text: '第二步，通信。35 行 openChannel 建一个 MessageChannel，也就是一对端口：port1 留在宿主，port2 交出去。之后宿主和 Worker 只通过这一对端口说话。' },
      { view: 'code', file: 'sandbox', lines: [89, 90], board: { add: ['hand'], focus: ['hand', 'boot', 'start'], flows: [{ edge: 'hand', label: '代码 + port2', every: 2.6 }, { edge: 'start', label: 'port2', every: 2.6, delay: 1.3 }] }, text: '90 行把 Worker 的代码和 port2 一起发给 iframe。iframe 是不透明源，目标只能写星号；但真正的通行证是那个端口，拿不到端口，什么都做不了。' },
      { view: 'code', file: 'worker', lines: [13, 22], board: { focus: ['runtime', 'chan'], flows: [{ edge: 'chan', label: 'mount · render', every: 2.4 }] }, text: 'Worker 这边在 worker.ts。15 到 21 行只认一种消息：类型是 tessera:port，还带着一个 MessagePort。收到第一个就把监听摘掉，19 行把运行时挂到这个端口上。之后再发什么，一概不理。' },
    ],
  },
  {
    title: '冻结世界',
    station: 2,
    beats: [
      { view: 'code', file: 'worker', lines: [3, 11], note: '先加载，再冻结', board: { add: ['lock'], focus: ['lock'] }, text: '第三步。worker.ts 3 行的注释说：顺序很重要。先加载 DOM polyfill 和所有库，11 行再调用 lockdown。' },
      {
        view: 'code',
        file: 'lockopts',
        lines: [1, 16],
        board: { focus: ['lock'], scene: { type: 'list', title: 'lockdown 做的事，和这几个参数的原因', items: [{ tag: '冻结', ok: true, text: '所有 JavaScript 内置对象和原型都冻住，谁也改不了 Array.prototype' }, { tag: 'severe', text: 'overrideTaming：Preact 用 for-in 复制对象，要允许覆盖原型上的属性' }, { tag: 'unsafe', text: 'errorTaming、consoleTaming：开发阶段保留可读的报错' }, { tag: 'unsafe', text: 'localeTaming：让 toLocaleString 正常格式化数字' }] } },
        text: 'lockdown 把所有 JavaScript 内置对象和原型都冻住，谁也改不了 Array.prototype 这类公共的东西。参数在 lockdown-options.ts，每一条后面都写着原因。',
      },
      { view: 'code', file: 'lockopts', lines: [11, 15], board: { focus: ['lock'] }, text: '其中 localeTaming 是试 DeepSeek 聊天页时才发现的：默认会把 toLocaleString 换成 toString，金额显示成一长串小数。它只影响格式化，不会让程序多碰到任何东西。' },
    ],
  },
  {
    title: '隔离舱',
    station: 3,
    beats: [
      { view: 'code', file: 'program', lines: [78, 80], board: { focus: ['z-comp', 'prog'] }, text: '第四步，program.ts。78 行 createCompartment，开一个 SES 隔离舱。' },
      { view: 'code', file: 'program', lines: [82, 91], board: { add: ['eval'], focus: ['eval', 'prog'], flows: [{ edge: 'eval', label: 'evaluate(code)', every: 2.4 }] }, text: '87 行用 compartment.evaluate 求值模型的代码。隔离舱的全局对象里只有冻结的内置对象：没有 fetch，没有定时器，没有 postMessage，也没有 DOM。' },
      { view: 'code', file: 'program', lines: [97, 106], note: '只给这几样', board: { add: ['endow', 'gift'], focus: ['endow', 'gift'], flows: [{ edge: 'gift', label: 'harden', every: 2 }] }, text: '能用的只有 103 行显式递进去的几样：h、Fragment、ui、常量表、safe 和数据表，每样都先用 harden 冻住。数据还先用 structuredClone 复制一份，程序改不了宿主的对象。' },
      {
        view: 'code',
        file: 'program',
        lines: [82, 86],
        board: {
          stop: ['reach'],
          focus: ['prog', 'net'],
          flows: [{ edge: 'reach', labels: ['✕ fetch', '✕ document', '✕ parent'], tone: STOP, every: 1.6 }],
          scene: { type: 'list', title: '模型的代码想做这些，都做不到', items: [{ tag: '✕', ok: false, text: 'fetch(…)：隔离舱里没有 fetch，CSP 也不许联网' }, { tag: '✕', ok: false, text: 'document.cookie：Worker 里没有你的页面' }, { tag: '✕', ok: false, text: 'parent.document：不透明源，跨不过去' }, { tag: '✕', ok: false, text: 'Array.prototype.x = …：lockdown 已经冻住了' }] },
        },
        link: { ep: 4, label: '第 4 集：守卫是第一道防线' },
        text: '这几层叠在一起，模型的代码就算想做坏事也做不到。仓库里有两组测试专门试这些：一组绕过编译器直接喂恶意程序，一组在真的 Chrome 里探测 iframe。',
      },
    ],
  },
  {
    title: '画但不画',
    station: 4,
    beats: [
      { view: 'code', file: 'runtime', lines: [9, 17], note: 'Nothing is drawn here', board: { add: ['preact', 'remote', 'pr', 'p2r'], focus: ['preact', 'remote'] }, text: '第五步，runtime.ts。9 行的注释说得很清楚：Preact 把程序渲染成 remote-dom 元素，remote-dom 再把这棵树作为变更记录镜像给宿主。这里什么都不画。' },
      { view: 'code', file: 'runtime', lines: [93, 126], board: { focus: ['prog', 'pr', 'preact'], flows: [{ edge: 'pr', label: 'h("Slider", …)', every: 2.4 }] }, text: '程序调用的 h 是这里给的。95 行按组件名查目录，查不到就报错；108 行把事件变成监听器，带出 event.detail；124 行把声明过的属性打包成一个 props 对象。' },
      { view: 'code', file: 'runtime', lines: [39, 48], note: '根组件永远不变', board: { focus: ['preact'] }, link: { ep: 4, label: '第 4 集：状态为什么按名字存' }, text: '40 行的 Host 是个永远不变的根组件，每次重画都调用当前的程序。所以流式时程序换了，Preact 只做比较，不会把整棵树拆掉重建，状态和滑块位置都留着。' },
      { view: 'code', file: 'runtime', lines: [150, 174], board: { focus: ['runtime', 'eval'] }, link: { ep: 3, label: '第 3 集：constants 批次' }, text: '150 行 render：代码没变，就复用已经求值过的程序，只换常量表，正好对应第三集里 constants 那种批次。求值或渲染失败，就保留上一个能用的画面。' },
      { view: 'code', file: 'runtime', lines: [128, 147], board: { add: ['back', 'recv', 'show', 'host'], focus: ['back', 'recv', 'p2r'], flows: [{ edge: 'p2r', label: '元素', every: 2.4 }, { edge: 'back', label: '变更记录', every: 2.4, delay: 1.2 }] }, link: { ep: 6, label: '第 6 集：怎么画出来' }, text: 'mount 在 128 行：给每个组件注册一个自定义元素，146 行把根元素接到宿主传来的连接上。从此 Worker 里的树一变，变更记录就沿着端口流回宿主的 RemoteReceiver。' },
    ],
  },
  {
    title: '看门狗',
    station: 5,
    beats: [
      { view: 'code', file: 'controller', lines: [84, 95], board: { focus: ['ctrl'] }, text: '第六步，看门狗，在 controller.ts。85 行起是几个默认值：渲染 2 秒没完成算卡死；每 2 秒 ping 一次，1.5 秒内要回；一分钟内重启超过 3 次就放弃。' },
      { view: 'code', file: 'controller', lines: [228, 236], note: '心跳', board: { focus: ['chan', 'ctrl', 'runtime'], flows: [{ edge: 'chan', label: 'ping', tone: 'pull', every: 2 }, { edge: 'chan', label: 'pong', reverse: true, every: 2, delay: 1 }] }, text: '228 行的 check 就是心跳：发一个 ping，等 pong。就算渲染没卡，事件回调里写了死循环，也会被心跳发现。' },
      { view: 'code', file: 'controller', lines: [208, 226], note: '卡死的程序进隔离名单', board: { stop: ['chan'], focus: ['ctrl'], flows: [{ edge: 'chan', label: 'render…（2 秒没回）', tone: STOP, every: 3 }] }, text: '208 行，渲染时也计时：超时的那段代码进隔离名单，223 行，以后不再渲染它，免得反复卡死。' },
      {
        view: 'code',
        file: 'controller',
        lines: [238, 252],
        board: { stop: ['runtime', 'prog'], focus: ['ctrl', 'boot'], flows: [{ edge: 'hand', label: '换一个新沙箱', every: 2.6 }, { edge: 'chan', label: '上一个好程序 + 状态', every: 2.6, delay: 1.3 }] },
        text: '238 行 restart：杀掉旧沙箱，启动一个新的，再用上一个能正常渲染的程序和状态重画。换好之前，屏幕上一直是最后一帧好的画面。',
      },
      { view: 'code', file: 'controller', lines: [[129, 133], [150, 164]], board: { focus: ['ctrl', 'rq'], flows: [{ edge: 'rq', labels: ['v1', 'v2', 'v3'], every: 0.6 }, { edge: 'chan', label: '只画 v3', every: 2.4, delay: 1 }] }, text: '还有一点：130 行 render 只记下最新的 program，沙箱忙的时候来了好几个，150 行只渲染最新的那个。流式时程序一秒变好几次，这能省掉很多无用功。' },
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
          stop: ['reach'],
          flows: [
            { edge: 'rq', label: 'program', every: 5, delay: 0 },
            { edge: 'chan', label: 'render', every: 5, delay: 0.7 },
            { edge: 'eval', label: 'evaluate', every: 5, delay: 1.4 },
            { edge: 'pr', label: '组件树', every: 5, delay: 2.1 },
            { edge: 'p2r', label: '元素', every: 5, delay: 2.8 },
            { edge: 'back', label: '变更记录', every: 5, delay: 3.4 },
            { edge: 'show', label: 'props', every: 5, delay: 4.2 },
          ],
        },
        text: '回顾这几层盒子：iframe 给一个不透明源和不许联网的 CSP；Worker 只认一个端口；lockdown 冻住内置对象；隔离舱里只有递进去的几样东西；Preact 在里面算树，remote-dom 把变化流回宿主；看门狗负责卡死时换新的。',
      },
      { view: null, board: { diagram: 'series', all: true, focus: ['ep6', 'ep5', 's56', 's61'], flows: [{ edge: 's56', label: '组件树', every: 2.2 }] }, link: { ep: 6, label: '第 6 集：画到屏幕上' }, text: '回到地图，只剩最后一块。下一集看这些变更记录怎样变成你屏幕上的组件，你拖一下滑块，又怎样传回沙箱。' },
    ],
  },
];
