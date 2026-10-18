// Episode 3 script (v2 player): the browser side. Bytes in, messages out, patches applied, React told. Lines at aa34cf6.

export const meta = {
  ep: 3,
  title: 'Tessera 代码导读 第 3 集',
  eyebrow: 'TESSERA 代码导读 · 第 3 集 / 共 6 集',
  h1: '浏览器收流：解析 SSE，拼回文档',
  lede: '换到浏览器这边：左边读代码，右边把这一路画出来，看网络送来的字节怎样切成消息、读出补丁、检查序号、拼回文档，最后只在需要的时候让界面重画。行号对应 tessera 仓库的提交 aa34cf6。',
  short: '第 3 集 · 浏览器收流',
  stationWord: '步',
  boardLabel: '浏览器这一路',
  wireLabel: 'POST /api/stream',
  finish: '第 3 集看完了',
  next: '下一集：编译器内部，一段 Tessera 标记怎样变成 JavaScript。',
};

export const files = {
  sse: { path: 'packages/stream/src/sse.ts', from: 10, to: 79 },
  patch: { path: 'packages/stream/src/patch.ts', from: 1, to: 46 },
  hook: { path: 'packages/react/src/useTesseraStream.ts', from: 37, to: 80 },
  chatapp: { path: 'demo/src/chat/ChatApp.tsx', from: 66, to: 73 },
  view: { path: 'packages/react/src/TesseraView.tsx', from: 50, to: 58 },
};

export const stations = [{ name: '收字节' }, { name: '切消息' }, { name: '读字段' }, { name: '查序号' }, { name: '拼文档' }, { name: '交给 React' }];

export const localDiagram = {
  w: 520,
  h: 600,
  zones: [
    { id: 'z-out', x: 8, y: 8, w: 504, h: 78, label: '两头：服务端和沙箱' },
    { id: 'z-browser', x: 8, y: 100, w: 504, h: 492, label: '浏览器：readTesseraStream 和 React' },
  ],
  nodes: [
    { id: 'server', x: 24, y: 28, w: 200, h: 48, label: 'sseRoute', sub: '第 1 集：写出 SSE', ep: 1 },
    { id: 'sandbox', x: 296, y: 28, w: 200, h: 48, label: '沙箱', sub: '第 5 集：iframe + Worker', ep: 5 },
    { id: 'reader', x: 24, y: 126, w: 170, h: 48, label: 'reader.read()', sub: '一块一块读字节' },
    { id: 'decoder', x: 24, y: 216, w: 170, h: 48, label: 'TextDecoder', sub: 'stream: true' },
    { id: 'parser', x: 24, y: 306, w: 170, h: 48, label: 'SSEParser', sub: 'buffer · 按空行切' },
    { id: 'block', x: 24, y: 396, w: 170, h: 48, label: 'parseBlock', sub: 'event 和 data' },
    { id: 'seq', x: 24, y: 486, w: 170, h: 48, label: 'seq 检查', sub: '丢帧、乱序就停' },
    { id: 'apply', x: 326, y: 486, w: 170, h: 48, label: 'applyOps', sub: '只复制路过的' },
    { id: 'doc', x: 326, y: 396, w: 170, h: 48, label: 'doc', sub: 'text · code · constants' },
    { id: 'hook', x: 326, y: 306, w: 170, h: 48, label: 'useTesseraStream', sub: 'setState' },
    { id: 'memo', x: 326, y: 216, w: 170, h: 48, label: 'useMemo', sub: '组成 program' },
    { id: 'view', x: 326, y: 126, w: 170, h: 48, label: 'TesseraView', sub: 'program 换了才画' },
  ],
  edges: [
    { id: 'bytes', from: 'server', to: 'reader', label: '字节', lx: 22 },
    { id: 'dec', from: 'reader', to: 'decoder', label: 'Uint8Array', lx: 38 },
    { id: 'txt', from: 'decoder', to: 'parser', label: '文字', lx: 20 },
    { id: 'msg', from: 'parser', to: 'block', label: '一条消息', lx: 32 },
    { id: 'bat', from: 'block', to: 'seq', label: '补丁批次', lx: 32 },
    { id: 'ok', from: 'seq', to: 'apply', label: '序号对上', ly: -12 },
    { id: 'nd', from: 'apply', to: 'doc', label: '新 doc', lx: 26 },
    { id: 'st', from: 'doc', to: 'hook', label: 'setState', lx: 32 },
    { id: 'mm', from: 'hook', to: 'memo', label: 'doc', lx: 18 },
    { id: 'pg', from: 'memo', to: 'view', label: 'program', lx: 30 },
    { id: 'rd', from: 'view', to: 'sandbox', label: 'render', lx: 26 },
    { id: 'cancel', from: 'hook', to: 'reader', fs: 'l', ts: 'r', dashed: true, label: 'abort', at: 0.5 },
  ],
};

export const chapters = [
  {
    title: '开场：换到浏览器',
    station: null,
    beats: [
      { view: null, board: { diagram: 'series', all: true, focus: ['ep3', 's23'], flows: [{ edge: 's23', label: 'SSE 帧', every: 2.2 }] }, text: '回到全系列的地图。前两集都在服务端，SSE 帧沿着右边这条线流到浏览器。这一集是地图上的第三块：浏览器怎么接住它们。' },
      { view: null, board: { diagram: 'local', add: ['z-out', 'z-browser', 'server', 'sandbox'], focus: ['server', 'sandbox'] }, text: '两头是上一集和下一站：上面左边是写出 SSE 的服务端，右边是要把界面画出来的沙箱。中间这一大块，就是今天要画满的浏览器这一路。' },
      { view: null, board: { focus: ['z-browser'] }, text: '还是六步：收字节、切消息、读字段、查序号、拼文档、交给 React。代码在 stream 包的 sse.ts 和 patch.ts，以及 react 包的 useTesseraStream。' },
    ],
  },
  {
    title: '收字节',
    station: 0,
    beats: [
      { view: 'code', file: 'sse', lines: [53, 54], board: { add: ['reader', 'bytes'], focus: ['reader', 'bytes'], flows: [{ edge: 'bytes', label: 'Response', every: 2.4 }] }, text: '入口是 53 行的 readTesseraStream，它拿到 fetch 返回的 Response。54 行先看状态码，请求失败就直接报错。' },
      { view: 'code', file: 'sse', lines: [55, 58], board: { add: ['decoder', 'parser', 'doc'], focus: ['reader', 'decoder', 'parser', 'doc'] }, text: '55 到 58 行准备四样东西，右边都画上了：reader 读字节，TextDecoder 把字节变成文字，SSEParser 切消息，还有一份空文档 doc，等着往上拼。' },
      { view: 'code', file: 'sse', lines: [63, 66], board: { add: ['dec', 'txt'], focus: ['dec', 'txt'], flows: [{ edge: 'bytes', label: '字节块', every: 1.6 }, { edge: 'dec', label: 'Uint8Array', every: 1.6, delay: 0.8 }, { edge: 'txt', label: '文字', every: 1.6, delay: 1.6 }] }, text: '63 行开始循环：reader.read 每次给一块字节，直到 done。66 行把字节解码成文字，交给 parser。' },
      {
        view: 'code',
        file: 'sse',
        lines: [66, 66],
        note: 'stream: true：被切开的汉字先留着',
        board: {
          focus: ['decoder'],
          scene: { type: 'list', title: '你 在 UTF-8 里是三个字节：E4 BD A0', items: [{ tag: '第 1 块', text: '……最后两个字节是 E4 BD，只是“你”的前三分之二' }, { tag: '留着', ok: true, text: 'stream: true：不完整的字先不输出，留在解码器里' }, { tag: '第 2 块', text: '开头是 A0' }, { tag: '拼起来', ok: true, text: 'E4 BD A0 = 你，完整输出' }] },
        },
        text: '注意 decode 的 stream: true。一个汉字在 UTF-8 里占三个字节，网络可能正好把它切在两块中间。stream: true 会把半个字先留着，等下一块来了再拼完整，就像下面这样。',
      },
    ],
  },
  {
    title: '切消息',
    station: 1,
    beats: [
      { view: 'code', file: 'sse', lines: [14, 15], board: { focus: ['parser', 'txt'] }, text: '第二步，切消息。SSEParser 只有一个 buffer。15 行把新文字接到 buffer 后面，顺便把 Windows 风格的换行统一成一个换行。' },
      { view: 'code', file: 'sse', lines: [18, 23], board: { add: ['block', 'msg'], focus: ['parser', 'msg'], flows: [{ edge: 'msg', label: '一条消息', every: 2 }] }, text: '18 行找空行，也就是连续两个换行。找到一个，就切出前面那段交给 parseBlock；剩下的留在 buffer 里，接着找。' },
      { view: 'buffer', step: 0, board: { focus: ['parser'], flows: [{ edge: 'txt', label: '第 1 块', every: 2.6 }, { edge: 'msg', label: '第 0 帧', every: 2.6, delay: 1.3 }] }, text: '为什么要 buffer？因为网络不按消息来切。比如第一块字节里，是一整条第 0 帧，加上第 1 帧的前半截。parser 切出第 0 帧，后半截先留在 buffer 里。' },
      { view: 'buffer', step: 1, board: { focus: ['parser'], flows: [{ edge: 'txt', label: '第 2 块', every: 2.6 }, { edge: 'msg', labels: ['第 1 帧', '第 2 帧'], every: 0.9, delay: 1.3 }] }, text: '下一块来了，补上第 1 帧的后半截，还顺带一整条第 2 帧。这一次 push，一下切出两条消息，buffer 清空。' },
    ],
  },
  {
    title: '读字段',
    station: 2,
    beats: [
      { view: 'code', file: 'sse', lines: [31, 35], board: { focus: ['block'] }, text: '第三步，parseBlock 读一条消息里的字段。31 行逐行看：冒号开头的是注释，跳过；其余按第一个冒号，分成字段名和值。' },
      { view: 'code', file: 'sse', lines: [36, 37], board: { focus: ['block'] }, text: '只关心两个字段：event 是事件类型，data 是内容。data 可以有好几行，37 行先收集起来。' },
      { view: 'code', file: 'sse', lines: [39, 43], board: { add: ['seq', 'bat'], focus: ['block', 'bat'], flows: [{ edge: 'bat', label: '{ seq, kind, ops }', every: 2.2 }] }, text: '40 行把 data 拼起来，解析成 JSON。41 行：类型是 patch，就是补丁批次；42 行：是 error，就是错误；别的类型一律不管。' },
    ],
  },
  {
    title: '查序号',
    station: 3,
    beats: [
      { view: 'code', file: 'sse', lines: [67, 67], board: { stop: ['bat'], focus: ['seq'], flows: [{ edge: 'bat', label: 'event: error', tone: 'stop', every: 2.4 }] }, text: '第四步。67 行：收到 error 事件，直接抛出，useTesseraStream 会把它显示成错误。' },
      {
        view: 'code',
        file: 'sse',
        lines: [68, 69],
        note: '序号对不上就停',
        board: { focus: ['seq'], scene: { type: 'list', title: 'expected 从 0 开始，每收一帧加一', items: [{ tag: '0 = 0', ok: true, text: '期望第 0 帧，来的是第 0 帧：拼上' }, { tag: '1 = 1', ok: true, text: '期望第 1 帧，来的是第 1 帧：拼上' }, { tag: '2 ≠ 3', ok: false, text: '期望第 2 帧，来的却是第 3 帧：中间丢了，停下报错' }] } },
        text: '68 行检查序号：期望几号，来的就必须是几号。中间丢了一帧或者顺序乱了，后面的补丁都会拼错，所以宁可停下报错。',
      },
      { view: 'code', file: 'sse', lines: [[60, 61], [77, 77]], board: { add: ['hook', 'cancel'], stop: ['reader', 'cancel'], flows: [{ edge: 'cancel', label: '✕ 停止', tone: 'stop', every: 2.6 }] }, text: '60、61 行处理停止：用户点停止，就取消 reader，循环自然结束。77 行再确认一次，被取消的流抛出 AbortError，不会假装正常结束。' },
    ],
  },
  {
    title: '拼文档',
    station: 4,
    beats: [
      { view: 'code', file: 'sse', lines: [70, 71], board: { add: ['apply', 'ok', 'nd'], focus: ['apply', 'ok', 'nd', 'doc'], flows: [{ edge: 'ok', label: '批次', every: 2.2 }, { edge: 'nd', label: '新 doc', every: 2.2, delay: 1.1 }] }, link: { ep: 2, label: '第 2 集：服务端 emit 用的也是它' }, text: '第五步，70 行：用 applyOps 把这一帧的补丁拼到文档上，71 行通知外面。服务端第二集的 emit 用的是同一个 applyOps，所以两边拼出来的完全一样。' },
      { view: 'code', file: 'patch', lines: [10, 13], board: { focus: ['apply'] }, text: 'applyOps 在 patch.ts。11 行把路径按斜杠切开，比如 /constants/0 变成 constants 和 0，再交给 setIn 一层一层往下走。' },
      { view: 'code', file: 'patch', lines: [[19, 19], [32, 32]], note: '只复制路过的那一条', board: { focus: ['apply'], scene: { type: 'share', frame: 4, title: '第 4 帧：只 append 了 text', before: 'doc（第 3 帧后）', after: 'doc（第 4 帧后）' } }, text: 'setIn 有个关键规则：从不直接改原来的对象。路过哪一层就复制哪一层，19 行复制数组，32 行复制对象。看下面：新 doc 只有 text 是新的，其余字段都指回原来那几个对象。' },
      { view: 'code', file: 'patch', lines: [35, 46], board: { focus: ['apply'] }, text: '到了终点，leaf 执行真正的操作：append 是接字符串，splice 是删一段再插一段，replace 和 add 直接换成新值。42 行还会检查 splice 的范围，越界就报错。' },
      { view: 'doc', frame: 4, board: { focus: ['doc'] }, text: '这个规则有什么用？看第 4 帧，它只 append 了 text。拼完后 doc 是新对象，text 也是新的，但 code、constants、data 还是原来那几个对象，一个都没换。' },
    ],
  },
  {
    title: '交给 React',
    station: 5,
    beats: [
      { view: 'code', file: 'hook', lines: [48, 63], board: { add: ['st'], focus: ['hook', 'st'], flows: [{ edge: 'st', label: 'setState(doc)', every: 2.2 }] }, text: '第六步，交给界面。useTesseraStream 是个 React hook。48 行开始时把状态设成 streaming；50 到 63 行，每拼好一帧，就用 setState 换上新文档，顺便记下统计。' },
      { view: 'code', file: 'hook', lines: [66, 71], board: { focus: ['hook'] }, text: '66 行就是刚才的 readTesseraStream。正常结束，状态变成 done；被取消是 stopped；其他异常是 error。' },
      { view: 'code', file: 'chatapp', lines: [70, 73], note: '依赖是这三个对象本身', board: { add: ['memo', 'mm'], focus: ['memo', 'mm'], flows: [{ edge: 'mm', label: 'code · constants · data', every: 2.4 }] }, text: '聊天页在 70 到 73 行，用 useMemo 从文档里取出 code、constants、data，组成 program。依赖就是这三个对象本身。' },
      { view: 'code', file: 'view', lines: [55, 58], board: { add: ['view', 'pg', 'rd'], focus: ['memo', 'view'], flows: [{ edge: 'mm', label: '第 4 帧', every: 2.4 }, { edge: 'pg', label: '同一个 program', tone: 'pull', every: 2.4, delay: 1.2 }] }, text: 'TesseraView 在 57 行：program 换了，才让沙箱重画。所以第 4 帧这种只有 text 的批次，三个对象都没换，program 还是同一个，沙箱什么都不用做。' },
      { view: 'doc', frame: 2, board: { focus: ['memo', 'view', 'rd'], flows: [{ edge: 'mm', label: '第 2 帧', every: 2.4 }, { edge: 'pg', label: '新 program', every: 2.4, delay: 0.8 }, { edge: 'rd', label: 'render', every: 2.4, delay: 1.6 }] }, link: { ep: 5, label: '第 5 集：沙箱怎么画' }, text: '反过来，第 2 帧改了常量表，constants 换成新对象，program 跟着重建，沙箱重画，屏幕上的标题就变长了。拼文档时只复制路过的那条，换来的就是这么便宜的比较。' },
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
            { edge: 'bytes', label: '字节', every: 5, delay: 0 },
            { edge: 'dec', label: '解码', every: 5, delay: 0.5 },
            { edge: 'txt', label: '文字', every: 5, delay: 1 },
            { edge: 'msg', label: '消息', every: 5, delay: 1.5 },
            { edge: 'bat', label: '批次', every: 5, delay: 2 },
            { edge: 'ok', label: 'seq ✓', every: 5, delay: 2.5 },
            { edge: 'nd', label: 'doc', every: 5, delay: 3 },
            { edge: 'st', label: 'setState', every: 5, delay: 3.4 },
            { edge: 'pg', label: 'program', every: 5, delay: 3.9 },
            { edge: 'rd', label: 'render', every: 5, delay: 4.3 },
          ],
        },
        text: '回顾这一圈：reader 收字节，TextDecoder 解码，SSEParser 按空行切消息，parseBlock 读出补丁，检查序号，applyOps 只复制路过的部分拼出新文档，React 只在 code、constants、data 换了的时候让沙箱重画。',
      },
      { view: null, board: { diagram: 'series', all: true, focus: ['ep3', 'ep4', 'ep2', 's24', 's42'] }, link: { ep: 4, label: '第 4 集：编译器内部' }, text: '回到地图。下一集先倒回服务端，打开第二集里那个 compile：一段 Tessera 标记，是怎样一步步变成 JavaScript 的。' },
    ],
  },
];
