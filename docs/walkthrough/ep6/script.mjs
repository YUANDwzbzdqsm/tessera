// Episode 6 script (v2 player): drawing on screen, events back into the sandbox, state, and ui.send closing the loop.
// Lines at commit aa34cf6.

export const meta = {
  ep: 6,
  title: 'Tessera 代码导读 第 6 集',
  eyebrow: 'TESSERA 代码导读 · 第 6 集 / 共 6 集',
  h1: '画到屏幕上：组件、状态和 ui.send',
  lede: '最后一块：左边读代码，右边把一个圈画出来，看沙箱发来的变更记录怎样变成你屏幕上的组件，你拖一下滑块又怎样传回沙箱、改状态、重画，按钮里的 ui.send 又怎样绕回第一集。行号对应 tessera 仓库的提交 aa34cf6。',
  short: '第 6 集 · 画到屏幕上',
  stationWord: '步',
  boardLabel: '一次拖动绕一圈',
  wireLabel: '',
  finish: '六集看完了',
  next: '地图绕成了一个圈。回头看任何一集，都可以从系列安排里点进去。',
};

export const files = {
  tree: { path: 'packages/react/src/RemoteTree.tsx', from: 27, to: 101 },
  comps: { path: 'demo/src/components.tsx', from: 36, to: 69 },
  runtime: { path: 'packages/runtime/src/runtime.ts', from: 50, to: 126 },
  program: { path: 'packages/runtime/src/program.ts', from: 41, to: 73 },
  chatapp: { path: 'demo/src/chat/ChatApp.tsx', from: 117, to: 124 },
};

export const stations = [{ name: '收变更' }, { name: '再校验' }, { name: '你的组件' }, { name: '事件回到沙箱' }, { name: '状态和重画' }, { name: 'ui.send 绕回来' }];

export const localDiagram = {
  w: 520,
  h: 600,
  zones: [
    { id: 'z-sandbox', x: 8, y: 8, w: 504, h: 170, label: '沙箱里（第 5 集）' },
    { id: 'z-host', x: 8, y: 194, w: 504, h: 264, label: '宿主页面：@tessera/react 和你的组件' },
    { id: 'z-app', x: 8, y: 474, w: 504, h: 118, label: '聊天页：ChatApp' },
  ],
  nodes: [
    { id: 'store', x: 24, y: 36, w: 150, h: 46, label: 'store', sub: '状态按名字存' },
    { id: 'prog', x: 186, y: 36, w: 150, h: 46, label: 'TesseraProgram', sub: '重新运行' },
    { id: 'remote', x: 348, y: 36, w: 150, h: 46, label: 'Preact → remote-dom', sub: '比较，只记变化' },
    { id: 'handler', x: 24, y: 118, w: 150, h: 46, label: 'onChange 处理', sub: 'setSeats(v)' },
    { id: 'api', x: 186, y: 118, w: 150, h: 46, label: 'ui.send', sub: '只是发个动作' },
    { id: 'recv', x: 348, y: 220, w: 150, h: 46, label: 'RemoteReceiver', sub: '收变更记录' },
    { id: 'tree', x: 348, y: 300, w: 150, h: 46, label: 'RemoteElement', sub: '每个节点各自订阅' },
    { id: 'check', x: 186, y: 300, w: 150, h: 46, label: 'checkProp', sub: '按目录再校验' },
    { id: 'listener', x: 24, y: 300, w: 150, h: 46, label: 'listener', sub: '跨回沙箱的函数' },
    { id: 'user', x: 24, y: 388, w: 150, h: 46, label: '你拖动滑块', sub: '值变成 12' },
    { id: 'comp', x: 186, y: 388, w: 150, h: 46, label: '你的 Slider', sub: '本地先动，再等回音' },
    { id: 'save', x: 24, y: 508, w: 210, h: 50, label: 'saveState', sub: '存进浏览器，刷新还在' },
    { id: 'send', x: 288, y: 508, w: 210, h: 50, label: 'send(text)', sub: '第 1 集：又一条消息', ep: 1 },
  ],
  edges: [
    { id: 'mut', from: 'remote', to: 'recv', label: '变更记录', lx: 34 },
    { id: 'sub', from: 'recv', to: 'tree', label: '订阅', lx: 20 },
    { id: 'props', from: 'tree', to: 'check', label: 'props', ly: -10 },
    { id: 'ok', from: 'check', to: 'comp', label: '合格的 props', lx: 44 },
    { id: 'drag', from: 'user', to: 'comp', off: [0, 0], label: '拖', ly: -10 },
    { id: 'fire', from: 'comp', to: 'listener', fs: 't', ts: 'b', off: [-50, 30], label: 'onChange(12)', at: 0.55, lx: 6 },
    { id: 'cross', from: 'listener', to: 'handler', label: '跨回沙箱', lx: 34 },
    { id: 'set', from: 'handler', to: 'store', label: 'seats = 12', lx: 38 },
    { id: 'rerun', from: 'store', to: 'prog', label: '重画', ly: -10 },
    { id: 'tree2', from: 'prog', to: 'remote', label: '新树', ly: -10 },
    { id: 'snap', from: 'store', to: 'save', fs: 'l', ts: 'l', via: [[14, 59], [14, 533]], label: 'state 快照', at: 0.5, lx: 30 },
    { id: 'click', from: 'prog', to: 'api', label: '点按钮', lx: 28 },
    { id: 'act', from: 'api', to: 'send', fs: 'r', ts: 't', via: [[342, 141], [342, 482], [393, 482]], at: 0.5 },
  ],
};

export const chapters = [
  {
    title: '开场：最后一块',
    station: null,
    beats: [
      { view: null, board: { diagram: 'series', all: true, focus: ['ep6', 's56', 's61'], flows: [{ edge: 's56', label: '组件树', every: 2.2 }, { edge: 's61', label: 'ui.send', every: 2.2, delay: 1.1 }] }, text: '回到地图，最后一块：沙箱算出的组件树，怎样变成你屏幕上的东西；你拖一下滑块，又怎样传回去。走完这一块，地图就绕成了一个圈。' },
      { view: null, board: { diagram: 'local', add: ['z-sandbox', 'z-host', 'z-app', 'remote', 'recv', 'mut'], focus: ['remote', 'recv', 'mut'], flows: [{ edge: 'mut', label: '变更记录', every: 2.2 }] }, text: '上面是上一集的沙箱，中间是宿主页面，下面是聊天页。上一集讲到变更记录沿着端口流出沙箱，今天从这里接着画，画出来的是一个圈：变更流下来，事件流回去。' },
      { view: null, board: { focus: ['z-host'] }, text: '分六步：收变更、再校验、你的组件、事件回到沙箱、状态和重画、ui.send 绕回第一集。' },
    ],
  },
  {
    title: '收变更',
    station: 0,
    beats: [
      { view: 'code', file: 'tree', lines: [27, 40], board: { add: ['tree', 'sub'], focus: ['recv', 'sub', 'tree'], flows: [{ edge: 'sub', label: '这个节点变了', every: 2.2 }] }, text: '宿主用 RemoteReceiver 接住变更记录。RemoteTree.tsx 28 行的 useRemoteNode：每个节点各自订阅自己的变化，32 行订阅，38 行用 useSyncExternalStore 接到 React 上。' },
      { view: 'code', file: 'tree', lines: [42, 53], board: { focus: ['tree'] }, link: { ep: 3, label: '第 3 集：program 没换就不重画' }, text: '42 行 RemoteChildren 遍历子节点：文字节点直接显示，元素节点交给 RemoteElement。哪个节点变了，就只有它重画，比如流式时标题变长，只动那一段文字。' },
    ],
  },
  {
    title: '再校验',
    station: 1,
    beats: [
      { view: 'code', file: 'tree', lines: [59, 66], board: { add: ['check', 'props'], focus: ['tree', 'props', 'check'] }, text: 'RemoteElement 在 59 行。61 行按自定义元素的标签名，在目录里查出是哪个组件；查不到，就报 unknown_element。' },
      {
        view: 'code',
        file: 'tree',
        lines: [68, 76],
        note: '沙箱不可信',
        board: {
          focus: ['check'],
          flows: [{ edge: 'props', label: '{ value: 8 }', every: 2.4 }],
          scene: { type: 'list', title: '同一个目录，在宿主这边再查一遍（真实结果）', items: [{ tag: 'value: 8', ok: true, text: '目录里有，类型也对：交给组件' }, { tag: 'fill: "red"', ok: false, text: 'unknown_prop：Slider 没有这个属性，丢掉并报告' }, { tag: 'value: "八"', ok: false, text: 'invalid_value：要的是数字，丢掉并报告' }] },
        },
        link: { ep: 4, label: '第 4 集：编译器那一遍检查' },
        text: '68 到 76 行，把 props 按目录一个一个再校验一遍。编译器已经检查过了，为什么还要查？因为 Worker 不可信：万一沙箱里的代码被绕过，宿主也只接受目录允许的值。',
      },
    ],
  },
  {
    title: '你的组件',
    station: 2,
    beats: [
      { view: 'code', file: 'tree', lines: [83, 90], board: { add: ['comp', 'ok'], focus: ['ok', 'comp'], flows: [{ edge: 'ok', label: 'min · max · value', every: 2.4 }] }, text: '83 到 90 行：用目录里的名字，在你传进来的 components 里找到自己的组件，把校验过的 props 交给它。画成什么样，完全由你的组件决定。' },
      { view: 'code', file: 'comps', lines: [36, 50], note: '先留一份本地的值', board: { focus: ['comp'] }, text: '看演示里的 Slider，在 components.tsx。47 行先存一份本地的值，48 到 50 行，沙箱传来新值时再同步。因为拖动的值要先过一趟沙箱再回来，中间有一小段延迟，不留本地副本，滑块会被拉回去。' },
      { view: 'code', file: 'comps', lines: [54, 66], board: { add: ['user', 'drag'], focus: ['user', 'drag', 'comp'], flows: [{ edge: 'drag', label: '12', every: 2 }] }, text: '60 到 64 行：你拖动的时候，先改本地的值，滑块马上就动；再调用 onChange。这个 onChange，就是沙箱里那个处理函数的替身。' },
    ],
  },
  {
    title: '事件回到沙箱',
    station: 3,
    beats: [
      { view: 'code', file: 'tree', lines: [77, 82], board: { add: ['listener', 'fire'], focus: ['fire', 'listener'], flows: [{ edge: 'fire', label: 'onChange(12)', every: 2.4 }] }, text: '回到 RemoteTree 的 77 到 82 行：目录里声明的每个事件，都去元素上找沙箱注册的监听器，包成一个函数交给你的组件。调用它，就是跨过那个端口，回到沙箱。' },
      { view: 'code', file: 'tree', lines: [79, 81], board: { focus: ['listener'] }, link: { ep: 5, label: '第 5 集：看门狗换沙箱' }, text: '81 行还处理了一个细节：要是看门狗刚好把卡住的沙箱换掉，这次调用会失败。没什么可恢复的，所以直接吞掉，不让它变成没人处理的错误。' },
      { view: 'code', file: 'runtime', lines: [108, 118], board: { add: ['handler', 'cross'], focus: ['cross', 'handler'], flows: [{ edge: 'cross', label: 'event.detail = 12', every: 2.4 }] }, text: '到了沙箱这边，runtime.ts 108 行：每个事件都挂了一个监听器，113 行取出 event.detail，也就是 12，交给模型写的处理函数，比如 setSeats。出错的话，只报一次 handler_error。' },
    ],
  },
  {
    title: '状态和重画',
    station: 4,
    beats: [
      { view: 'code', file: 'program', lines: [56, 69], note: '按名字存，在程序外面', board: { add: ['store', 'set'], focus: ['set', 'store'], flows: [{ edge: 'set', label: 'seats = 12', every: 2.2 }] }, link: { ep: 4, label: '第 4 集：useState 按名字生成' }, text: 'setSeats 在 program.ts 的 useState 里。状态存在程序外面的 store，用名字当键，64 行写进去，65 行通知要重画。所以程序重新编译换掉了，seats 还是 12。' },
      { view: 'code', file: 'runtime', lines: [77, 84], board: { add: ['prog', 'rerun'], focus: ['rerun', 'prog'], flows: [{ edge: 'rerun', label: '微任务里画一次', every: 2.2 }] }, text: '77 行的 schedule 把重画放进一个微任务：同一时刻改了好几个状态，也只画一次。' },
      { view: 'code', file: 'runtime', lines: [61, 76], board: { add: ['save', 'snap'], focus: ['snap', 'save'], flows: [{ edge: 'snap', label: '{ seats: 12 }', every: 2.6 }] }, text: '画完以后，61 行 reportState 把能转成 JSON 的状态快照发给宿主，只在变了的时候发。聊天页收到后存进浏览器，所以刷新页面，滑块还停在 12。' },
      {
        view: 'code',
        file: 'runtime',
        lines: [50, 59],
        board: {
          add: ['tree2'],
          focus: ['tree2', 'mut', 'sub', 'props', 'ok'],
          flows: [
            { edge: 'tree2', label: '新树', every: 4, delay: 0 },
            { edge: 'mut', label: 'value: 12', every: 4, delay: 0.8 },
            { edge: 'sub', label: '只这个节点', every: 4, delay: 1.6 },
            { edge: 'ok', label: 'value: 12', every: 4, delay: 2.4 },
          ],
        },
        text: '然后就回到这一集的开头：50 行 paint，Preact 比较新旧两棵树，remote-dom 只发变了的那一点，宿主只重画那个节点。一次拖动绕了一圈，模型一次都没被调用。',
      },
    ],
  },
  {
    title: 'ui.send 绕回来',
    station: 5,
    beats: [
      { view: 'code', file: 'program', lines: [51, 55], note: '沙箱自己发不出去', board: { add: ['api', 'click'], focus: ['click', 'api'], flows: [{ edge: 'click', label: 'ui.send("…")', every: 2.4 }] }, text: '最后是按钮。程序里的 ui.send，在 program.ts 51 到 55 行，只是发出一个动作：类型是 send，带着文字。沙箱自己什么都发不出去。' },
      { view: 'code', file: 'chatapp', lines: [117, 121], note: '决定权在宿主', board: { add: ['send', 'act'], focus: ['act', 'send'], flows: [{ edge: 'act', label: '{ type: "send" }', every: 2.6 }] }, link: { ep: 1, label: '第 1 集：send() 从这里出门' }, text: '这个动作经过 TesseraView 的 onAction，到了聊天页 117 行：send 类型，就调用 send，发一条新消息；copy 是复制；open 只放行 https 链接。发不发，始终是宿主说了算。' },
      { view: null, board: { diagram: 'series', all: true, focus: ['ep1', 'ep2', 'ep3', 'ep4', 'ep5', 'ep6'], flows: [{ edge: 's12', label: '碎片', every: 6, delay: 0 }, { edge: 's24', label: '整段', every: 6, delay: 1 }, { edge: 's42', label: '程序', every: 6, delay: 1.6 }, { edge: 's23', label: 'SSE 帧', every: 6, delay: 2.2 }, { edge: 's35', label: 'program', every: 6, delay: 3.2 }, { edge: 's56', label: '组件树', every: 6, delay: 4 }, { edge: 's61', label: 'ui.send', every: 6, delay: 4.8 }] }, text: '这个 send，就是第一集开头那个函数。于是地图绕成了一个圈：发消息、编译、流回来、进沙箱、画出来，再从按钮回到发消息。' },
    ],
  },
  {
    title: '回顾：一个圈',
    station: null,
    beats: [
      {
        view: null,
        board: {
          diagram: 'local',
          all: true,
          flows: [
            { edge: 'mut', label: '变更', every: 5.5, delay: 0 },
            { edge: 'sub', label: '订阅', every: 5.5, delay: 0.6 },
            { edge: 'props', label: '校验', every: 5.5, delay: 1.1 },
            { edge: 'ok', label: 'props', every: 5.5, delay: 1.6 },
            { edge: 'drag', label: '拖', every: 5.5, delay: 2.1 },
            { edge: 'fire', label: '12', every: 5.5, delay: 2.6 },
            { edge: 'cross', label: '跨回去', every: 5.5, delay: 3.2 },
            { edge: 'set', label: 'seats', every: 5.5, delay: 3.8 },
            { edge: 'rerun', label: '重画', every: 5.5, delay: 4.3 },
            { edge: 'tree2', label: '新树', every: 5.5, delay: 4.8 },
          ],
        },
        text: '回顾这一圈：变更记录进来，每个节点各自订阅，props 按目录再校验，你的组件负责画；你一拖，事件跨回沙箱，状态按名字存好，微任务里重画一次，只把变了的那点发回来。按钮的 ui.send 只是一个请求，发不发由宿主决定。',
      },
      { view: null, board: { diagram: 'series', all: true }, link: { ep: 1, label: '从第 1 集再看一遍' }, text: '六集到这里就讲完了。下次读这个项目的代码时，可以先在这张地图上找到它属于哪一块，再去对应的那一集，从同一个文件、同一行开始看。' },
    ],
  },
];
