import type { CSSProperties } from 'react';

/**
 * Stylized downtown Manhattan backdrop. Placeholder for Google Maps
 * (Maps JavaScript API with a custom style that hides Google's own POIs).
 */
export default function MapBackground({ style }: { style?: CSSProperties }) {
  return (
    <svg
      viewBox="0 0 1000 844"
      preserveAspectRatio="none"
      className="absolute inset-0 h-full w-full transition-transform duration-300 ease-out"
      style={style}
      aria-hidden="true"
    >
      <rect width="1000" height="844" fill="#ECEAE4" />
      <path d="M0 0 H95 L88 300 L80 560 L66 844 H0 Z" fill="#CBDAE2" />
      <rect x="545" y="300" width="70" height="60" rx="6" fill="#D5E2CC" />
      <g stroke="#FFFFFF" strokeWidth="9" fill="none" strokeLinecap="round">
        <path d="M95 40 L1000 120" />
        <path d="M92 180 L1000 260" />
        <path d="M88 320 L1000 400" />
        <path d="M84 470 L1000 540" />
        <path d="M78 610 L1000 690" />
        <path d="M70 760 L1000 840" />
        <path d="M260 0 L200 844" />
        <path d="M420 0 L380 844" />
        <path d="M590 0 L560 844" />
        <path d="M780 0 L760 844" />
        <path d="M930 0 L920 844" />
      </g>
      <g stroke="#FFFFFF" strokeWidth="5" fill="none">
        <path d="M160 100 L520 640" />
        <path d="M330 60 L650 420" />
        <path d="M470 300 L900 760" />
        <path d="M120 400 L420 844" />
      </g>
      <path d="M95 0 L88 300 L80 560 L66 844" stroke="#F7F5F0" strokeWidth="14" fill="none" />
    </svg>
  );
}
