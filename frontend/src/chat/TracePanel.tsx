import type { RunStatus, StepStatus } from '@/types';
import { useApp } from '@/store/AppStore';
import { cx } from '@/lib/format';
import styles from './chat.module.css';

const RUN_PILL: Record<RunStatus, { label: string; className: string }> = {
  running: { label: 'Running', className: styles.pillNeutral },
  waiting: { label: 'Waiting on you', className: styles.pillWaiting },
  done: { label: 'Done', className: styles.pillDone },
  recovered: { label: 'Recovered', className: styles.pillRecovered },
  stopped: { label: 'Stopped', className: styles.pillNeutral },
};

const STEP_ICON: Record<StepStatus, { glyph: string; className: string }> = {
  ok: { glyph: '✓', className: styles.stepIconOk },
  waiting: { glyph: '●', className: styles.stepIconWaiting },
  failed: { glyph: '✕', className: styles.stepIconFailed },
};

/** Workflow execution dashboard: every request, intent, tool call, approval and error. */
export default function TracePanel() {
  const { state } = useApp();

  return (
    <div className={styles.tracePanel}>
      {state.runs.length === 0 && (
        <p className={styles.emptyText}>
          Every request you send shows up here: the workflow Ask Seated picked, each tool it ran, approvals and errors.
        </p>
      )}
      {state.runs.map((run) => {
        const pill = RUN_PILL[run.status];
        return (
          <section key={run.id} className={styles.runCard}>
            <div className={styles.runHeader}>
              <div className={styles.runTitles}>
                <span className={styles.runWorkflowName}>{run.workflow}</span>
                <span className={styles.runTitleText}>{run.title}</span>
              </div>
              <span className={cx(styles.statusPill, pill.className)}>{pill.label}</span>
            </div>
            <ol className={styles.stepsList}>
              {run.steps.map((st, i) => {
                const icon = STEP_ICON[st.status];
                return (
                  <li key={i} className={styles.stepItem}>
                    <div className={styles.stepRow}>
                      <span className={cx(styles.stepIcon, icon.className)}>{icon.glyph}</span>
                      <span
                        className={cx(
                          styles.stepName,
                          st.status === 'failed' && styles.stepNameFailed,
                          st.status === 'waiting' && styles.stepNameWaiting,
                        )}
                      >
                        {st.name}
                      </span>
                      {st.durationMs !== undefined && (
                        <span className={styles.stepDuration}>{(st.durationMs / 1000).toFixed(1)}s</span>
                      )}
                    </div>
                    {st.detail && <span className={styles.stepDetail}>{st.detail}</span>}
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
