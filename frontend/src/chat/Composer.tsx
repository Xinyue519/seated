import { useState, type FormEvent } from 'react';
import { useApp } from '@/store/AppStore';
import { SendIcon } from '@/components/icons';
import { getSuggestions } from './suggestions';
import styles from './chat.module.css';

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
    <form onSubmit={submit} className={styles.form}>
      <div className={styles.suggestions}>
        {getSuggestions(state).map((label) => (
          <button
            key={label}
            type="button"
            onClick={() => send(label)}
            disabled={state.busy}
            className={styles.suggestionButton}
          >
            {label}
          </button>
        ))}
      </div>
      <div className={styles.inputRow}>
        <label htmlFor="ask-seated" className={styles.srOnly}>
          Ask Seated
        </label>
        <input
          id="ask-seated"
          autoComplete="off"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Ask for a table, change or cancel a booking…"
          className={styles.input}
        />
        <button type="submit" aria-label="Send" disabled={state.busy || !draft.trim()} className={styles.sendButton}>
          <SendIcon />
        </button>
      </div>
    </form>
  );
}
