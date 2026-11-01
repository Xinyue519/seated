import { useState, type FormEvent } from 'react';
import { useApp } from '@/store/AppStore';
import { SendIcon } from '@/components/icons';
import { getSuggestions } from './suggestions';

export default function Composer({ onSent }: { onSent?: () => void }) {
  const { state, agent } = useApp();
  const [draft, setDraft] = useState('');

  const send = (text: string) => {
    if (!text.trim() || state.busy) return;
    setDraft('');
    onSent?.();
    void agent.send(text);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    send(draft);
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-2 border-t border-line px-4 pb-4 pt-3">
      <div className="flex flex-wrap gap-1.5">
        {getSuggestions(state).map((label) => (
          <button
            key={label}
            type="button"
            onClick={() => send(label)}
            disabled={state.busy}
            className="min-h-8 rounded-full border border-line bg-white px-3 py-1 text-left text-[13px] hover:border-line2"
          >
            {label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2 rounded-xl border border-line2 py-1.5 pl-3.5 pr-1.5 focus-within:border-ink">
        <label htmlFor="ask-seated" className="sr-only">
          Ask Seated
        </label>
        <input
          id="ask-seated"
          autoComplete="off"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Ask for a table, change or cancel a booking…"
          className="h-8 min-w-0 flex-1 bg-transparent outline-none"
        />
        <button
          type="submit"
          aria-label="Send"
          disabled={state.busy || !draft.trim()}
          className="flex h-9 w-9 items-center justify-center rounded-[9px] bg-ink text-white disabled:opacity-40"
        >
          <SendIcon />
        </button>
      </div>
    </form>
  );
}
