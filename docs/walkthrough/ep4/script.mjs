// Episode 4 script (v2 player): inside the compiler, from Tessera markup to a JS program. Lines at commit aa34cf6.

export const meta = {
  ep: 4,
  title: 'Tessera 代码导读 第 4 集',
  eyebrow: 'TESSERA 代码导读 · 第 4 集 / 共 6 集',
  h1: '编译器内部：从标记到一段 JS',
  lede: '打开第二集里的 compile：左边读代码，右边把编译流水线画出来，看一段 Tessera 标记怎样被切成词元、用栈排成树、把 Markdown 变成组件、检查每个表达式，最后写成 JavaScript。每一步的结果都是用仓库里的真实函数跑出来的。行号对应 tessera 仓库的提交 aa34cf6。',
  short: '第 4 集 · 编译器内部',
  stationWord: '步',
  boardLabel: 'compile() 的流水线',
  wireLabel: 'POST /api/stream',
  finish: '第 4 集看完了',
  next: '下一集：沙箱，这段代码在 iframe、Worker 和 SES 里怎样被关起来。',
};

export const files = {
  compile: { path: 'packages/lang/src/compile.ts', from: 42, to: 51 },
  tokenize: { path: 'packages/lang/src/tokenize.ts', from: 56, to: 150 },
  parse: { path: 'packages/lang/src/parse.ts', from: 68, to: 191 },
  markdown: { path: 'packages/lang/src/markdown.ts', from: 84, to: 175 },
  guard: { path: 'packages/lang/src/guard.ts', from: 1, to: 208 },
  codegen: { path: 'packages/lang/src/codegen.ts', from: 36, to: 135 },
};

export const stations = [{ name: '分词' }, { name: '建树' }, { name: 'Markdown 变组件' }, { name: '守卫' }, { name: '生成代码' }, { name: '半截输入' }];

export const example = '## 团队估价\n{@state seats = 8}\n每人每月 **29** 美元。\n<Slider min={1} max={50} value={seats} onChange={setSeats} />\n共 {seats * 29} 美元';
export const prefix = '## 团队估价\n{@state seats = 8}\n<Slider min={1} max=';
export const nested = '<Box gap={2}>\n## 标题\n<Slider min={1} max={9} value={n} onChange={setN} />\n</Box>\n现在是 {n}';

export const localDiagram = {
  w: 520,
  h: 600,
  zones: [
    { id: 'z-out', x: 8, y: 8, w: 504, h: 78, label: '调用它的和运行它的' },
    { id: 'z-compile', x: 8, y: 100, w: 504, h: 492, label: 'compile()：packages/lang' },
  ],
  nodes: [
    { id: 'caller', x: 24, y: 26, w: 200, h: 48, label: 'diff()', sub: '第 2 集：流式编译器', ep: 2 },
    { id: 'sandbox', x: 296, y: 26, w: 200, h: 48, label: '沙箱', sub: '第 5 集：真正的边界', ep: 5 },
    { id: 'src', x: 24, y: 116, w: 170, h: 44, label: 'Tessera 原文', sub: '模型写的' },
    { id: 'tok', x: 24, y: 200, w: 170, h: 44, label: 'tokenize', sub: '切成词元' },
    { id: 'parse', x: 24, y: 284, w: 170, h: 44, label: 'parse', sub: '用栈建树' },
    { id: 'md', x: 24, y: 368, w: 170, h: 44, label: 'toUI', sub: 'Markdown 变组件' },
    { id: 'gen', x: 24, y: 452, w: 170, h: 44, label: 'generate', sub: '写出 JS' },
    { id: 'out', x: 24, y: 536, w: 170, h: 44, label: '{ code, constants }', sub: '交回第 2 集' },
    { id: 'diags', x: 300, y: 242, w: 196, h: 44, label: 'diagnostics', sub: '警告和错误' },
    { id: 'catalog', x: 300, y: 368, w: 196, h: 44, label: 'catalog', sub: '组件目录（zod）' },
    { id: 'guard', x: 300, y: 452, w: 196, h: 44, label: 'guardExpression', sub: '表达式守卫' },
  ],
  edges: [
    { id: 'call', from: 'caller', to: 'src', label: 'compile(原文)', lx: 44 },
    { id: 'in', from: 'src', to: 'tok', label: '字符串', lx: 26 },
    { id: 't2p', from: 'tok', to: 'parse', label: '词元', lx: 20 },
    { id: 'p2m', from: 'parse', to: 'md', label: '节点树 + 声明', lx: 44 },
    { id: 'm2g', from: 'md', to: 'gen', label: '组件树', lx: 26 },
    { id: 'g2o', from: 'gen', to: 'out', label: '代码', lx: 20 },
    { id: 'ret', from: 'out', to: 'caller', fs: 'l', ts: 'l', via: [[12, 558], [12, 50]], label: '结果', at: 0.5, lx: 16 },
    { id: 'w1', from: 'tok', to: 'diags', fs: 'r', ts: 'l', off: [0, -10], dashed: true, label: 'unterminated_*', at: 0.5, ly: -10 },
    { id: 'w2', from: 'parse', to: 'diags', fs: 'r', ts: 'l', off: [0, 10], dashed: true, label: 'missing_self_close…', at: 0.55, ly: 12 },
    { id: 'look', from: 'md', to: 'catalog', label: '查目录' },
    { id: 'ask', from: 'gen', to: 'guard', off: [-10, -10], label: '每个表达式', ly: -12 },
    { id: 'ans', from: 'guard', to: 'gen', off: [10, 10], label: '通过 / 拒绝', ly: 12 },
    { id: 'bound', from: 'guard', to: 'sandbox', fs: 'r', ts: 'r', via: [[508, 474], [508, 50]], dashed: true, label: '第二道防线', at: 0.5, lx: -2 },
  ],
};

export const chapters = [
  {
    title: '开场：一段标记的旅程',
    station: null,
    beats: [
      { view: null, board: { diagram: 'series', all: true, focus: ['ep4', 's24', 's42', 'ep2'] }, text: '回到全系列的地图。第二集里，流式编译器每次都调用 compile，把完整原文整段重编。这一集打开它，地图上的第四块。' },
      { view: 'panel', panel: 'source', board: { diagram: 'local', add: ['z-out', 'z-compile', 'caller', 'src', 'call'], focus: ['src', 'call'], flows: [{ edge: 'call', label: '原文', every: 2.4 }] }, text: '我们用一个小例子从头跟到尾：一个标题，一个状态 seats，一句带粗体的话，一个滑块，再加一句会算钱的话。它从第二集的 diff 进来。' },
      { view: 'code', file: 'compile', lines: [44, 49], note: '四道工序', board: { add: ['tok', 'parse', 'md', 'gen', 'out', 'in', 't2p', 'p2m', 'm2g', 'g2o'], focus: ['tok', 'parse', 'md', 'gen'] }, text: '入口是 compile.ts 的 compile 函数，只有几行：44 行分词，45 行建树，46 行把 Markdown 变成组件，49 行生成代码。右边这条竖线，就是这四道工序。' },
      { view: null, board: { add: ['ret'], focus: ['in', 't2p', 'p2m', 'm2g', 'g2o', 'ret'], flows: [{ edge: 'in', label: '原文', every: 4, delay: 0 }, { edge: 't2p', label: '词元', every: 4, delay: 0.7 }, { edge: 'p2m', label: '树', every: 4, delay: 1.4 }, { edge: 'm2g', label: '组件', every: 4, delay: 2.1 }, { edge: 'g2o', label: '代码', every: 4, delay: 2.8 }] }, text: '表达式守卫藏在生成代码这一步里。所以分六步看：分词、建树、Markdown 变组件、守卫、生成代码，最后看它怎么对付写到一半的输入。' },
    ],
  },
  {
    title: '分词',
    station: 0,
    beats: [
      { view: 'code', file: 'tokenize', lines: [69, 72], board: { focus: ['tok'], scene: { type: 'tokens', title: 'tokenize 从左到右读，读完一个词元就给它上色', source: 'example' } }, text: '第一步，tokenize。它从头到尾一个字符一个字符地看，69 到 72 行就是这个循环。看下面：读到哪里，哪里亮起来，读完一个词元，就按种类上色。' },
      { view: 'code', file: 'tokenize', lines: [80, 92], board: { focus: ['tok'] }, text: '80 行：遇到左花括号，就找到配对的右花括号，把中间的内容交给 classifyBrace 判断是什么。' },
      { view: 'code', file: 'tokenize', lines: [135, 150], board: { focus: ['tok'] }, text: 'classifyBrace 看开头：@ 开头是声明，#if 和 #each 是控制块，其余的就是一个表达式。' },
      { view: 'code', file: 'tokenize', lines: [[111, 126], [128, 129]], board: { focus: ['tok'] }, text: '111 行：遇到小于号，后面跟着组件名，就读一整个标签，连同它的属性。其余字符，128 行统统当普通文字攒起来。' },
      { view: 'panel', panel: 'tokens', board: { focus: ['tok', 't2p'], flows: [{ edge: 't2p', label: '7 个词元', every: 2.4 }] }, text: '我们的例子被切成 7 个词元：文字、声明、文字、Slider 标签、文字、表达式、文字。注意这时候井号和星号还只是普通文字，Markdown 还没处理。' },
    ],
  },
  {
    title: '建树',
    station: 1,
    beats: [
      { view: 'code', file: 'parse', lines: [68, 72], note: '靠一个栈记位置', board: { focus: ['parse'], scene: { type: 'stack', title: '换一个有嵌套的例子：<Box> 里面套着标题和滑块', source: 'nested' } }, text: '第二步，parse 把词元排成一棵树。它用一个栈记住现在在哪个元素里面，72 行的 top 就是栈顶。下面换一个有嵌套的例子，看栈怎么一进一出。' },
      { view: 'code', file: 'parse', lines: [99, 108], board: { focus: ['parse'] }, text: '遇到开标签：先挂到当前元素下面；自闭合的就到此为止，否则压进栈，后面的内容都放进它里面。103 行是上一个里程碑加的：不能有子元素的组件，忘了写斜杠也当自闭合。' },
      { view: 'code', file: 'parse', lines: [110, 119], board: { focus: ['parse'] }, text: '遇到闭标签，110 行起：往栈里找同名的元素，找到就把它弹出去。刚才动画里 Box 出栈，就是这里。' },
      { view: 'code', file: 'parse', lines: [82, 96], note: '声明单独放', board: { add: ['diags', 'w2'], focus: ['parse', 'w2', 'diags'] }, text: '声明不进树，96 行单独收进 directives 列表。86 行：放在 #if 或 #each 里的声明算错误；只是包在元素里的，95 行提到顶层，给个警告，写进右边的诊断。' },
      { view: 'panel', panel: 'tree', board: { focus: ['parse', 'p2m'], flows: [{ edge: 'p2m', label: '节点树 + 声明', every: 2.4 }] }, text: '建好的树：声明 seats 单独放在一边，节点按出现顺序排好，Slider 是一个元素，seats 乘 29 是一个表达式节点。' },
    ],
  },
  {
    title: 'Markdown 变组件',
    station: 2,
    beats: [
      { view: 'code', file: 'markdown', lines: [84, 90], board: { focus: ['md'] }, text: '第三步，toUI。到这里，井号和星号还是文字。blockContent 先把内容按行切开，再一行一行判断。' },
      { view: 'code', file: 'markdown', lines: [153, 160], board: { focus: ['md'] }, text: '155 行：行首是井号，就是标题，变成 Title 组件；158 行按井号的个数定大小。' },
      { view: 'code', file: 'markdown', lines: [161, 170], board: { focus: ['md'] }, text: '161 行：短横线或者数字加点，是列表；其余的行，169 行收进段落，变成 Text。粗体、斜体、行内代码，在段落里面再拆。' },
      { view: 'panel', panel: 'ui', board: { add: ['catalog', 'look'], focus: ['md', 'look', 'catalog'], flows: [{ edge: 'look', label: 'Slider 在吗？', every: 2.4 }] }, link: { ep: 6, label: '第 6 集：目录也是前端的约定' }, text: '看结果：两个井号变成 Title，大小是 lg；那句话变成 Text，里面的 29 变成 Bold；滑块原样保留，它在右边的目录里查得到。现在整棵树只剩目录里的组件了。' },
    ],
  },
  {
    title: '守卫',
    station: 3,
    beats: [
      { view: 'code', file: 'guard', lines: [53, 62], board: { add: ['guard', 'ask', 'ans'], focus: ['guard', 'ask', 'ans'], flows: [{ edge: 'ask', label: '{seats * 29}', every: 2.4 }, { edge: 'ans', label: '✓', every: 2.4, delay: 1.2 }] }, text: '第四步，守卫。生成代码时，每个表达式都先交给它。56 行先用 acorn 解析成语法树；解析失败，或者表达式后面还跟着多余的东西，直接拒绝。' },
      { view: 'code', file: 'guard', lines: [7, 25], note: '能用的全局名字', board: { focus: ['guard'] }, text: '然后检查用到的名字。7 到 25 行是白名单：Math、JSON、Number 这些安全的内置对象，加上 ui。其他名字，必须是自己声明过的。' },
      { view: 'code', file: 'guard', lines: [72, 75], board: { focus: ['guard'], flows: [{ edge: 'ask', label: '{fetch(…)}', every: 2.4 }, { edge: 'ans', label: '✕ unknown', tone: 'stop', every: 2.4, delay: 1.2 }] }, text: '72 行遇到名字：双下划线开头的一律禁止，那是编译器内部用的；不在白名单、也没声明过的，报 unknown_identifier。' },
      { view: 'code', file: 'guard', lines: [[120, 127], [201, 202]], board: { focus: ['guard'], flows: [{ edge: 'ask', label: '{Math.constructor}', every: 2.4 }, { edge: 'ans', label: '✕ forbidden', tone: 'stop', every: 2.4, delay: 1.2 }] }, text: '120 行起是取属性：constructor、__proto__ 这些危险属性直接禁止。赋值、new、循环这类语法，走到 201 行的 default，统统拒绝。' },
      { view: 'panel', panel: 'guard', board: { add: ['bound'], focus: ['guard', 'bound', 'sandbox'] }, link: { ep: 5, label: '第 5 集：真正的边界是沙箱' }, text: '看几个例子：seats 乘 29 通过；fetch 不在白名单，拒绝；Math.constructor 想绕出去，拒绝；x 等于 1 是赋值，拒绝。被拒的只是被丢掉并写进诊断。守卫是第一道防线，真正的边界是下一集的沙箱。' },
    ],
  },
  {
    title: '生成代码',
    station: 4,
    beats: [
      { view: 'code', file: 'codegen', lines: [40, 57], note: '状态按名字存', board: { focus: ['gen'] }, link: { ep: 6, label: '第 6 集：状态为什么要按名字存' }, text: '第五步，generate。先处理声明：52 行，state 变成 useState，用名字当键；55 行，let 变成普通常量。按名字存，是为了重新编译以后状态还在。' },
      { view: 'code', file: 'codegen', lines: [86, 91], board: { focus: ['gen'] }, text: '再处理节点。87 行：文字不写进代码，只放进常量表，代码里写 __C 几号。90 行：表达式包进 __safe，出错只丢这一个值，不影响整个界面。' },
      { view: 'code', file: 'codegen', lines: [101, 117], board: { focus: ['gen', 'catalog', 'ask'] }, text: '101 行处理组件：每个属性先查目录里有没有，没有就丢掉，报 unknown_prop；表达式属性同样先过守卫，再包进 __safe。' },
      { view: 'code', file: 'codegen', lines: [61, 71], board: { focus: ['gen'] }, link: { ep: 2, label: '第 2 集：收尾括号为什么永远在最后' }, text: '最后 61 到 71 行套上外壳：一个函数，收下 __h、常量表这些参数，返回 TesseraProgram。这就是第二集里那个壳，收尾括号永远在最后。' },
      { view: 'panel', panel: 'code', board: { focus: ['gen', 'g2o', 'out', 'ret'], flows: [{ edge: 'g2o', label: '616 字符', every: 2.4 }, { edge: 'ret', label: 'code + 6 条常量', every: 2.4, delay: 1.2 }] }, text: '看生成的结果：seats 变成 useState；标题、那句话、滑块、最后一句，都变成 __h 调用；文字全是 __C 几号，常量表里正好六条，交回第二集的 diff。' },
    ],
  },
  {
    title: '半截输入',
    station: 5,
    beats: [
      { view: 'code', file: 'tokenize', lines: [[82, 85], [113, 116]], note: '写到一半，先丢掉', board: { add: ['w1'], focus: ['tok', 'w1', 'diags'], flows: [{ edge: 'w1', label: 'unterminated_tag', tone: 'stop', every: 2.4 }] }, text: '最后看流式时最关键的一点：输入经常是写到一半的。tokenize 遇到没有右花括号的表达式、没有右尖括号的标签，82 和 113 行，就报个警告，后面的先不要。' },
      { view: 'code', file: 'parse', lines: [178, 191], board: { focus: ['parse', 'w2'] }, text: 'parse 收尾时，178 行的 finishFrame 处理没闭合的元素：里面有内容，就自动闭合；空的，就丢掉。' },
      { view: 'panel', panel: 'prefix', board: { focus: ['out', 'ret'], flows: [{ edge: 'ret', label: '只有标题的程序', every: 2.4 }] }, link: { ep: 2, label: '第 2 集：所以每帧都能编译' }, text: '比如原文停在 Slider 的 max 等号这里：标签没写完，被丢掉，只报一个 unterminated_tag 警告。编译结果是一个只有标题的完整程序；等标签写完，滑块才出现。' },
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
            { edge: 'call', label: '原文', every: 5, delay: 0 },
            { edge: 't2p', label: '词元', every: 5, delay: 0.8 },
            { edge: 'p2m', label: '树', every: 5, delay: 1.5 },
            { edge: 'look', label: '查目录', every: 5, delay: 2 },
            { edge: 'm2g', label: '组件', every: 5, delay: 2.3 },
            { edge: 'ask', label: '表达式', every: 5, delay: 2.8 },
            { edge: 'g2o', label: '代码', every: 5, delay: 3.4 },
            { edge: 'ret', label: '结果', every: 5, delay: 3.9 },
          ],
        },
        text: '回顾这条流水线：tokenize 切词元，parse 用栈建树、收好声明，toUI 把 Markdown 变成组件，守卫检查每个表达式，generate 写出代码，文字进常量表，状态按名字存。写到一半的输入，也总能编译出一个完整的程序。',
      },
      { view: null, board: { diagram: 'series', all: true, focus: ['ep5', 'ep3', 's35'], flows: [{ edge: 's35', label: 'program', every: 2.2 }] }, link: { ep: 5, label: '第 5 集：沙箱' }, text: '回到地图。编好的程序沿着第三集那条路到了浏览器，下一集看它在哪里运行：iframe、Worker 和 SES 沙箱，怎样把它关起来。' },
    ],
  },
];
