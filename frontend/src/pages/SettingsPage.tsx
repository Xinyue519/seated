import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { CuisineGroup, Dietary, PriceLevel } from '@/types';
import { CUISINE_LABELS } from '@/data/restaurants';
import { useApp } from '@/store/AppStore';
import { cx, guests, price } from '@/lib/format';
import common from '@/styles/common.module.css';
import styles from './pages.module.css';

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
    <main className={styles.settingsMain}>
      <h1 className={styles.settingsTitle}>Settings</h1>

      <section aria-labelledby="h-profile" className={cx(common.card, styles.settingsProfileSection)}>
        <h2 id="h-profile" className={styles.settingsSectionHeading}>
          Profile
        </h2>
        <div className={styles.settingsProfileGrid}>
          <label className={styles.settingsFieldGroup}>
            <span className={styles.settingsFieldLabel}>Name</span>
            <input
              className={common.field}
              value={state.user.name}
              onChange={(e) => store.set((s) => ({ user: { ...s.user, name: e.target.value } }))}
            />
          </label>
          <label className={styles.settingsFieldGroup}>
            <span className={styles.settingsFieldLabel}>Email</span>
            <input
              className={common.field}
              type="email"
              value={state.user.email}
              onChange={(e) => store.set((s) => ({ user: { ...s.user, email: e.target.value } }))}
            />
          </label>
        </div>
        <span className={styles.settingsHelperText}>Reservations are made under this name.</span>
      </section>

      <section aria-labelledby="h-dining" className={cx(common.card, styles.settingsDiningSection)}>
        <div className={styles.settingsDiningHeading}>
          <h2 id="h-dining" className={styles.settingsSectionHeading}>
            Dining preferences
          </h2>
          <p className={styles.settingsDiningSubtitle}>Ask Seated uses these when it ranks restaurants.</p>
        </div>

        <fieldset>
          <legend className={styles.settingsLegend}>Favorite cuisines</legend>
          <div className={styles.settingsPillRow}>
            {(Object.keys(CUISINE_LABELS) as CuisineGroup[]).map((g) => {
              const on = prefs.cuisines.includes(g);
              return (
                <button
                  key={g}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setPrefs({ cuisines: toggle(prefs.cuisines, g) })}
                  className={on ? common.pillOn : common.pillOff}
                >
                  {CUISINE_LABELS[g]}
                </button>
              );
            })}
          </div>
        </fieldset>

        <fieldset>
          <legend className={styles.settingsLegend}>Price range</legend>
          <div className={styles.settingsPillRow}>
            {([1, 2, 3, 4] as PriceLevel[]).map((n) => {
              const on = prefs.priceLevels.includes(n);
              return (
                <button
                  key={n}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setPrefs({ priceLevels: toggle(prefs.priceLevels, n) })}
                  className={cx(on ? common.pillOn : common.pillOff, styles.settingsPriceOption)}
                >
                  {price(n)}
                </button>
              );
            })}
          </div>
        </fieldset>

        <fieldset>
          <legend className={styles.settingsLegend}>Dietary needs</legend>
          <div className={styles.settingsDietaryGrid}>
            {DIETARY.map((d) => (
              <label key={d.id} className={styles.settingsDietaryOption}>
                <input
                  type="checkbox"
                  className={styles.settingsCheckbox}
                  checked={prefs.dietary.includes(d.id)}
                  onChange={() => setPrefs({ dietary: toggle(prefs.dietary, d.id) })}
                />
                {d.label}
              </label>
            ))}
          </div>
        </fieldset>

        <div className={styles.settingsPartySizeGroup}>
          <span className={styles.settingsFieldLabel}>Usual party size</span>
          <div className={styles.settingsPartySizeRow}>
            <button
              type="button"
              aria-label="Fewer guests"
              onClick={() => setPrefs({ partySize: Math.max(1, prefs.partySize - 1) })}
              className={styles.settingsStepperButton}
            >
              −
            </button>
            <span className={styles.settingsPartySizeValue}>{guests(prefs.partySize)}</span>
            <button
              type="button"
              aria-label="More guests"
              onClick={() => setPrefs({ partySize: Math.min(12, prefs.partySize + 1) })}
              className={styles.settingsStepperButton}
            >
              +
            </button>
          </div>
        </div>
      </section>

      <section aria-labelledby="h-security" className={cx(common.card, styles.settingsSecuritySection)}>
        <h2 id="h-security" className={styles.settingsSectionHeading}>
          Security
        </h2>
        <div className={styles.settingsSecurityRow}>
          <span className={styles.settingsSignedInAs}>Signed in as {state.user.email}</span>
          <button
            type="button"
            onClick={async () => {
              await logout();
              navigate('/login');
            }}
            className={cx(common.btnOutline, styles.settingsLogoutButton)}
          >
            Log out
          </button>
        </div>
      </section>

      <div className={styles.settingsSaveRow}>
        <button type="button" onClick={save} disabled={saving} className={common.btnPrimary}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </main>
  );
}
