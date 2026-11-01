import { useNavigate } from 'react-router-dom';
import type { ChatMessage } from '@/types';
import { todayISO } from '@/lib/dates';
import { cx } from '@/lib/format';
import { CheckIcon } from '@/components/icons';
import ResultCard from './ResultCard';
import ConfirmCard from './ConfirmCard';

interface Props {
  message: ChatMessage;
  onOpenTrace: () => void;
}

export default function MessageItem({ message: m, onOpenTrace }: Props) {
  const navigate = useNavigate();

  if (m.role === 'user') {
    return (
      <div className="max-w-[85%] self-end whitespace-pre-line rounded-[14px_14px_4px_14px] bg-ink px-3.5 py-2.5 text-white">
        {m.text}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      {m.chips && m.chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {m.chips.map((c, i) => (
            <span
              key={i}
              className={cx(
                'rounded-md px-2 py-1 text-xs font-medium',
                c.missing ? 'border border-dashed border-[#B9B5AB] text-muted' : 'bg-chip',
              )}
            >
              {c.label}
            </span>
          ))}
        </div>
      )}
      {m.toolsSummary && (
        <button
          type="button"
          onClick={onOpenTrace}
          className="flex min-h-8 items-center gap-2 self-start rounded-lg border border-line bg-white px-2.5 text-left font-mono text-xs text-muted hover:border-line2"
        >
          <CheckIcon size={12} className={m.toolsTone === 'warn' ? 'text-warn-icon' : 'text-ok'} />
          {m.toolsSummary}
        </button>
      )}
      {m.text && <p className="whitespace-pre-line">{m.text}</p>}
      {m.results && m.results.length > 0 && (
        <div className="flex flex-col gap-2.5">
          {m.results.map((item, i) => (
            <ResultCard key={item.restaurantId} item={item} index={i} date={m.resultsDate ?? todayISO()} />
          ))}
        </div>
      )}
      {m.confirm && <ConfirmCard messageId={m.id} request={m.confirm} />}
      {m.action === 'reservations' && (
        <button type="button" onClick={() => navigate('/reservations')} className="btn-outline h-[38px] self-start">
          View reservations
        </button>
      )}
      {m.followUp && <p>{m.followUp}</p>}
    </div>
  );
}
