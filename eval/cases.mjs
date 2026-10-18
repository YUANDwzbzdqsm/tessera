// Benchmark prompts for Tessera. Each case says what a good answer looks like, in checks the runner can apply:
// - ui: true  -> the answer should use catalog components beyond plain Markdown
//   ui: false -> a plain question; the answer should not build interactive widgets
// - use: components that should appear
// - contains: text that should appear in the Markdown fallback (rendered at the initial state)
// - noCopy: literal values from tool data that the model must not retype (it should write {name.field})

const products = {
  p1: { title: 'Sony WH-1000XM6', price: '¥2,899', priceValue: 2899, merchant: '京东', rating: 4.8, battery_hours: 32 },
  p2: { title: 'Bose QuietComfort Ultra', price: '¥2,499', priceValue: 2499, merchant: '天猫', rating: 4.6, battery_hours: 24 },
};

const places = {
  places: [
    { name: '山间小馆', cuisine: '云南菜', rating: 4.7, price_per_person: 86, distance_km: 0.8 },
    { name: '渔火码头', cuisine: '海鲜', rating: 4.3, price_per_person: 158, distance_km: 2.1 },
    { name: '青禾面馆', cuisine: '面食', rating: 4.6, price_per_person: 32, distance_km: 0.4 },
    { name: '炉边烤肉', cuisine: '烧烤', rating: 4.1, price_per_person: 120, distance_km: 3.5 },
  ],
};

const weather = {
  w: {
    city: '杭州',
    today: { condition: '多云', high: 23.6, low: 15.2, rain_chance: 0.12 },
    tomorrow: { condition: '小雨', high: 19.4, low: 14.8, rain_chance: 0.37 },
  },
};

export const cases = [
  { id: 'team-plan', title: '团队套餐计算器', prompt: '我们公司在选协作工具，每个席位每月 29 美元。帮我做一个能调人数、看月费和年费的小工具。', expect: { ui: true, use: ['Slider'] } },
  { id: 'mortgage', title: '房贷计算器', prompt: '帮我算房贷：贷款金额、年利率、贷款年限都能调，显示每月还款额和总利息（等额本息）。', expect: { ui: true, use: ['Slider'] } },
  { id: 'temperature', title: '温度换算', prompt: '做一个摄氏度和华氏度互相换算的小工具。', expect: { ui: true, use: ['Slider'] } },
  {
    id: 'compare',
    title: '商品对比（工具数据）',
    prompt: '我刚搜了两款降噪耳机，结果在 p1 和 p2 里。帮我并排对比，告诉我哪款更便宜、便宜多少。',
    data: products,
    expect: { ui: true, contains: ['¥2,899', '¥2,499'], noCopy: ['2,899', '2,499', '2899', '2499'] },
  },
  {
    id: 'restaurants',
    title: '餐厅列表（工具数据）',
    prompt: '附近餐厅的搜索结果在 places 里。帮我按评分从高到低列出来，并标出 4.5 分以上的。',
    data: places,
    expect: { ui: true, contains: ['山间小馆', '青禾面馆'], noCopy: ['山间小馆', '渔火码头', '青禾面馆', '炉边烤肉'] },
  },
  {
    id: 'weather',
    title: '天气卡片（工具数据）',
    prompt: '这是杭州今明两天的天气数据（在 w 里）。帮我整理成卡片，并建议明天要不要带伞。',
    data: weather,
    expect: { ui: true, contains: ['杭州'], noCopy: ['23.6', '19.4', '37%', '0.37'] },
  },
  { id: 'packing', title: '露营清单', prompt: '下周去露营两天，给我一个可以勾选的行李清单，勾完显示还差几样没带。', expect: { ui: true, use: ['Checkbox'] } },
  { id: 'recipe', title: '按人数缩放的菜谱', prompt: '番茄炒蛋的做法。份量要能按人数调整（1 到 6 人），食材用量跟着变。', expect: { ui: true, use: ['Slider'] } },
  { id: 'red-panda', title: '带图片的介绍', prompt: '给我看看小熊猫长什么样，再讲三个关于它的有趣事实。', expect: { ui: true, use: ['Image'] } },
  { id: 'interest', title: '可调参数的复利解释', prompt: '用一个能调参数的例子解释复利：本金、年利率、年数都能调，并和单利对比。', expect: { ui: true, use: ['Slider'] } },
  { id: 'bill-split', title: '分账工具', prompt: '四个人吃饭花了 680 元，帮我做个分账工具，可以调人数和小费比例。', expect: { ui: true, use: ['Slider'] } },
  { id: 'quiz', title: '小测验', prompt: '出两道关于太阳系的选择题。点选项后告诉我对错，最后显示总分。', expect: { ui: true, use: ['Button'] } },
  { id: 'habit', title: '喝水打卡', prompt: '做一个本周喝水打卡表：周一到周日每天勾选是否喝够 8 杯，并显示完成率。', expect: { ui: true, use: ['Checkbox'] } },
  { id: 'capital', title: '简单事实问答', prompt: '法国的首都是哪里？', expect: { ui: false, contains: ['巴黎'] } },
  { id: 'tcp-udp', title: '概念解释', prompt: '用三句话说清楚 TCP 和 UDP 的区别。', expect: { ui: false } },
  // Code is full of braces and < that would otherwise be read as expressions and tags.
  { id: 'py-code', title: '写代码', prompt: '写一个 Python 函数，统计一段文字里每个单词出现的次数，返回字典，并给一个调用示例。', expect: { ui: false, use: ['CodeBlock'], contains: ['def '] } },
  {
    id: 'code-and-widget',
    title: '代码加小工具',
    prompt: '用 JavaScript 写一个求斐波那契数列第 n 项的函数，再做一个可以拖动 n 的小工具，显示第 n 项的值。',
    expect: { ui: true, use: ['CodeBlock', 'Slider'], contains: ['function'] },
  },
];
