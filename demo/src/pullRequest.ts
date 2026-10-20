import { defineComponent } from '@tessera/catalog';
import { z } from 'zod';

// A fixed-design component: the model only fills in facts about the pull request; how the card, the branch
// graph and the transitions between states look is entirely up to the host (PullRequestCard.tsx).

export const PR_STATUSES = ['opening', 'checking', 'conflicts', 'resolving', 'ready', 'merging', 'merged', 'closed'] as const;
export type PrStatus = (typeof PR_STATUSES)[number];

const conflictFile = z.object({ file: z.string().min(1), count: z.number().int().min(0) });
export type ConflictFile = z.infer<typeof conflictFile>;

export const statusText: Record<PrStatus, string> = {
  opening: '正在创建',
  checking: '检查中',
  conflicts: '有冲突',
  resolving: '正在解决冲突',
  ready: '可以合并',
  merging: '合并中',
  merged: '已合并',
  closed: '已关闭',
};

/** Conflicts still open: the counts of the files listed, 0 meaning that file is resolved. */
export function openConflicts(files: readonly ConflictFile[] | undefined): number {
  return (files ?? []).reduce((sum, f) => sum + f.count, 0);
}

export const pullRequest = defineComponent({
  name: 'PullRequest',
  description:
    'Status card for one pull request: title, branch graph, diff stats and the next step. Use it only for a pull request ' +
    'whose details you were given (tool data or the user), never an invented one. status: opening (being created), ' +
    'checking (merge check running), conflicts, resolving, ready (can merge), merging, merged or closed. behind: commits ' +
    'the base branch got after the split. synced: the base was merged into the branch. conflicts: files with the ' +
    'conflicts left in each (0 = resolved). Pass onResolve while status is conflicts and onMerge while ready, e.g. ' +
    'onMerge={() => ui.send("Merge #128")}.',
  props: z.object({
    title: z.string().min(1),
    number: z.number().int().positive().optional(),
    branch: z.string().min(1),
    base: z.string().min(1).optional(),
    commits: z.number().int().min(0),
    additions: z.number().int().min(0).optional(),
    deletions: z.number().int().min(0).optional(),
    behind: z.number().int().min(0).optional(),
    synced: z.boolean().optional(),
    status: z.enum(PR_STATUSES),
    conflicts: z.array(conflictFile).max(20).optional(),
    note: z.string().optional(),
  }),
  events: ['onResolve', 'onMerge'],
  fallback: (p) => {
    const status = PR_STATUSES.includes(p.status as PrStatus) ? (p.status as PrStatus) : 'checking';
    const head = `**${String(p.title ?? '')}**${typeof p.number === 'number' ? ` #${p.number}` : ''} · ${statusText[status]}`;
    const meta = [`\`${String(p.branch ?? '')}\` → \`${String(p.base ?? 'main')}\``, `${Number(p.commits ?? 0)} 个提交`];
    if (typeof p.additions === 'number' || typeof p.deletions === 'number') meta.push(`+${Number(p.additions ?? 0)} −${Number(p.deletions ?? 0)}`);
    const lines = [head, meta.join(' · ')];
    const files = conflictFile.array().safeParse(p.conflicts);
    if ((status === 'conflicts' || status === 'resolving') && files.success && files.data.length) {
      lines.push('冲突：' + files.data.map((f) => `${f.file}（${f.count || '已解决'}）`).join('、'));
    }
    if (typeof p.note === 'string' && p.note) lines.push(p.note);
    return lines.join('\n\n');
  },
});
