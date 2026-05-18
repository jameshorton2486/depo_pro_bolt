import type { WordDiffToken } from '../../lib/diff/wordDiffEngine';

interface WordDiffProps {
  tokens: WordDiffToken[];
  compact?: boolean;
}

const OP_STYLES: Record<string, string> = {
  equal:       'text-slate-300',
  insert:      'bg-emerald-500/20 text-emerald-300 rounded px-0.5',
  delete:      'bg-rose-500/20 text-rose-300 line-through decoration-rose-500/60 rounded px-0.5',
  modify:      'bg-amber-500/20 text-amber-200 rounded px-0.5',
  punctuation: 'bg-sky-500/15 text-sky-300 rounded px-0.5',
};

export default function WordDiff({ tokens, compact = false }: WordDiffProps) {
  return (
    <p className={`font-mono leading-relaxed flex flex-wrap gap-y-0.5 ${compact ? 'text-[11px]' : 'text-[12px]'}`}>
      {tokens.map((token, i) => {
        const style = OP_STYLES[token.op] ?? OP_STYLES.equal;
        const display =
          token.op === 'delete' ? token.original :
          token.op === 'modify' ? `${token.original} → ${token.modified}` :
          token.modified ?? token.original ?? '';

        return (
          <span
            key={i}
            className={`${style} mr-1`}
            title={
              token.op !== 'equal'
                ? `${token.op}: ${token.startTime.toFixed(2)}s–${token.endTime.toFixed(2)}s  conf:${Math.round(token.confidence * 100)}%`
                : undefined
            }
          >
            {display}
          </span>
        );
      })}
    </p>
  );
}
