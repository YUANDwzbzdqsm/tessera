// Episode 2 script (v2 player): inside the stream compiler. Lines at commit aa34cf6.

export const meta = {
  ep: 2,
  title: 'Tessera 代码导读 第 2 集',
  eyebrow: 'TESSERA 代码导读 · 第 2 集 / 共 6 集',
  h1: '流式编译器：每次重编译，只发变化',
  lede: '打开上一集的黑盒 createStreamCompiler：左边读代码，右边把它的内部画出来，看碎片怎样攒成一批、整段重新编译、跟上一次比较，最后只发出变化的那一点。例子用配套动画里那条 27 帧的真实流。行号对应 tessera 仓库的提交 aa34cf6。',
  short: '第 2 集 · 流式编译器',
  stationWord: '步',
  boardLabel: 'createStreamCompiler 的内部',
  wireLabel: 'POST /api/stream',
  finish: '第 2 集看完了',
  next: '下一集：浏览器收流，解析 SSE，把补丁拼回文档。',
};

export const files = {
  server: { path: 'packages/stream/src/server.ts', from: 20, to: 138 },
  patch: { path: 'packages/stream/src/patch.ts', from: 48, to: 63 },
};

export const stations = [{ name: '账本' }, { name: '攒一攒' }, { name: '整段重编' }, { name: '代码只发中间' }, { name: '常量表' }, { name: '收尾' }];

export const localDiagram = {
  w: 520,
  h: 600,
  zones: [
    { id: 'z-outer', x: 8, y: 8, w: 504, h: 82, label: '外面：第 1 集和第 3 集' },
    { id: 'z-compiler', x: 8, y: 104, w: 504, h: 488, label: 'createStreamCompiler' },
  ],
  nodes: [
    { id: 'pump', x: 24, y: 30, w: 200, h: 50, label: 'createSSEStream', sub: '第 1 集：边收边编译', ep: 1 },
    { id: 'browser', x: 296, y: 30, w: 200, h: 50, label: '浏览器', sub: '第 3 集：拼回文档', ep: 3 },
    { id: 'push', x: 24, y: 136, w: 150, h: 48, label: 'push(chunk)', sub: '收文字' },
    { id: 'pending', x: 196, y: 136, w: 130, h: 48, label: 'pending', sub: '还没编译的字' },
    { id: 'clock', x: 348, y: 136, w: 148, h: 48, label: 'lastFlush', sub: '上次编译的时间' },
    { id: 'flush', x: 24, y: 226, w: 150, h: 48, label: 'flush()', sub: '到点了' },
    { id: 'diff', x: 24, y: 326, w: 150, h: 48, label: 'diff()', sub: '整段重编 + 比较' },
    { id: 'compile', x: 196, y: 326, w: 130, h: 48, label: 'compile()', sub: '第 4 集：编译器', ep: 4 },
    { id: 'doc', x: 348, y: 326, w: 148, h: 48, label: 'doc', sub: '服务端那份文档' },
    { id: 'sdiff', x: 24, y: 424, w: 150, h: 48, label: 'stringDiff', sub: 'code 只发中间' },
    { id: 'cdiff', x: 196, y: 424, w: 130, h: 48, label: 'diffConstants', sub: '能接就接' },
    { id: 'rest', x: 348, y: 424, w: 148, h: 48, label: '诊断 · 图片 · done', sub: '其他字段' },
    { id: 'emit', x: 150, y: 520, w: 220, h: 50, label: 'emit(kind, ops)', sub: '先改 doc，再交出批次' },
  ],
  edges: [
    { id: 'in', from: 'pump', to: 'push', label: '碎片', lx: 24 },
    { id: 'sse', from: 'pump', to: 'browser', label: 'SSE 帧' },
    { id: 'pend', from: 'push', to: 'pending', label: '+=' },
    { id: 'check', from: 'clock', to: 'flush', fs: 'b', ts: 'r', label: '超过 interval？', at: 0.45 },
    { id: 'call', from: 'push', to: 'flush', label: '到点才调', lx: 34 },
    { id: 'todiff', from: 'flush', to: 'diff', label: 'pending 不空', lx: 40 },
    { id: 'comp', from: 'diff', to: 'compile', off: [-10, -10], label: '完整原文', ly: -12 },
    { id: 'back', from: 'compile', to: 'diff', off: [10, 10], label: '新结果', ly: 12 },
    { id: 'old', from: 'doc', to: 'diff', fs: 't', ts: 't', off: [0, 40], via: [[422, 300], [139, 300]], label: '上一次的', at: 0.3 },
    { id: 'sd', from: 'diff', to: 'sdiff', label: 'code', lx: 18 },
    { id: 'cd', from: 'diff', to: 'cdiff', fs: 'b', ts: 't', off: [40, 0], label: 'constants', at: 0.55, lx: 14 },
    { id: 're', from: 'diff', to: 'rest', fs: 'r', ts: 't', off: [16, 0], label: '其他', at: 0.7 },
    { id: 'e1', from: 'sdiff', to: 'emit', fs: 'b', ts: 't', off: [0, -70] },
    { id: 'e2', from: 'cdiff', to: 'emit', fs: 'b', ts: 't', off: [0, 0] },
    { id: 'e3', from: 'rest', to: 'emit', fs: 'b', ts: 't', off: [0, 70] },
    { id: 'upd', from: 'emit', to: 'doc', fs: 'r', ts: 'b', label: 'applyOps', at: 0.4 },
    { id: 'ret', from: 'emit', to: 'pump', fs: 'l', ts: 'l', via: [[14, 545], [14, 55]], label: '批次', at: 0.5, lx: 18 },
  ],
};

export const chapters = [
  {
    title: '开场：打开黑盒',
    station: null,
    beats: [
      { view: null, board: { diagram: 'series', all: true, focus: ['ep2', 's12', 's24', 's42'] }, text: '回到全系列的地图。上一集走完了第一块，把流式编译器当成黑盒：文字碎片进去，补丁批次出来。这一集打开地图上的第二块。' },
      { view: null, board: { diagram: 'local', add: ['z-outer', 'z-compiler', 'pump', 'browser', 'sse'], focus: ['pump'] }, text: '外面是上一集见过的 createSSEStream，它把碎片交进来，把批次发去浏览器。里面这一大块，就是今天要画满的 createStreamCompiler。' },
      { view: null, board: { focus: ['z-compiler'] }, text: '它的思路只有一句话：每隔一段时间，把收到的全部文字从头编译一遍，跟上一次比，只把差别发出去。我们分六步，把这块画满。' },
    ],
  },
  {
    title: '账本',
    station: 0,
    beats: [
      { view: 'code', file: 'server', lines: [20, 33], board: { add: ['push', 'flush', 'in', 'call'], focus: ['push', 'flush'] }, text: '先看它对外提供什么。StreamCompiler 接口只有五个方法：push 收文字，flush 立刻编译，end 收尾，另外两个处理图片。createSSEStream 只调这几个。' },
      { view: 'code', file: 'server', lines: [40, 47], board: { add: ['pending', 'clock', 'doc', 'pend'], focus: ['pending', 'clock', 'doc'] }, text: '40 行是 createStreamCompiler 本身。它用几个变量记账，右边画出来的就是：pending 是收到了还没编译的文字，lastFlush 是上次编译的时间，doc 是当前文档。' },
      { view: 'code', file: 'server', lines: [49, 52], note: '服务端也留一份文档', board: { add: ['emit', 'upd', 'ret'], focus: ['emit', 'upd', 'doc'], flows: [{ edge: 'upd', label: 'applyOps', every: 2.4 }, { edge: 'ret', label: '批次', every: 2.4, delay: 1.2 }] }, link: { ep: 3, label: '第 3 集：浏览器用同一个 applyOps' }, text: '49 到 52 行的 emit 很关键：交出批次之前，先用同一个 applyOps 改自己的 doc。所以服务端这份文档和浏览器拼出来的始终一样，下次比较就拿它当上一次。' },
    ],
  },
  {
    title: '攒一攒',
    station: 1,
    beats: [
      { view: 'code', file: 'server', lines: [100, 104], board: { focus: ['push', 'pend'], flows: [{ edge: 'in', labels: ['##', ' 你好，', '这是'], every: 1.1 }, { edge: 'pend', label: '+= chunk', every: 1.1, delay: 0.6 }] }, text: 'push 是入口。102 行把新文字接到 pending 后面。103 行看时间：离上次编译不到 interval 毫秒，就先攒着，返回 null；到时间了才调用 flush。' },
      { view: 'code', file: 'server', lines: [92, 97], board: { add: ['check', 'diff', 'todiff'], focus: ['flush', 'check', 'clock'], flows: [{ edge: 'check', label: '≥ 100ms', every: 2.2 }, { edge: 'todiff', label: 'diff()', every: 2.2, delay: 1.1 }] }, text: 'flush 在 92 行。先记下这次的时间；pending 是空的就什么都不做；否则调 diff 算出变化，交给 emit 打包成批次。' },
      {
        view: 'wire',
        frames: [2],
        note: '一帧装了好几个 token',
        board: { focus: ['pending'], scene: { type: 'batches', title: '碎片怎样攒成批：第一个立刻编译，之后 100 毫秒内的攒在一起', arrivals: [0, 20, 45, 70, 95, 110, 130, 160, 185, 300, 330], labels: ['##', '', '你好', '', '这是', '一个', '', '会动', '', '的', '界面'], interval: 100, span: 460, dur: 8 } },
        text: '为什么要攒？模型一秒能吐几十个 token，每个都重编译、都发一帧，太浪费。看下面的时间线：第一个碎片马上编译，屏幕立刻有东西；之后 100 毫秒里来的碎片攒成一批，左边的第 2 帧就是这样攒出来的。',
      },
      { view: 'code', file: 'server', lines: [103, 103], board: { focus: ['clock', 'check'] }, link: { ep: 1, label: '第 1 集：193 行的闹钟' }, text: '模型要是停住了，不再 push，攒着的字也不会卡住：时间线上蓝色的那两批，就是第一集讲过的闹钟直接调 flush，把它们冲了出去。' },
    ],
  },
  {
    title: '整段重编',
    station: 2,
    beats: [
      { view: 'code', file: 'server', lines: [54, 61], board: { focus: ['diff'] }, text: 'diff 是核心，从 54 行开始。57 到 61 行先处理工具数据：只在第一次发一遍，以后不再重复。' },
      { view: 'code', file: 'server', lines: [62, 64], note: '原文只追加', board: { focus: ['diff', 'pending'] }, text: '62 行把新文字原样 append 到 text。63 行拼出完整原文：旧的 doc.text 加上 pending。' },
      { view: 'code', file: 'server', lines: [65, 65], note: '每次都从头编译', board: { add: ['compile', 'comp', 'back'], focus: ['compile', 'comp', 'back'], flows: [{ edge: 'comp', label: '完整原文', every: 2 }, { edge: 'back', label: 'code + constants', every: 2, delay: 1 }] }, link: { ep: 4, label: '第 4 集：compile 里面' }, text: '65 行最大胆：不管之前编译过多少，都把完整原文从头再编译一遍。听着浪费，其实很快：两三千字的回答，编译一次不到一毫秒。' },
      { view: 'code', file: 'server', lines: [65, 65], board: { focus: ['compile'] }, text: '好处是不用记住编译到一半的状态。半截的标签、没闭合的括号，编译器每次都当成一份完整输入来修补，结果总是对的。' },
      { view: 'code', file: 'server', lines: [67, 78], board: { add: ['old', 'sdiff', 'cdiff', 'rest', 'sd', 'cd', 're'], focus: ['old', 'sd', 'cd', 're'], flows: [{ edge: 'old', label: '上一次', every: 2.4 }] }, text: '编译完，拿新结果跟 doc 里的上一次比：67 行比代码，71 行比常量表，76 行比诊断。哪样变了，就生成对应的操作。右边分出的三路，接下来一样一样看。' },
    ],
  },
  {
    title: '代码只发中间',
    station: 3,
    beats: [
      { view: 'code', file: 'server', lines: [67, 70], board: { focus: ['sdiff', 'sd'] }, text: '先看代码。68 行有两种发法：第一次还没有旧代码，直接 replace 整段；以后交给 stringDiff，并把 kind 标成 structure。' },
      { view: 'code', file: 'patch', lines: [53, 57], board: { focus: ['sdiff'], scene: { type: 'strdiff', frame: 1, title: '第 1 帧：从左数相同的开头，从右数相同的结尾' } }, text: 'stringDiff 在 patch.ts。思路很朴素：新旧两段代码，开头一大段一样，结尾一大段也一样。56、57 行从头往后数，看下面绿色从左边一格一格亮起来，数出相同的开头有多长。' },
      { view: 'code', file: 'patch', lines: [58, 59], board: { focus: ['sdiff'], scene: { type: 'strdiff', frame: 1, title: '第 1 帧：从左数相同的开头，从右数相同的结尾' } }, text: '58、59 行从尾往前数，数出相同的结尾。max 减 start 这个上限，保证开头和结尾不会重叠。剩下中间没亮的，就是真正变了的。' },
      { view: 'diff', frame: 1, board: { focus: ['sdiff', 'e1'], add: ['e1'], flows: [{ edge: 'e1', label: 'splice 155 / 10', every: 2.4 }] }, text: '看真实的第 1 帧。旧代码 184 个字符，新代码 197 个：开头 155 个一样，结尾 19 个一样。所以只发：从 155 开始，删掉 10 个，插入 23 个。' },
      {
        view: 'code',
        file: 'patch',
        lines: [60, 62],
        note: '两种发法，选短的',
        board: { focus: ['sdiff'], scene: { type: 'list', title: '第 1 帧的两种发法，写成 JSON 比长短', items: [{ tag: '93 字节', ok: true, text: 'splice：从 155 开始删 10 个，插入 23 个' }, { tag: '253 字节', ok: false, text: 'replace：把 197 个字符的新代码整段发一遍' }, { tag: '选中', ok: true, text: '62 行发短的那个：splice' }] } },
        text: '60 行拼出 splice，61 行同时准备整段 replace，62 行比较两者写成 JSON 谁更短，就发谁。第 1 帧里 splice 是 93 字节，整段替换要 253 字节。改动特别大的时候，整段替换反而更省。',
      },
      { view: 'diff', frame: 15, board: { focus: ['sdiff', 'e1'], flows: [{ edge: 'e1', label: 'splice 265 / 0', every: 2.4 }] }, text: '第 15 帧滑块写完：remove 是 0，是纯插入。程序从 275 个字符长到 469 个，这一帧只发了新加的 194 个。' },
    ],
  },
  {
    title: '常量表',
    station: 4,
    beats: [
      { view: 'code', file: 'server', lines: [126, 128], board: { focus: ['cdiff', 'cd'] }, text: '常量表装的是界面上的固定文字。diffConstants 在 126 行，128 行先看：新表比旧表短，就只能整表 replace。' },
      {
        view: 'code',
        file: 'server',
        lines: [130, 136],
        note: '能 append 就不 replace',
        board: { focus: ['cdiff'], scene: { type: 'list', title: 'diffConstants 逐条比较的四种结果', items: [{ tag: 'add', text: '旧表没有这一条：加到末尾' }, { tag: '跳过', text: '一模一样：什么都不发' }, { tag: 'append', ok: true, text: '新值以旧值开头：只发多出来的部分' }, { tag: 'replace', text: '其他情况：整条换掉' }] } },
        text: '然后逐条比。旧表没有这一条，就 add 到末尾；一模一样就跳过；新值以旧值开头，说明只是变长了，就 append 多出来的部分；否则整条 replace。',
      },
      { view: 'wire', frames: [2, 3], board: { add: ['e2'], focus: ['cdiff', 'e2'], flows: [{ edge: 'cd', label: '常量变长', every: 2.2 }, { edge: 'e2', label: 'append /constants/0', every: 2.2, delay: 1.1 }] }, text: '这就是第 2、3 帧：标题从你好，长成你好，这是一个会动的界面。代码一个字没变，只 append 常量。' },
      { view: 'code', file: 'server', lines: [71, 75], board: { focus: ['cdiff', 'e2'] }, text: '回到 diff 的 71 到 75 行：只有常量变了，kind 就标成 constants。浏览器一看就知道，不用换程序，只换文字。' },
      { view: 'wire', frames: [5, 6], board: { focus: ['cdiff', 'e2'], flows: [{ edge: 'e2', label: 'replace /constants', every: 2.2 }] }, link: { ep: 2, label: '回看：为什么编译时会改中间' }, text: '表什么时候会变短？第 5 帧，行末的小于号先被当成文字，进了常量表；第 6 帧发现它是 Slider 标签的开头，那条常量没了，只能整表替换。' },
    ],
  },
  {
    title: '收尾',
    station: 5,
    beats: [
      { view: 'code', file: 'server', lines: [76, 78], board: { add: ['e3'], focus: ['rest', 're'], flows: [{ edge: 're', label: 'diagnostics', every: 2.2 }] }, text: '76 行比较诊断：内容变了，就整个 replace。比如半截标签的警告出现，标签写完后又清空。' },
      { view: 'code', file: 'server', lines: [79, 83], board: { focus: ['rest'] }, text: '79 到 83 行记下要去服务器查的组件，比如图片。同一个键只排一次队，编译一百遍也只查一次。' },
      { view: 'code', file: 'server', lines: [111, 114], note: '图片单独一个批次', board: { focus: ['rest', 'e3'], flows: [{ edge: 'e3', label: 'add /data/…', every: 2.4 }] }, text: '查到以后，111 行的 resolved 把结果 add 进 data，kind 是 data。真实流里的第 25 帧就是它。' },
      { view: 'code', file: 'server', lines: [84, 88], board: { focus: ['rest', 'emit'], flows: [{ edge: 'e3', label: 'done: true', every: 2.4 }, { edge: 'ret', label: 'final', every: 2.4, delay: 1.2 }] }, text: '最后 end 带着 done 等于 true 调 diff：84 到 88 行附上 Markdown 降级版，把 done 设成 true，kind 是 final。' },
      { view: 'code', file: 'server', lines: [115, 119], board: { stop: ['in'], focus: ['push'], flows: [{ edge: 'in', label: '✕ 已经结束', tone: 'stop', every: 2.6 }] }, text: '115 行的 end 和 101 行的 push 都先检查 done：流已经结束，再推文字就直接报错，不会悄悄多发一帧。' },
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
            { edge: 'in', label: '碎片', every: 4.5, delay: 0 },
            { edge: 'todiff', label: 'flush', every: 4.5, delay: 0.7 },
            { edge: 'comp', label: '整段', every: 4.5, delay: 1.3 },
            { edge: 'old', label: '上一次', every: 4.5, delay: 1.6 },
            { edge: 'sd', label: 'splice', every: 4.5, delay: 2.2 },
            { edge: 'e1', label: 'ops', every: 4.5, delay: 2.8 },
            { edge: 'upd', label: 'applyOps', every: 4.5, delay: 3.4 },
            { edge: 'ret', label: '批次', every: 4.5, delay: 3.6 },
          ],
        },
        text: '回顾这张图：push 攒文字，flush 到点整段重编译，再跟服务端自己留的 doc 比；代码用 stringDiff 只发中间，常量能 append 就不 replace，诊断、图片和结束各有各的操作，emit 先改 doc 再交出批次。',
      },
      { view: null, board: { diagram: 'series', all: true, focus: ['ep2', 'ep3', 's23'], flows: [{ edge: 's23', label: 'SSE 帧', every: 2.2 }] }, link: { ep: 3, label: '第 3 集：浏览器收流' }, text: '效果怎么样？之前测过，代码在整条流里的占比，从四成多降到一成多。下一集沿着地图往下走，到浏览器那边：SSE 怎么解析，补丁怎么拼回文档。' },
    ],
  },
];
