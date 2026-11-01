import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 16, ...rest }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    ...rest,
  };
}

/** Side-view chair: the Seated mark. */
export const ChairIcon = (p: IconProps) => (
  <svg {...base(p)} strokeWidth={2.2}>
    <path d="M7 3v18M7 13h10v8M7 8h5" />
  </svg>
);
export const PlusIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);
export const MinusIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M5 12h14" />
  </svg>
);
export const CloseIcon = (p: IconProps) => (
  <svg {...base(p)} strokeWidth={2.2}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);
export const SendIcon = (p: IconProps) => (
  <svg {...base(p)} strokeWidth={2.2}>
    <path d="M12 19V5M5 12l7-7 7 7" />
  </svg>
);
export const CheckIcon = (p: IconProps) => (
  <svg {...base(p)} strokeWidth={3}>
    <path d="M5 12l5 5L19 7" />
  </svg>
);
export const BookmarkIcon = ({ filled, ...p }: IconProps & { filled?: boolean }) => (
  <svg {...base(p)} fill={filled ? 'currentColor' : 'none'}>
    <path d="M6 3h12v18l-6-4-6 4z" />
  </svg>
);
export const ThumbUpIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M7 11v9H4v-9zM7 11l4-8a2 2 0 0 1 2 2v4h6a2 2 0 0 1 2 2l-2 7a2 2 0 0 1-2 2H7" />
  </svg>
);
export const ThumbDownIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M17 13V4h3v9zM17 13l-4 8a2 2 0 0 1-2-2v-4H5a2 2 0 0 1-2-2l2-7a2 2 0 0 1 2-2h10" />
  </svg>
);
