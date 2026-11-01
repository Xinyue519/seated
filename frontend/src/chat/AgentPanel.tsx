import { useEffect, useRef, useState } from 'react';
import { useApp } from '@/store/AppStore';
import { formatDay, resolveDay } from '@/lib/dates';
import { cx, guests } from '@/lib/format';
import MessageItem from './MessageItem';
import TracePanel from './TracePanel';
import Composer from './Composer';
import styles from './chat.module.css';

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
    <aside aria-label="Ask Seated" className={styles.panel}>
      <div className={styles.header}>
        <div className={styles.headerTitles}>
          <span className={styles.title}>Ask Seated</span>
          <span className={styles.subtitle}>{subtitle}</span>
        </div>
        <div role="tablist" aria-label="Panel view" className={styles.tabList}>
          {(['chat', 'trace'] as const).map((t) => (
            <button
              key={t}
              role="tab"
              type="button"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={cx(styles.tabButton, tab === t ? styles.tabButtonActive : styles.tabButtonInactive)}
            >
              {t === 'chat' ? 'Chat' : `Trace${state.runs.length ? ` · ${state.runs.length}` : ''}`}
            </button>
          ))}
        </div>
      </div>

      {tab === 'chat' ? (
        <div ref={scrollRef} className={styles.messageList}>
          {state.messages.map((m) => (
            <MessageItem key={m.id} message={m} onOpenTrace={() => setTab('trace')} />
          ))}
          {state.busy && (
            <div className={styles.busyRow}>
              <span className={styles.busyDot} />
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
