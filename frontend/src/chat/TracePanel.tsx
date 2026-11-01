import type { RunStatus, StepStatus } from '@/types';
import { useApp } from '@/store/AppStore';
import { cx } from '@/lib/format';

const RUN_PILL: Record<RunStatus, { label: string; className: string }> = {
  running: { label: 'Running', className: 'bg-chip text-muted' },
  waiting: { label: 'Waiting on you', className: 'bg-accent-soft text-accent-dark' },
  done: { label: 'Done', className: 'bg-ok-soft text-ok-text' },
  recovered: { label: 'Recovered', className: 'bg-warn-soft text-warn-text' },
  stopped: { label: 'Stopped', className: 'bg-chip text-muted' },
};

const STEP_ICON: Record<StepStatus, { glyph: string; className: string }> = {
  ok: { glyph: '✓', className: 'text-ok' },
  waiting: { glyph: '●', className: 'text-accent' },
  failed: { glyph: '✕', className: 'text-danger' },
};

/** Workflow execution dashboard: every request, intent, tool call, approval and error. */
export default function TracePanel() {
  const { state } = useApp();

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
      {state.runs.length === 0 && (
        <p className="text-muted">
          Every request you send shows up here: the workflow Ask Seated picked, each tool it ran, approvals and errors.
        </p>
      )}
      {state.runs.map((run) => {
        const pill = RUN_PILL[run.status];
        return (
          <section key={run.id} className="flex flex-col overflow-hidden rounded-xl border border-line">
            <div className="flex items-center justify-between gap-2 border-b border-line bg-panel px-3 py-2.5">
              <div className="flex min-w-0 flex-col">
                <span className="font-mono text-xs font-medium">{run.workflow}</span>
                <span className="text-xs text-muted">{run.title}</span>
              </div>
              <span className={cx('whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-semibold', pill.className)}>
                {pill.label}
              </span>
            </div>
            <ol className="flex flex-col gap-1 px-3 py-2 font-mono text-xs">
              {run.steps.map((st, i) => {
                const icon = STEP_ICON[st.status];
                return (
                  <li key={i} className="flex flex-col gap-px py-0.5">
                    <div className="flex items-center gap-2.5">
                      <span className={cx('w-3.5 text-center font-bold', icon.className)}>{icon.glyph}</span>
                      <span
                        className={cx(
                          'flex-1',
                          st.status === 'failed' && 'text-danger',
                          st.status === 'waiting' && 'font-medium text-accent',
                        )}
                      >
                        {st.name}
                      </span>
                      {st.durationMs !== undefined && (
                        <span className="text-muted">{(st.durationMs / 1000).toFixed(1)}s</span>
                      )}
                    </div>
                    {st.detail && <span className="break-words pl-6 text-[11px] text-muted">{st.detail}</span>}
                  </li>
                );
              })}
            </ol>
          </section>
        );
      })}
    </div>
  );
}
