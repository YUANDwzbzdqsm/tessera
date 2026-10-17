export interface Sample {
  readonly id: string;
  readonly label: string;
  readonly source: string;
  /** Tool results this answer may refer to by name, as a search tool would have returned them. */
  readonly data?: Readonly<Record<string, unknown>>;
}

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
