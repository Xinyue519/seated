import { useNavigate } from 'react-router-dom';
import type { ChatMessage } from '@/types';
import { todayISO } from '@/lib/dates';
import { cx } from '@/lib/format';
import { CheckIcon } from '@/components/icons';
import common from '@/styles/common.module.css';
import styles from './chat.module.css';
import ResultCard from './ResultCard';
import ConfirmCard from './ConfirmCard';

interface Props {
  message: ChatMessage;
  onOpenTrace: () => void;
}

export default function MessageItem({ message: m, onOpenTrace }: Props) {
  const navigate = useNavigate();

  if (m.role === 'user') {
    return <div className={styles.userBubble}>{m.text}</div>;
  }

  return (
    <div className={styles.agentMessage}>
      {m.chips && m.chips.length > 0 && (
        <div className={styles.chipRow}>
          {m.chips.map((c, i) => (
            <span key={i} className={cx(styles.chip, c.missing ? styles.chipMissing : styles.chipFilled)}>
              {c.label}
            </span>
          ))}
        </div>
      )}
      {m.toolsSummary && (
        <button type="button" onClick={onOpenTrace} className={styles.toolsSummaryButton}>
          <CheckIcon size={12} className={m.toolsTone === 'warn' ? styles.toolsIconWarn : styles.toolsIconOk} />
          {m.toolsSummary}
        </button>
      )}
      {m.text && <p className={styles.messageText}>{m.text}</p>}
      {m.results && m.results.length > 0 && (
        <div className={styles.resultsList}>
          {m.results.map((item, i) => (
            <ResultCard key={item.restaurantId} item={item} index={i} date={m.resultsDate ?? todayISO()} />
          ))}
        </div>
      )}
      {m.confirm && <ConfirmCard messageId={m.id} request={m.confirm} />}
      {m.action === 'reservations' && (
        <button
          type="button"
          onClick={() => navigate('/reservations')}
          className={cx(common.btnOutline, styles.viewReservationsButton)}
        >
          View reservations
        </button>
      )}
      {m.followUp && <p>{m.followUp}</p>}
    </div>
  );
}
