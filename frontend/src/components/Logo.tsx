import { ChairIcon } from './icons';
import { cx } from '@/lib/format';

export default function Logo({ large = false }: { large?: boolean }) {
  return (
    <span className={cx('flex items-center gap-2 font-bold tracking-[-0.01em]', large ? 'text-[18px]' : 'text-[16px]')}>
      <span
        className={cx(
          'flex items-center justify-center bg-ink text-white',
          large ? 'h-7 w-7 rounded-[7px]' : 'h-6 w-6 rounded-md',
        )}
      >
        <ChairIcon size={large ? 16 : 14} />
      </span>
      Seated
    </span>
  );
}
