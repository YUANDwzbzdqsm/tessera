// Shared by every episode: the series list, published links, and the series map that opens and closes each episode.

export const links = {
  1: 'https://claude.ai/artifact/XsqRxEeJcNq8F9T7tfpvk7',
  2: 'https://claude.ai/artifact/UVJuwjSGTQksLzPAjxoH4P',
  3: 'https://claude.ai/artifact/DsYLAJzNNxVMKUrW5TgGGr',
  4: 'https://claude.ai/artifact/Mx1PVWvsvpgofpYMZJFnJp',
  5: 'https://claude.ai/artifact/CdrmLHmLHrazvxZoNKTv11',
  6: 'https://claude.ai/artifact/SxtwPgLfsNnrEMy2GLrUme',
};

export const related = [{ label: '配套动画：SSE 补丁回放', url: 'https://claude.ai/artifact/RebpJEhp3Ce46JSt7SD1hE' }];

export const series = [
  { title: '消息进门：从发送按钮到 SSE 帧', files: 'ChatApp · vite.config · chat.ts · server.ts · sse.ts' },
  { title: '流式编译器：每次重编译，只发变化', files: 'packages/stream/src/server.ts · patch.ts' },
  { title: '浏览器收流：解析 SSE，拼回文档', files: 'packages/stream/src/sse.ts · patch.ts · useTesseraStream.ts' },
  { title: '编译器内部：从标记到一段 JS', files: 'packages/lang/src/tokenize · parse · markdown · guard · codegen' },
  { title: '沙箱：iframe、Worker 和 SES', files: 'packages/react/src/sandbox.ts · controller.ts · packages/runtime/src' },
  { title: '画到屏幕上：组件、状态和 ui.send', files: 'packages/react/src/RemoteTree.tsx · runtime.ts · ChatApp' },
];

// The whole system as six regions, one per episode, in the order a message travels. 520 × 600 board units.
export const seriesDiagram = {
  w: 520,
  h: 600,
  font: 'body',
  zones: [
    { id: 'z-server', x: 268, y: 14, w: 244, h: 282, label: '服务端' },
    { id: 'z-browser', x: 8, y: 14, w: 244, h: 432, label: '浏览器' },
  ],
  nodes: [
    { id: 'ep1', x: 24, y: 46, w: 212, h: 92, label: '第 1 集 · 消息进门', sub: 'ChatApp → sseRoute → modelText', ep: 1 },
    { id: 'ep2', x: 284, y: 46, w: 212, h: 92, label: '第 2 集 · 流式编译器', sub: 'push · flush · stringDiff', ep: 2 },
    { id: 'ep4', x: 284, y: 188, w: 212, h: 92, label: '第 4 集 · 编译器', sub: 'tokenize → parse → codegen', ep: 4 },
    { id: 'ep3', x: 284, y: 340, w: 212, h: 92, label: '第 3 集 · 浏览器收流', sub: 'SSEParser · applyOps', ep: 3 },
    { id: 'ep5', x: 24, y: 340, w: 212, h: 92, label: '第 5 集 · 沙箱', sub: 'iframe · Worker · SES', ep: 5 },
    { id: 'ep6', x: 24, y: 188, w: 212, h: 92, label: '第 6 集 · 画到屏幕上', sub: '组件 · 状态 · ui.send', ep: 6 },
  ],
  edges: [
    { id: 's12', from: 'ep1', to: 'ep2', fs: 'r', ts: 'l', label: '文字碎片' },
    { id: 's24', from: 'ep2', to: 'ep4', fs: 'b', ts: 't', off: [-40, -40], label: '整段重编', lx: -34 },
    { id: 's42', from: 'ep4', to: 'ep2', fs: 't', ts: 'b', off: [40, 40], label: '程序', lx: 22 },
    { id: 's23', from: 'ep2', to: 'ep3', fs: 'r', ts: 'r', off: [20, -20], via: [[512, 112], [512, 366]], label: 'SSE 帧', at: 0.5, lx: -2 },
    { id: 's35', from: 'ep3', to: 'ep5', fs: 'l', ts: 'r', label: 'program' },
    { id: 's56', from: 'ep5', to: 'ep6', fs: 't', ts: 'b', label: '组件树' },
    { id: 's61', from: 'ep6', to: 'ep1', fs: 't', ts: 'b', label: 'ui.send：新消息' },
  ],
  caption: '一条消息绕一圈：发出去、编译、流回来、进沙箱、画到屏幕上。每一集负责地图上的一块。',
};
