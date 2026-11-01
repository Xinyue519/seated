import type {
  ChatMessage,
  Chip,
  ConfirmRequest,
  ConversationContext,
  Entities,
  PendingBooking,
  PriceLevel,
  RankedResult,
  Reservation,
  RunStatus,
  TraceStep,
} from '@/types';
import type { StoreApi } from '@/store/AppStore';
import { CUISINE_LABELS, getRestaurant } from '@/data/restaurants';
import { dayPhrase, formatDay, resolveDay, sleep, todayISO } from '@/lib/dates';
import { guests, price, uid } from '@/lib/format';
import type { AgentClient } from '@/services/types';
import { getSlots, idempotencyKey, releaseSlot, takeSlot } from '../provider';
import { classifyIntent, parseMessage } from './parse';
import { rankRestaurants } from './rank';

interface StepSpec {
  name: string;
  status?: TraceStep['status'];
  detail?: string;
}

/**
 * Front-end stand-in for the Go "Restaurant Concierge" orchestrator.
 *
 * It keeps the same shape the real system will have: classify intent → run
 * tools (each recorded as a workflow step) → ask for missing info or approval
 * → execute → record the result. Swap `send()` for a call to the backend's
 * streaming endpoint once it exists; the UI only reads the store.
 */
export class MockAgent implements AgentClient {
  private busy = false;
  private activeRunId: string | null = null;

  constructor(private store: StoreApi) {}

  /* ------------------------------------------------------------------ */
  /* Public API used by the UI                                            */
  /* ------------------------------------------------------------------ */

  async send(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed || this.busy) return;
    this.pushUser(trimmed);
    await sleep(120);
    await this.handle(trimmed);
  }

  async pickSlot(restaurantId: string, time: string, date: string, silent = false): Promise<void> {
    if (this.busy) return;
    const { pending, context } = this.store.get();
    const r = getRestaurant(restaurantId);
    if (!silent) this.pushUser(`${time} at ${r.name}`);
    const sameRestaurant = pending?.restaurantId === restaurantId;
    const next: PendingBooking = {
      restaurantId,
      date,
      time,
      partySize: (sameRestaurant ? pending?.partySize : undefined) ?? context.partySize,
      modifyId: sameRestaurant ? pending?.modifyId : undefined,
    };
    this.store.set({ pending: next, selectedId: restaurantId });
    await sleep(100);
    await this.advanceBooking();
  }

  async confirm(messageId: string): Promise<void> {
    if (this.busy) return;
    const msg = this.store.get().messages.find((m) => m.id === messageId);
    const c = msg?.confirm;
    if (!c || c.state !== 'open') return;
    this.patchConfirm(messageId, { state: 'working' });
    const r = getRestaurant(c.restaurantId);

    if (c.kind === 'cancel') {
      await this.runSteps(c.runId, [
        { name: 'cancel_reservation', detail: `reservation ${c.reservationId} · user approved` },
        { name: 'notify_user', detail: 'cancellation email queued' },
      ]);
      this.setRunStatus(c.runId, 'done');
      this.setReservationStatus(c.reservationId!, 'cancelled');
      releaseSlot(c.restaurantId, c.date, c.time);
      this.bumpAvailability();
      this.patchConfirm(messageId, { state: 'done' });
      this.pushAgent({ text: `Done. Your ${r.name} reservation is cancelled.`, action: 'reservations' });
      return;
    }

    const failNow = r.flakyBooking && !this.flakyUsed;
    const tool = c.kind === 'modify' ? 'modify_reservation' : 'create_reservation';
    const steps: StepSpec[] = [
      failNow
        ? { name: tool, status: 'failed', detail: 'SLOT_TAKEN from provider · idempotency key kept · not retried' }
        : { name: tool, detail: `idempotency_key=${idempotencyKey(r.id, c.date, c.time)} · status=confirmed` },
    ];
    if (!failNow) steps.push({ name: 'save_booking', detail: 'saved to your account' });
    await this.runSteps(c.runId, steps);

    if (failNow) {
      this.flakyUsed = true;
      takeSlot(r.id, c.date, c.time);
      this.bumpAvailability();
      this.patchConfirm(messageId, { state: 'failed' });
      this.setRunStatus(c.runId, 'recovered');
      this.pushAgent({
        text: 'That table was taken by someone else just as I tried to book it. Nothing was booked. Here are the other open times:',
        results: [{ restaurantId: r.id, reasons: [] }],
        resultsDate: c.date,
        toolsSummary: `${tool} failed · recovered`,
        toolsTone: 'warn',
      });
      return;
    }

    this.setRunStatus(c.runId, 'done');
    takeSlot(r.id, c.date, c.time);
    if (c.kind === 'modify') {
      const old = this.store.get().reservations.find((x) => x.id === c.reservationId);
      if (old) releaseSlot(old.restaurantId, old.date, old.time);
    }
    this.store.set((s) => {
      let reservations: Reservation[];
      if (c.kind === 'modify') {
        reservations = s.reservations.map((x) =>
          x.id === c.reservationId ? { ...x, date: c.date, time: c.time, partySize: c.partySize } : x,
        );
      } else {
        reservations = [
          ...s.reservations,
          { id: uid('res'), restaurantId: r.id, date: c.date, time: c.time, partySize: c.partySize, status: 'confirmed', bookedBy: 'agent' },
        ];
      }
      return { reservations, pending: null, availabilityVersion: s.availabilityVersion + 1 };
    });
    this.patchConfirm(messageId, { state: 'done' });
    this.pushAgent({
      text: `${c.kind === 'modify' ? 'Updated.' : "You're booked."} ${r.name} ${dayPhrase(c.date)} at ${c.time} for ${c.partySize}. A confirmation is on its way to ${this.store.get().user.email}.`,
      action: 'reservations',
    });
  }

  async decline(messageId: string): Promise<void> {
    if (this.busy) return;
    const c = this.store.get().messages.find((m) => m.id === messageId)?.confirm;
    if (!c || c.state !== 'open') return;
    this.patchConfirm(messageId, { state: 'declined' });
    this.setRunStatus(c.runId, 'stopped');
    this.store.set({ pending: null });
    this.pushAgent({
      text: c.kind === 'cancel' ? "OK, I'll keep the reservation." : 'No problem, nothing was booked. Pick another time, or tell me what to change.',
    });
  }

  /** Cancellation approved directly from the Reservations page (no chat turn). */
  async cancelReservation(reservationId: string): Promise<void> {
    const res = this.store.get().reservations.find((x) => x.id === reservationId);
    if (!res) return;
    const r = getRestaurant(res.restaurantId);
    const runId = this.newRun('reservation_cancellation', `Cancel ${r.name} (from Reservations)`);
    await this.runSteps(runId, [
      { name: 'verify_ownership', detail: 'user_id from session ✓' },
      { name: 'request_user_confirmation', detail: 'approved on Reservations page' },
      { name: 'cancel_reservation', detail: `reservation ${res.id}` },
    ]);
    this.setRunStatus(runId, 'done');
    this.setReservationStatus(res.id, 'cancelled');
    releaseSlot(res.restaurantId, res.date, res.time);
    this.bumpAvailability();
  }

  /* ------------------------------------------------------------------ */
  /* Orchestration                                                       */
  /* ------------------------------------------------------------------ */

  private flakyUsed = false;

  private async handle(text: string): Promise<void> {
    const e = parseMessage(text);
    const s = this.store.get();
    const context: ConversationContext = { ...s.context };
    if (e.day) context.day = e.day;
    if (e.partySize) context.partySize = e.partySize;
    if (e.time) context.time = e.time;
    if (e.neighborhood) context.neighborhood = e.neighborhood;
    this.store.set({ context });

    // Follow-up answers to an in-progress booking ("4 people", "8:15").
    if (
      s.pending &&
      !e.cuisine &&
      !e.neighborhood &&
      !(e.reference && e.reference.id !== s.pending.restaurantId) &&
      (e.partySize || e.time)
    ) {
      this.store.set({
        pending: { ...s.pending, partySize: e.partySize ?? s.pending.partySize, time: e.time ?? s.pending.time },
      });
      return this.advanceBooking();
    }

    switch (classifyIntent(e, !!s.lastSearch)) {
      case 'cancel':
        return this.startCancel(e);
      case 'modify':
        return this.startModify(e);
      case 'list_reservations':
        return this.listReservations();
      case 'more':
        return this.showMore();
      case 'cheaper': {
        const last = s.lastSearch!;
        return this.discover(
          { ...last.query, maxPrice: Math.max(1, last.minShownPrice - 1) as PriceLevel, minPrice: undefined },
          'Something cheaper',
        );
      }
      case 'book':
        return this.bookRestaurant(e);
      case 'discover':
        return this.discover(e);
      default: {
        const runId = this.newRun('clarify', text);
        await this.runSteps(runId, [{ name: 'classify_intent', detail: 'intent=unknown · confidence low' }]);
        this.setRunStatus(runId, 'done');
        this.pushAgent({
          text: 'I can find restaurants, book a table, change a booking or cancel one. What are you in the mood for, and roughly where?',
          toolsSummary: 'classify_intent',
        });
      }
    }
  }

  private date(): string {
    return resolveDay(this.store.get().context.day);
  }

  private rank(query: Entities): RankedResult[] {
    const s = this.store.get();
    return rankRestaurants({ query, preferences: s.preferences, saved: s.saved, visited: s.visited, date: this.date() });
  }

  private slots(restaurantId: string, date: string): string[] {
    return getSlots(getRestaurant(restaurantId), date);
  }

  private async discover(e: Entities, title = 'Find a table'): Promise<void> {
    const s = this.store.get();
    const ctx = s.context;
    const date = this.date();
    let ranked = this.rank(e);
    let relaxed = false;
    if (!ranked.length) {
      relaxed = true;
      ranked = this.rank({ raw: e.raw, reference: e.reference, similar: e.similar, neighborhood: e.neighborhood });
    }
    const top = ranked.slice(0, 3);

    const chips: Chip[] = [{ label: `${ctx.day ? '' : 'Assumed: '}${formatDay(date)}` }];
    if (e.reference && e.similar) chips.push({ label: `Like ${e.reference.name}` });
    if (e.likeSaved) chips.push({ label: 'Like your saved places' });
    if (e.onlySaved) chips.push({ label: 'From your saved list' });
    if (e.cuisine) chips.push({ label: CUISINE_LABELS[e.cuisine] });
    if (ctx.neighborhood) chips.push({ label: ctx.neighborhood });
    if (e.maxPrice) chips.push({ label: `Up to ${price(e.maxPrice)}` });
    if (e.minPrice) chips.push({ label: `${price(e.minPrice)}+` });
    if (e.vegetarian) chips.push({ label: 'Vegetarian-friendly' });
    if (e.excludeSaved) chips.push({ label: 'Not in saved' });
    if (ctx.time) chips.push({ label: `Around ${ctx.time}` });
    chips.push(ctx.partySize ? { label: guests(ctx.partySize) } : { label: 'Party size?', missing: true });

    const similar = e.similar || e.likeSaved;
    const runId = this.newRun(similar ? 'similar_restaurants' : 'restaurant_discovery', title);
    const steps: StepSpec[] = [
      { name: 'extract_intent', detail: `entities: ${chips.map((c) => c.label).join(' · ')}` },
      { name: 'get_user_preferences', detail: `${s.saved.length} saved · prefers ${s.preferences.cuisines.join(', ') || 'anything'}` },
    ];
    if (e.reference) steps.push({ name: 'get_restaurant_details', detail: `${e.reference.name} · ${e.reference.cuisine} · ${price(e.reference.priceLevel)}` });
    steps.push({
      name: similar ? 'find_similar_restaurants' : 'search_restaurants',
      detail: `${ranked.length} candidates${relaxed ? ' (filters relaxed)' : ''}`,
    });
    steps.push({
      name: 'check_availability',
      detail: `${formatDay(date)} · ${top.map((x) => `${getRestaurant(x.restaurantId).name}: ${this.slots(x.restaurantId, date).length} slots`).join(', ')}`,
    });
    await this.runSteps(runId, steps);
    this.setRunStatus(runId, 'done');

    const n = top.length;
    const text = relaxed
      ? 'Nothing matched every constraint, so I loosened the filters. Here are the closest options.'
      : `Here ${n === 1 ? 'is 1 spot' : `are ${n} spots`}${e.cuisine ? ` for ${CUISINE_LABELS[e.cuisine]}` : ''}${
          ctx.neighborhood ? ` in or near ${ctx.neighborhood}` : ''
        }${e.reference && e.similar ? ` with a similar feel to ${e.reference.name}` : ''}.${
          e.excludeSaved ? " None are places you've saved or been to." : ''
        }`;

    this.pushAgent({
      text,
      chips,
      toolsSummary: `${steps.length} tools · ${steps.slice(1, 3).map((x) => x.name).join(', ')}…`,
      results: top.map((x) => ({ restaurantId: x.restaurantId, reasons: x.reasons })),
      resultsDate: date,
      followUp: ctx.partySize ? 'Pick a time to book.' : 'How many people, and which time works?',
    });
    this.store.set({
      mapFilter: top.map((x) => x.restaurantId),
      selectedId: null,
      pending: null,
      lastSearch: {
        query: e,
        ranked,
        offset: 3,
        minShownPrice: Math.min(4, ...top.map((x) => getRestaurant(x.restaurantId).priceLevel)) as PriceLevel,
      },
    });
  }

  private async showMore(): Promise<void> {
    const last = this.store.get().lastSearch!;
    const date = this.date();
    const next = last.ranked.slice(last.offset, last.offset + 3);
    const runId = this.newRun('restaurant_discovery', 'More options');
    await this.runSteps(runId, [
      { name: 'search_restaurants', detail: `page ${last.offset / 3 + 1}` },
      { name: 'check_availability', detail: `${next.length} restaurants` },
    ]);
    this.setRunStatus(runId, 'done');
    if (!next.length) {
      this.pushAgent({ text: "That's everything that fits. Want me to widen the area or try another cuisine?" });
      return;
    }
    this.pushAgent({
      text: 'A few more:',
      results: next.map((x) => ({ restaurantId: x.restaurantId, reasons: x.reasons })),
      resultsDate: date,
      toolsSummary: '2 tools · search_restaurants, check_availability',
    });
    this.store.set({ mapFilter: next.map((x) => x.restaurantId), lastSearch: { ...last, offset: last.offset + 3 } });
  }

  private async bookRestaurant(e: Entities): Promise<void> {
    const r = e.reference!;
    const ctx = this.store.get().context;
    const date = this.date();
    const slots = this.slots(r.id, date);
    const runId = this.newRun('restaurant_reservation', `Book ${r.name}`);
    const steps: StepSpec[] = [
      {
        name: 'extract_reservation_details',
        detail: `${r.name} · ${formatDay(date)}${ctx.time ? ` · ${ctx.time}` : ''}${ctx.partySize ? ` · ${guests(ctx.partySize)}` : ' · party size missing'}`,
      },
      slots.length
        ? { name: 'check_availability', detail: `${slots.length} open slots` }
        : { name: 'check_availability', status: 'failed', detail: `NO_AVAILABILITY · ${formatDay(date)}` },
    ];

    if (!slots.length) {
      // Fallback chain from the build plan: other times → similar restaurants.
      const alternatives = this.rank({ raw: e.raw, reference: r, similar: true, neighborhood: r.neighborhood })
        .filter((x) => this.slots(x.restaurantId, date).length)
        .slice(0, 3);
      steps.push({ name: 'check_availability', status: 'failed', detail: `other times ${formatDay(date)}: none` });
      steps.push({ name: 'find_similar_restaurants', detail: alternatives.map((x) => getRestaurant(x.restaurantId).name).join(', ') });
      await this.runSteps(runId, steps);
      this.setRunStatus(runId, 'recovered');
      this.pushAgent({
        text: `${r.name} has no tables ${dayPhrase(date)}, and I checked other times that day too. Here are similar places that do have tables:`,
        toolsSummary: `${steps.length} tools · 1 fallback`,
        toolsTone: 'warn',
        results: alternatives.map((x) => ({ restaurantId: x.restaurantId, reasons: x.reasons })),
        resultsDate: date,
      });
      this.store.set({ mapFilter: [...alternatives.map((x) => x.restaurantId), r.id], selectedId: null });
      return;
    }

    await this.runSteps(runId, steps);
    this.setRunStatus(runId, 'done');
    this.store.set({ mapFilter: [r.id], selectedId: r.id });
    if (ctx.time && slots.includes(ctx.time)) {
      await this.pickSlot(r.id, ctx.time, date, true);
      return;
    }
    this.pushAgent({
      text: ctx.time ? `${ctx.time} isn't open, but here's what ${r.name} has:` : `Here are the open times at ${r.name}:`,
      results: [{ restaurantId: r.id, reasons: [] }],
      resultsDate: date,
      toolsSummary: '2 tools · check_availability',
    });
  }

  private async advanceBooking(): Promise<void> {
    const p = this.store.get().pending;
    if (!p) return;
    const r = getRestaurant(p.restaurantId);

    if (!p.time) {
      this.pushAgent({ text: 'Which time works? Pick one of the slots above.' });
      return;
    }

    if (!p.partySize) {
      const runId = this.newRun('restaurant_reservation', `Book ${r.name}`);
      this.activeRunId = runId;
      await this.runSteps(runId, [{ name: 'extract_reservation_details', detail: 'missing: party_size' }]);
      this.setRunStatus(runId, 'waiting');
      this.pushAgent({
        text: 'How many people should I book for?',
        chips: [{ label: r.name }, { label: formatDay(p.date) }, { label: p.time }, { label: 'Party size?', missing: true }],
      });
      return;
    }

    // Reuse the run that was paused waiting on party size, otherwise start a new one.
    const waitingRun = this.store.get().runs.find((x) => x.id === this.activeRunId && x.status === 'waiting');
    const runId = waitingRun?.id ?? this.newRun(p.modifyId ? 'reservation_modification' : 'restaurant_reservation', `${p.modifyId ? 'Move' : 'Book'} ${r.name}`);
    this.activeRunId = runId;
    this.setRunStatus(runId, 'running');

    if (!this.slots(r.id, p.date).includes(p.time)) {
      await this.runSteps(runId, [{ name: 'check_availability', status: 'failed', detail: `${p.time} not available` }]);
      this.pushAgent({ text: `${p.time} isn't available at ${r.name}. Open times:`, results: [{ restaurantId: r.id, reasons: [] }], resultsDate: p.date });
      return;
    }

    await this.runSteps(runId, [
      { name: 'check_availability', detail: `${r.name} · ${p.time} · ${guests(p.partySize)} · slot held 5 min` },
      { name: 'request_user_confirmation', status: 'waiting', detail: 'awaiting user approval' },
    ]);
    this.store.set((s) => ({ context: { ...s.context, partySize: p.partySize } }));
    this.pushAgent({
      confirm: {
        kind: p.modifyId ? 'modify' : 'book',
        restaurantId: r.id,
        date: p.date,
        time: p.time,
        partySize: p.partySize,
        reservationId: p.modifyId,
        runId,
        state: 'open',
      },
    });
  }

  private upcoming(): Reservation[] {
    const today = todayISO();
    return this.store
      .get()
      .reservations.filter((x) => x.status === 'confirmed' && x.date >= today)
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  private findReservation(e: Entities): Reservation | undefined {
    const up = this.upcoming();
    if (e.reference) {
      const match = up.find((x) => x.restaurantId === e.reference!.id);
      if (match) return match;
    }
    return up[0];
  }

  private async startCancel(e: Entities): Promise<void> {
    const res = this.findReservation(e);
    const runId = this.newRun('reservation_cancellation', 'Cancel a reservation');
    if (!res) {
      await this.runSteps(runId, [{ name: 'get_user_reservations', detail: '0 upcoming' }]);
      this.setRunStatus(runId, 'done');
      this.pushAgent({ text: "You don't have any upcoming reservations to cancel." });
      return;
    }
    const r = getRestaurant(res.restaurantId);
    await this.runSteps(runId, [
      { name: 'get_user_reservations', detail: `matched ${r.name} · ${formatDay(res.date)}` },
      { name: 'verify_ownership', detail: 'user_id from session ✓' },
      { name: 'request_user_confirmation', status: 'waiting', detail: 'cancellation needs approval' },
    ]);
    this.pushAgent({
      confirm: {
        kind: 'cancel',
        restaurantId: res.restaurantId,
        date: res.date,
        time: res.time,
        partySize: res.partySize,
        reservationId: res.id,
        runId,
        state: 'open',
      },
    });
  }

  private async startModify(e: Entities): Promise<void> {
    const res = this.findReservation(e);
    const runId = this.newRun('reservation_modification', 'Change a reservation');
    if (!res) {
      await this.runSteps(runId, [{ name: 'get_user_reservations', detail: '0 upcoming' }]);
      this.setRunStatus(runId, 'done');
      this.pushAgent({ text: "You don't have any upcoming reservations to change. Want me to find a table instead?" });
      return;
    }
    const r = getRestaurant(res.restaurantId);
    await this.runSteps(runId, [
      { name: 'get_user_reservations', detail: `matched ${r.name}` },
      { name: 'check_availability', detail: formatDay(res.date) },
    ]);
    this.setRunStatus(runId, 'done');
    this.store.set({
      pending: { restaurantId: r.id, date: res.date, partySize: res.partySize, modifyId: res.id },
      mapFilter: [r.id],
      selectedId: r.id,
    });
    this.pushAgent({
      text: `You have ${r.name} ${dayPhrase(res.date)} at ${res.time} for ${res.partySize}. Pick a new time, or tell me the new party size.`,
      results: [{ restaurantId: r.id, reasons: [] }],
      resultsDate: res.date,
    });
  }

  private async listReservations(): Promise<void> {
    const up = this.upcoming();
    const runId = this.newRun('reservation_lookup', 'Upcoming reservations');
    await this.runSteps(runId, [{ name: 'get_user_reservations', detail: `${up.length} upcoming` }]);
    this.setRunStatus(runId, 'done');
    this.pushAgent({
      text: up.length
        ? `You have ${up.length} upcoming:\n${up
            .map((x) => `• ${getRestaurant(x.restaurantId).name}, ${formatDay(x.date)} at ${x.time} for ${x.partySize}`)
            .join('\n')}`
        : 'No upcoming reservations yet.',
      action: 'reservations',
    });
  }

  /* ------------------------------------------------------------------ */
  /* Store helpers                                                        */
  /* ------------------------------------------------------------------ */

  private pushUser(text: string) {
    this.store.set((s) => ({ messages: [...s.messages, { id: uid('msg'), role: 'user', text }] }));
  }

  private pushAgent(m: Omit<ChatMessage, 'id' | 'role'>) {
    this.store.set((s) => ({ messages: [...s.messages, { id: uid('msg'), role: 'agent', ...m }] }));
  }

  private patchConfirm(messageId: string, patch: Partial<ConfirmRequest>) {
    this.store.set((s) => ({
      messages: s.messages.map((m) => (m.id === messageId && m.confirm ? { ...m, confirm: { ...m.confirm, ...patch } } : m)),
    }));
  }

  private bumpAvailability() {
    this.store.set((s) => ({ availabilityVersion: s.availabilityVersion + 1 }));
  }

  private setReservationStatus(id: string, status: Reservation['status']) {
    this.store.set((s) => ({ reservations: s.reservations.map((x) => (x.id === id ? { ...x, status } : x)) }));
  }

  private newRun(workflow: string, title: string): string {
    const id = uid('run');
    this.store.set((s) => ({ runs: [{ id, workflow, title, status: 'running', steps: [] }, ...s.runs] }));
    return id;
  }

  private setRunStatus(id: string, status: RunStatus) {
    this.store.set((s) => ({ runs: s.runs.map((r) => (r.id === id ? { ...r, status } : r)) }));
  }

  /** Simulates tool latency and records every step in the workflow trace. */
  private async runSteps(runId: string, steps: StepSpec[]): Promise<void> {
    this.busy = true;
    this.store.set({ busy: true });
    try {
      for (const st of steps) {
        this.store.set({ busyLabel: `${st.name}…` });
        const waiting = st.status === 'waiting';
        const ms = waiting ? 150 : 220 + Math.floor(Math.random() * 420);
        await sleep(ms);
        const step: TraceStep = { name: st.name, status: st.status ?? 'ok', durationMs: waiting ? undefined : ms, detail: st.detail };
        this.store.set((s) => ({
          runs: s.runs.map((r) =>
            r.id === runId
              ? {
                  ...r,
                  steps: [...r.steps, step],
                  status: waiting ? 'waiting' : st.status === 'failed' ? 'recovered' : r.status,
                }
              : r,
          ),
        }));
      }
    } finally {
      this.busy = false;
      this.store.set({ busy: false, busyLabel: '' });
    }
  }
}
