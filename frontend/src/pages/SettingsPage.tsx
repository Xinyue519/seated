import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { CuisineGroup, Dietary, PriceLevel } from '@/types';
import { CUISINE_LABELS } from '@/data/restaurants';
import { useApp } from '@/store/AppStore';
import { guests, price } from '@/lib/format';

const DIETARY: Array<{ id: Dietary; label: string }> = [
  { id: 'vegetarian', label: 'Vegetarian' },
  { id: 'vegan', label: 'Vegan' },
  { id: 'gluten-free', label: 'Gluten-free' },
  { id: 'nut-allergy', label: 'Nut allergy' },
];

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export default function SettingsPage() {
  const { state, store, api, toast, logout } = useApp();
  const navigate = useNavigate();
  const prefs = state.preferences;
  const setPrefs = (patch: Partial<typeof prefs>) => store.set((s) => ({ preferences: { ...s.preferences, ...patch } }));
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await Promise.all([api.updateProfile(state.user), api.updatePreferences(state.preferences)]);
      toast('Preferences saved. Ask Seated will use them next time.');
    } catch {
      toast("Couldn't save your settings. Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="mx-auto flex w-full max-w-[880px] flex-1 flex-col gap-5 overflow-y-auto px-6 pb-16 pt-10">
      <h1 className="text-[28px] font-semibold tracking-[-0.02em]">Settings</h1>

      <section aria-labelledby="h-profile" className="card flex flex-col gap-5 p-6">
        <h2 id="h-profile" className="text-[17px] font-semibold">
          Profile
        </h2>
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(240px,100%),1fr))]">
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium">Name</span>
            <input
              className="field"
              value={state.user.name}
              onChange={(e) => store.set((s) => ({ user: { ...s.user, name: e.target.value } }))}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium">Email</span>
            <input
              className="field"
              type="email"
              value={state.user.email}
              onChange={(e) => store.set((s) => ({ user: { ...s.user, email: e.target.value } }))}
            />
          </label>
        </div>
        <span className="text-[13px] text-muted">Reservations are made under this name.</span>
      </section>

      <section aria-labelledby="h-dining" className="card flex flex-col gap-6 p-6">
        <div className="flex flex-col gap-1">
          <h2 id="h-dining" className="text-[17px] font-semibold">
            Dining preferences
          </h2>
          <p className="text-muted">Ask Seated uses these when it ranks restaurants.</p>
        </div>

        <fieldset>
          <legend className="mb-2.5 text-[13px] font-medium">Favorite cuisines</legend>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(CUISINE_LABELS) as CuisineGroup[]).map((g) => {
              const on = prefs.cuisines.includes(g);
              return (
                <button
                  key={g}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setPrefs({ cuisines: toggle(prefs.cuisines, g) })}
                  className={on ? 'pill-on' : 'pill-off'}
                >
                  {CUISINE_LABELS[g]}
                </button>
              );
            })}
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-2.5 text-[13px] font-medium">Price range</legend>
          <div className="flex flex-wrap gap-2">
            {([1, 2, 3, 4] as PriceLevel[]).map((n) => {
              const on = prefs.priceLevels.includes(n);
              return (
                <button
                  key={n}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setPrefs({ priceLevels: toggle(prefs.priceLevels, n) })}
                  className={`${on ? 'pill-on' : 'pill-off'} min-w-16 justify-center`}
                >
                  {price(n)}
                </button>
              );
            })}
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-2.5 text-[13px] font-medium">Dietary needs</legend>
          <div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(min(160px,100%),1fr))]">
            {DIETARY.map((d) => (
              <label key={d.id} className="flex min-h-11 items-center gap-2.5 rounded-[10px] border border-line px-3">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-ink"
                  checked={prefs.dietary.includes(d.id)}
                  onChange={() => setPrefs({ dietary: toggle(prefs.dietary, d.id) })}
                />
                {d.label}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="flex flex-col gap-2">
          <span className="text-[13px] font-medium">Usual party size</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="Fewer guests"
              onClick={() => setPrefs({ partySize: Math.max(1, prefs.partySize - 1) })}
              className="h-11 w-11 rounded-[10px] border border-line2 bg-white text-lg font-medium"
            >
              −
            </button>
            <span className="min-w-20 text-center font-medium">{guests(prefs.partySize)}</span>
            <button
              type="button"
              aria-label="More guests"
              onClick={() => setPrefs({ partySize: Math.min(12, prefs.partySize + 1) })}
              className="h-11 w-11 rounded-[10px] border border-line2 bg-white text-lg font-medium"
            >
              +
            </button>
          </div>
        </div>
      </section>

      <section aria-labelledby="h-security" className="card flex flex-col gap-4 p-6">
        <h2 id="h-security" className="text-[17px] font-semibold">
          Security
        </h2>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-muted">Signed in as {state.user.email}</span>
          <button
            type="button"
            onClick={async () => {
              await logout();
              navigate('/login');
            }}
            className="btn-outline text-[14px] text-danger"
          >
            Log out
          </button>
        </div>
      </section>

      <div className="flex justify-end">
        <button type="button" onClick={save} disabled={saving} className="btn-primary">
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </main>
  );
}
