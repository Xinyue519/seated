import { ChairIcon } from './icons';
import { cx } from '@/lib/format';
import styles from './components.module.css';

export default function Logo({ large = false }: { large?: boolean }) {
  return (
    <span className={cx(styles.logo, large ? styles.logoLarge : styles.logoSmall)}>
      <span className={cx(styles.logoBadge, large ? styles.logoBadgeLarge : styles.logoBadgeSmall)}>
        <ChairIcon size={large ? 16 : 14} />
      </span>
      Seated
    </span>
  );
}
