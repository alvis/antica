import { useEffect, useState } from 'react';

import { AppState } from 'react-native';

/** how often a mounted screen rereads the clock */
const tickMs = 60_000;

/**
 * the device clock, reread every minute and whenever the app returns to the foreground, so a tab
 * that stays mounted rolls its day heading and greeting over
 * @returns the current moment
 */
export function useNow(): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const tick = (): void => setNow(new Date());
    const timer = setInterval(tick, tickMs);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        tick();
      }
    });

    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, []);

  return now;
}
