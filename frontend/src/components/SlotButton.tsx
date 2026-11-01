import { cx } from '@/lib/format';

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
        'h-[34px] rounded-lg px-3 text-[13px] font-medium transition-colors disabled:cursor-default',
        selected
          ? 'border border-ink bg-ink text-white'
          : hinted
            ? 'border-[1.5px] border-ink bg-white text-ink'
            : 'border border-line bg-white text-ink hover:border-ink',
      )}
    >
      {time}
    </button>
  );
}
