export interface Sample {
  readonly id: string;
  readonly label: string;
  readonly source: string;
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
