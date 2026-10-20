export interface Sample {
  readonly id: string;
  readonly label: string;
  readonly source: string;
  /** Tool results this answer may refer to by name, as a search tool would have returned them. */
  readonly data?: Readonly<Record<string, unknown>>;
}

/** What a git tool would hand the agent. The card's look is the host's; the model only passes these facts on. */
const pr = {
  title: '会话快过期时在中间件里自动续期',
  number: 128,
  branch: 'feat/session-refresh',
  base: 'main',
  commits: 3,
  additions: 128,
  deletions: 36,
  behind: 2,
  conflicts: [
    { file: 'middleware.ts', count: 1 },
    { file: 'auth.ts', count: 2 },
  ],
};

export const samples: readonly Sample[] = [
  {
    id: 'team',
    label: '团队估价',
    source: `## 团队套餐估价
拖动滑块，看看团队**每月**要花多少。
{@state seats = 8}
{@let price = seats * 29}
<Box border padding={3} gap={2}>
<Slider label="席位" min={1} max={50} value={seats} onChange={setSeats} />
<Title size="xl">{price} 美元/月</Title>
<Caption>按年付相当于每月 {Math.round(price * 10 / 12)} 美元</Caption>
<Button onClick={() => ui.send(\`为 \${seats} 人的团队做一份年度预算，每月 \${price} 美元\`)}>生成方案</Button>
</Box>`,
  },
  {
    id: 'checklist',
    label: '出行清单',
    source: `## 周末露营清单
{@state items = ["帐篷", "睡袋", "头灯", "防蚊液"]}
{@state done = []}
{@let left = items.filter((i) => !done.includes(i))}
<Box gap={1}>
{#each items as item}
<Checkbox label={item} checked={done.includes(item)} onChange={(on) => setDone(on ? [...done, item] : done.filter((d) => d !== item))} />
{/each}
</Box>
{#if left.length === 0}
<Badge tone="success">全部带齐了</Badge>
{:else}
还差 **{left.length}** 样：{left.join("、")}
{/if}`,
  },
  {
    id: 'compare',
    label: '商品对比',
    data: {
      p1: { title: 'Sony WH-1000XM6', price: '¥2,899', priceValue: 2899, merchant: '京东', rating: 4.8 },
      p2: { title: 'Bose QuietComfort Ultra', price: '¥2,499', priceValue: 2499, merchant: '天猫', rating: 4.6 },
    },
    source: `## 降噪耳机怎么选
两款都在预算内。价格和商家直接取自搜索结果，模型只写了引用。
{@let cheaper = p1.priceValue < p2.priceValue ? p1 : p2}
<Box direction="row" gap={3}>
<Box border padding={3} gap={1}>
<Image query="索尼 头戴式降噪耳机 黑色" aspect="4:3" />
<Title size="md">{p1.title}</Title>
<Title size="xl">{p1.price}</Title>
<Caption>{p1.merchant} · 评分 {p1.rating}</Caption>
</Box>
<Box border padding={3} gap={1}>
<Image query="Bose 头戴式降噪耳机 白色" aspect="4:3" />
<Title size="md">{p2.title}</Title>
<Title size="xl">{p2.price}</Title>
<Caption>{p2.merchant} · 评分 {p2.rating}</Caption>
</Box>
</Box>
更便宜的是 **{cheaper.title}**，便宜 {Math.abs(p1.priceValue - p2.priceValue)} 元。
<Button onClick={() => ui.send(\`帮我下单 \${cheaper.title}\`)}>就买便宜的</Button>`,
  },
  {
    id: 'pr',
    label: '合并请求',
    data: { pr },
    source: `## 结账中途掉登录的问题修好了
PR 已经开出来了，但 \`main\` 在这期间有了新提交，改到了同几行。点卡片上的按钮，看看它怎么变。
{@state status = "conflicts"}
<PullRequest
  title={pr.title} number={pr.number} branch={pr.branch} base={pr.base}
  commits={pr.commits} additions={pr.additions} deletions={pr.deletions} behind={pr.behind}
  status={status} synced={status !== "conflicts"} conflicts={pr.conflicts}
  note={status === "conflicts" ? "main 上的会话密钥轮换改了同几行" : status === "merged" ? "feat/session-refresh 已删除" : "没有冲突，测试、lint 和预览都通过了"}
  onResolve={() => setStatus("ready")}
  onMerge={() => setStatus("merged")}
/>
{#if status === "merged"}
已经合并进 \`main\`，可以发版了。
<Button variant="outline" onClick={() => setStatus("conflicts")}>重新演示</Button>
{/if}`,
  },
  {
    id: 'pr-states',
    label: 'PR 状态切换',
    data: { pr },
    // Every knob the card has, driven from in-sandbox state: switch statuses to watch the transitions.
    source: `## PullRequest 卡片的所有状态
按顺序点状态，看卡片怎么过渡；滑块和勾选改分支图的形状。
{@state status = "conflicts"}
{@state commits = 3}
{@state behind = 2}
{@state remaining = 3}
{@state synced = false}
{@let states = [["opening", "创建中"], ["checking", "检查中"], ["conflicts", "有冲突"], ["resolving", "解决中"], ["ready", "可以合并"], ["merging", "合并中"], ["merged", "已合并"], ["closed", "已关闭"]]}
<PullRequest
  title={pr.title} number={pr.number} branch={pr.branch} base={pr.base}
  commits={commits} additions={pr.additions} deletions={pr.deletions} behind={behind} synced={synced} status={status}
  conflicts={[{ file: "middleware.ts", count: Math.min(remaining, 1) }, { file: "auth.ts", count: Math.max(remaining - 1, 0) }]}
  note={status === "conflicts" || status === "resolving" ? "main 上的会话密钥轮换改了同几行" : status === "ready" || status === "merging" ? "没有冲突，测试、lint 和预览都通过了" : status === "merged" ? "feat/session-refresh 已删除" : ""}
  onResolve={() => setStatus("resolving")}
  onMerge={() => setStatus("merging")}
/>
<Box border padding={3} gap={2}>
<Caption>状态</Caption>
<Box direction="row" gap={1}>
{#each states.slice(0, 4) as s}
<Button variant={status === s[0] ? "solid" : "outline"} onClick={() => setStatus(s[0])}>{s[1]}</Button>
{/each}
</Box>
<Box direction="row" gap={1}>
{#each states.slice(4) as s}
<Button variant={status === s[0] ? "solid" : "outline"} onClick={() => setStatus(s[0])}>{s[1]}</Button>
{/each}
</Box>
<Slider label="分支上的提交" min={1} max={5} value={commits} onChange={setCommits} />
<Slider label="main 新增的提交" min={0} max={4} value={behind} onChange={setBehind} />
<Slider label="剩余冲突" min={0} max={3} value={remaining} onChange={setRemaining} />
<Checkbox label="main 已合进分支" checked={synced} onChange={setSynced} />
</Box>`,
  },
  {
    id: 'hang',
    label: '卡死的程序',
    source: `## 卡死的程序会怎样
沙箱停止响应时，看门狗会把它整个换掉，并恢复上一次正常渲染时的状态。
{@state count = 0}
<Box border padding={3} gap={2}>
<Title size="xl">点了 {count} 次</Title>
<Box direction="row" gap={2}>
<Button onClick={() => setCount(count + 1)}>正常加一</Button>
<Button variant="outline" onClick={() => setCount(Array.from({ length: 100000 }).reduce((sum) => sum + Array.from({ length: 100000 }).length, 0))}>跑一个停不下来的计算</Button>
</Box>
</Box>`,
  },
  {
    id: 'broken',
    label: '出错的写法',
    source: `## 编译器会怎么处理这些错误
<Rocket speed={9} />
<Box gap="1" fill="red">
- 读取 cookie：{document.cookie}
- 访问构造器：{Math.constructor}
- 赋值：{x = 1}
- 正常的表达式：{2 + 3}
</Box>
<Slider min={1} max=`,
  },
];
