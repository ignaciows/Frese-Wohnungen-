'use client';

/**
 * Controls that save the moment you use them.
 *
 * The settings page used to be a wall of forms, each with its own Speichern
 * button. Switching four sources on meant four clicks nobody made, so the
 * automatic search ran with no sources while the screen showed every switch
 * on. A control that needs a second, separate confirmation is not a switch —
 * so these write on change and say so, briefly, where the change happened.
 */

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
// Imported here rather than handed down as props: a plain arrow function
// defined in a Server Component cannot cross into a Client Component, and
// React only refuses at runtime, so the build says nothing. Calling the
// 'use server' action straight from the client is the supported way.
import {
  saveDiscoverySettingsPatchAction,
  toggleFeatureAction,
  toggleSourceAction,
} from '@/app/actions';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

/** The word next to a control, so a save is visible without being loud. */
function Status({ state }: { state: SaveState }) {
  if (state === 'idle') return null;
  return (
    <span className={`save-state ${state}`} role="status">
      {state === 'saving' ? 'Speichert…' : state === 'saved' ? 'Gespeichert' : 'Nicht gespeichert'}
    </span>
  );
}

/** Fades the confirmation away, so it does not become permanent furniture. */
function useTransientState(): [SaveState, (s: SaveState) => void] {
  const [state, setState] = useState<SaveState>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (state !== 'saved') return;
    timer.current = setTimeout(() => setState('idle'), 2000);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [state]);
  return [state, setState];
}

export function InstantSwitch({
  checked,
  label,
  hint,
  disabled,
  sourceId,
}: {
  checked: boolean;
  label: string;
  hint?: string;
  disabled?: boolean;
  /** A source to switch, or omitted for the master "automatic search" switch. */
  sourceId?: string;
}) {
  // Held locally so the switch moves under the finger; the server is caught up
  // with afterwards, and only a failure moves it back.
  const [on, setOn] = useState(checked);
  const [state, setState] = useTransientState();
  const [, startTransition] = useTransition();
  const router = useRouter();

  useEffect(() => setOn(checked), [checked]);

  async function change(next: boolean) {
    setOn(next);
    setState('saving');
    try {
      const r = sourceId
        ? await toggleSourceAction(sourceId, next)
        : await saveDiscoverySettingsPatchAction({ enabled: next ? 'true' : '' });
      if (!r.ok) throw new Error('save failed');
      setState('saved');
      startTransition(() => router.refresh());
    } catch {
      setOn(!next);
      setState('error');
    }
  }

  return (
    <label className={`switch-row ${disabled ? 'is-disabled' : ''}`}>
      <input
        type="checkbox"
        className="switch-input"
        checked={on}
        disabled={disabled}
        onChange={(e) => void change(e.target.checked)}
      />
      <span className="switch-track" aria-hidden>
        <span className="switch-thumb" />
      </span>
      <span className="switch-text">
        <span className="switch-label">{label}</span>
        {hint ? <span className="switch-hint">{hint}</span> : null}
      </span>
      <Status state={state} />
    </label>
  );
}

/**
 * Ein Baustein der App, an oder aus.
 *
 * Eigene Komponente statt eines weiteren Modus im Quellen-Schalter: dort geht
 * es um „diese Seite durchsuchen oder nicht", hier um „diese Funktion gibt es
 * oder nicht". Zwei Fragen, zwei Schalter — auch wenn sie gleich aussehen.
 *
 * Der Hinweis unter dem Schalter wechselt: an steht da, was die Funktion tut,
 * aus steht da, was gerade fehlt. Ein Schalter, der nicht sagt, was das
 * Umlegen kostet, wird nicht umgelegt.
 */
export function FeatureSwitch({
  featureKey,
  checked,
  label,
  description,
  offMeans,
}: {
  featureKey: string;
  checked: boolean;
  label: string;
  description: string;
  offMeans: string;
}) {
  const [on, setOn] = useState(checked);
  const [state, setState] = useTransientState();
  const [, startTransition] = useTransition();
  const router = useRouter();

  useEffect(() => setOn(checked), [checked]);

  async function change(next: boolean) {
    // Sofort umlegen, Server danach — und nur bei einem Fehler zurück.
    setOn(next);
    setState('saving');
    try {
      const data = new FormData();
      data.set('key', featureKey);
      data.set('on', next ? 'true' : '');
      await toggleFeatureAction(data);
      setState('saved');
      startTransition(() => router.refresh());
    } catch {
      setOn(!next);
      setState('error');
    }
  }

  return (
    <label className={`switch-row feature-row ${on ? '' : 'is-off'}`}>
      <input
        type="checkbox"
        className="switch-input"
        checked={on}
        onChange={(e) => void change(e.target.checked)}
      />
      <span className="switch-track" aria-hidden>
        <span className="switch-thumb" />
      </span>
      <span className="switch-text">
        <span className="switch-label">{label}</span>
        <span className="switch-hint">{on ? description : `Aus — ${offMeans}`}</span>
      </span>
      <Status state={state} />
    </label>
  );
}

export function InstantNumber({
  name,
  label,
  value,
  hint,
  step,
  disabled,
}: {
  name: string;
  label: string;
  value: number;
  hint?: string;
  step?: string;
  disabled?: boolean;
}) {
  const [state, setState] = useTransientState();
  const [current, setCurrent] = useState(String(value));
  const initial = useRef(String(value));

  useEffect(() => {
    initial.current = String(value);
    setCurrent(String(value));
  }, [value]);

  // Written when the field is left rather than on every keystroke: a number
  // being typed passes through values its owner never meant to save, and 1 on
  // the way to 120 is a valid setting with real consequences.
  async function commit() {
    if (current === initial.current) return;
    setState('saving');
    try {
      const r = await saveDiscoverySettingsPatchAction({ [name]: current });
      if (!r.ok) throw new Error('save failed');
      initial.current = current;
      setState('saved');
    } catch {
      setCurrent(initial.current);
      setState('error');
    }
  }

  return (
    <div className="field">
      <label htmlFor={`inst-${name}`}>
        {label}
        <Status state={state} />
      </label>
      <input
        id={`inst-${name}`}
        className="input"
        type="number"
        step={step}
        value={current}
        disabled={disabled}
        onChange={(e) => setCurrent(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
      {hint ? <span className="field-hint">{hint}</span> : null}
    </div>
  );
}
