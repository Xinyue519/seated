import { cx } from '@/lib/format';
import styles from './components.module.css';

interface Props {
  time: string;
  selected?: boolean;
  hinted?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

export default function SlotButton({ time, selected, hinted, disabled, onClick }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cx(
        styles.slotButton,
        selected ? styles.slotButtonSelected : hinted ? styles.slotButtonHinted : styles.slotButtonDefault,
      )}
    >
      {time}
    </button>
  );
}
