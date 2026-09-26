import type { Clock } from '../trace/clock.js';

export interface FakeClock extends Clock {
  advance(ms: number): void;
  readonly currentTime: number;
}

// sleep() advances the virtual clock instantly instead of waiting in real time,
// so pacer tests covering minutes of quota windows run in milliseconds.
export function createFakeClock(startAt = 0): FakeClock {
  let now = startAt;
  return {
    now: () => now,
    sleep: (ms: number) => {
      now += ms;
      return Promise.resolve();
    },
    advance(ms: number) {
      now += ms;
    },
    get currentTime() {
      return now;
    },
  };
}
