import { useApp } from '@/store/AppStore';

export default function Toast() {
  const { state } = useApp();
  if (!state.toast) return null;
  return (
    <div
      role="status"
      className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-[10px] bg-ink px-[18px] py-3 font-medium text-white shadow-[0_8px_24px_rgba(23,25,30,0.25)]"
    >
      {state.toast}
    </div>
  );
}
