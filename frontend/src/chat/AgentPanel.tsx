import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useApp } from '@/store/AppStore';
import { formatDay, resolveDay } from '@/lib/dates';
import { cx, guests } from '@/lib/format';
import MessageItem from './MessageItem';
import TracePanel from './TracePanel';
import Composer from './Composer';
import styles from './chat.module.css';

type Tab = 'chat' | 'trace';

const WIDTH_KEY = 'seated:chat-panel-width';
const DEFAULT_WIDTH = 400;
const MIN_WIDTH = 320;
const MAX_WIDTH = 720;
// Leave the map at least this wide, even on a narrower desktop window.
const MIN_MAP_WIDTH = 420;

function readStoredWidth(): number {
  try {
    const raw = Number(localStorage.getItem(WIDTH_KEY));
    return raw >= MIN_WIDTH && raw <= MAX_WIDTH ? raw : DEFAULT_WIDTH;
  } catch {
    return DEFAULT_WIDTH;
  }
}

export default function AgentPanel() {
  const { state } = useApp();
  const [tab, setTab] = useState<Tab>('chat');
  const scrollRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(readStoredWidth);
  const [isDesktop, setIsDesktop] = useState(() => window.matchMedia('(min-width: 768px)').matches);
  const dragRef = useRef<{ x: number; width: number } | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [state.messages.length, state.busy, tab]);

  useEffect(() => {
    const mql = window.matchMedia('(min-width: 768px)');
    const onChange = () => setIsDesktop(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  const handleResizeStart = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    dragRef.current = { x: e.clientX, width };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const handleResizeMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    // Dragging the left edge left grows the panel; dragging it right shrinks it.
    const dx = e.clientX - drag.x;
    const maxWidth = Math.min(MAX_WIDTH, window.innerWidth - MIN_MAP_WIDTH);
    const next = Math.round(Math.min(maxWidth, Math.max(MIN_WIDTH, drag.width - dx)));
    setWidth(next);
  };
  const handleResizeEnd = () => {
    if (!dragRef.current) return;
    dragRef.current = null;
    try {
      localStorage.setItem(WIDTH_KEY, String(width));
    } catch {
      // ignore (e.g. storage disabled)
    }
  };

  const ctx = state.context;
  const subtitle =
    [ctx.day ? formatDay(resolveDay(ctx.day)) : null, ctx.neighborhood, ctx.partySize ? guests(ctx.partySize) : null]
      .filter(Boolean)
      .join(' · ') || 'Your dining agent';

  return (
    <aside
      aria-label="Ask Seated"
      className={styles.panel}
      style={isDesktop ? { flex: `0 0 ${width}px`, width } : undefined}
    >
      {isDesktop && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize Ask Seated panel"
          className={styles.resizeHandle}
          onPointerDown={handleResizeStart}
          onPointerMove={handleResizeMove}
          onPointerUp={handleResizeEnd}
          onPointerCancel={handleResizeEnd}
        />
      )}
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
