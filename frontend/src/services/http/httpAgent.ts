import type { StoreApi } from '@/store/AppStore';
import type { ChatMessage, WorkflowRun } from '@/types';
import { uid } from '@/lib/format';
import type { AgentClient, AgentTurn } from '../types';
import { request } from './client';

/**
 * Agent client for the Go orchestrator. Each call returns an `AgentTurn`
 * that gets merged into the store. (Can move to streaming/SSE later so the
 * trace fills in step by step.)
 */
export class HttpAgent implements AgentClient {
  constructor(private store: StoreApi) {}

  async send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || this.store.get().busy) return;
    this.store.set((s) => ({ messages: [...s.messages, { id: uid('msg'), role: 'user', text: trimmed }] }));
    await this.turn('/agent/messages', { text: trimmed, context: this.store.get().context });
  }

  async pickSlot(restaurantId: string, time: string, date: string) {
    await this.turn('/agent/actions', { type: 'pick_slot', restaurantId, time, date });
  }

  async confirm(messageId: string) {
    await this.turn('/agent/actions', { type: 'confirm', messageId });
  }

  async decline(messageId: string) {
    await this.turn('/agent/actions', { type: 'decline', messageId });
  }

  async cancelReservation(reservationId: string) {
    await this.turn(`/reservations/${encodeURIComponent(reservationId)}/cancel`, {});
  }

  private async turn(path: string, body: unknown) {
    this.store.set({ busy: true, busyLabel: 'Working…' });
    try {
      const res = await request<AgentTurn>('POST', path, body);
      this.store.set((s) => ({
        messages: mergeById(s.messages, res.messages),
        runs: res.runs ? mergeById(s.runs, res.runs, true) : s.runs,
        mapFilter: res.mapFilter !== undefined ? res.mapFilter : s.mapFilter,
        reservations: res.reservations ?? s.reservations,
        availabilityVersion: s.availabilityVersion + 1,
      }));
    } catch (err) {
      this.store.set((s) => ({
        messages: [
          ...s.messages,
          { id: uid('msg'), role: 'agent', text: `Sorry, I couldn't reach Seated just now (${(err as Error).message}). Try again in a moment.` },
        ],
      }));
    } finally {
      this.store.set({ busy: false, busyLabel: '' });
    }
  }
}

/** Replace items that already exist (same id), append the rest. */
function mergeById<T extends ChatMessage | WorkflowRun>(current: T[], incoming: T[], prepend = false): T[] {
  const updated = current.map((x) => incoming.find((y) => y.id === x.id) ?? x);
  const fresh = incoming.filter((x) => !current.some((c) => c.id === x.id));
  return prepend ? [...fresh, ...updated] : [...updated, ...fresh];
}
