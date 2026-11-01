import { useEffect, useRef, useState } from 'react';
import { useApp } from '@/store/AppStore';
import { formatDay, resolveDay } from '@/lib/dates';
import { cx, guests } from '@/lib/format';
import MessageItem from './MessageItem';
import TracePanel from './TracePanel';
import Composer from './Composer';

type Tab = 'chat' | 'trace';

export default function AgentPanel() {
  const { state } = useApp();
  const [tab, setTab] = useState<Tab>('chat');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [state.messages.length, state.busy, tab]);

  const ctx = state.context;
  const subtitle =
    [ctx.day ? formatDay(resolveDay(ctx.day)) : null, ctx.neighborhood, ctx.partySize ? guests(ctx.partySize) : null]
      .filter(Boolean)
      .join(' · ') || 'Your dining agent';

  return (
    <aside
      aria-label="Ask Seated"
      className="flex min-h-[480px] max-w-full flex-[1_1_400px] flex-col border-l border-line bg-white md:min-h-0"
    >
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="flex min-w-0 flex-col">
          <span className="text-[15px] font-semibold">Ask Seated</span>
          <span className="truncate text-xs text-muted">{subtitle}</span>
        </div>
        <div role="tablist" aria-label="Panel view" className="flex gap-0.5 rounded-lg bg-chip p-[3px]">
          {(['chat', 'trace'] as const).map((t) => (
            <button
              key={t}
              role="tab"
              type="button"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={cx(
                'h-8 rounded-md px-3 text-[13px] font-medium',
                tab === t ? 'bg-white text-ink shadow-[0_1px_2px_rgba(23,25,30,0.1)]' : 'text-muted',
              )}
            >
              {t === 'chat' ? 'Chat' : `Trace${state.runs.length ? ` · ${state.runs.length}` : ''}`}
            </button>
          ))}
        </div>
      </div>

      {tab === 'chat' ? (
        <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-5">
          {state.messages.map((m) => (
            <MessageItem key={m.id} message={m} onOpenTrace={() => setTab('trace')} />
          ))}
          {state.busy && (
            <div className="flex items-center gap-2 font-mono text-xs text-muted">
              <span className="animate-pulse-dot h-2 w-2 rounded-full bg-accent" />
              {state.busyLabel}
            </div>
          )}
        </div>
      ) : (
        <TracePanel />
      )}

      <Composer onSent={() => setTab('chat')} />
    </aside>
  );
}
