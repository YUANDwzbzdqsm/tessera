// The feed's videos. There is no footage: each "video" is an animated illustration with burned-in subtitles,
// enough to show where the sponsored card sits and how it behaves. Brands and accounts are made up.

export type SceneKind = 'kitchen' | 'shoe' | 'mountain' | 'cat';

export interface FeedVideo {
  readonly id: string;
  readonly author: string;
  readonly initials: string;
  readonly desc: string;
  readonly music: string;
  readonly likes: number;
  readonly comments: number;
  readonly saves: number;
  readonly shares: number;
  readonly scene: SceneKind;
  /** Background gradient, top to bottom. */
  readonly colors: readonly [string, string, string];
  /** Burned-in subtitles, one every few seconds; *text* is highlighted. */
  readonly subtitles: readonly string[];
  readonly sponsored?: boolean;
}

export const VIDEOS: readonly FeedVideo[] = [
  {
    id: 'v-kitchen',
    author: '阿树的厨房',
    initials: '树',
    desc: '十分钟搞定一碗葱油拌面，小火慢熬才是关键 #快手菜 #一人食',
    music: '原声 - 阿树的厨房',
    likes: 128_300,
    comments: 2311,
    saves: 9876,
    shares: 1520,
    scene: 'kitchen',
    colors: ['#2a1409', '#8a3f14', '#e79a3c'],
    subtitles: ['先把小葱*切成段*', '小火慢慢*熬出香味*', '这一勺葱油*是灵魂*'],
  },
  {
    id: 'v-ad',
    author: 'RunLite 轻跑',
    initials: 'RL',
    desc: '云感 3 缓震跑鞋上新，通勤和跑步都合适 #跑步 #装备',
    music: '推广音乐 - RunLite 轻跑',
    likes: 6,
    comments: 1,
    saves: 1,
    shares: 0,
    scene: 'shoe',
    colors: ['#060f2a', '#10357f', '#2c6cff'],
    subtitles: ['跑完*十公里*', '脚底还是*软的*', '云感 3 *新上市*'],
    sponsored: true,
  },
  {
    id: 'v-mountain',
    author: '山野小陈',
    initials: '陈',
    desc: '凌晨四点爬上山顶，终于等到这片云海 #旅行 #日出',
    music: '晨光 - 纯音乐',
    likes: 56_900,
    comments: 874,
    saves: 4410,
    shares: 960,
    scene: 'mountain',
    colors: ['#1b1945', '#73388a', '#ff9b73'],
    subtitles: ['凌晨*四点*出发', '爬了*三个小时*', '这一刻*都值了*'],
  },
  {
    id: 'v-cat',
    author: '猫咪观察日记',
    initials: '喵',
    desc: '它以为我看不见它 #猫 #日常',
    music: '原声 - 猫咪观察日记',
    likes: 342_000,
    comments: 5120,
    saves: 21_000,
    shares: 8800,
    scene: 'cat',
    colors: ['#132a25', '#336b4f', '#bfe0a6'],
    subtitles: ['它*又来了*', '假装*没看见*', '……*被发现了*'],
  },
];

export const AD_INDEX = VIDEOS.findIndex((v) => v.sponsored);

export function formatCount(n: number): string {
  if (n >= 10_000) return `${(n / 10_000).toFixed(1).replace(/\.0$/, '')}万`;
  return String(n);
}
