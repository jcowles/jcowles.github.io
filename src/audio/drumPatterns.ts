import type { Sequence } from './basicSequencer'

export const DRUM_PATTERN_BASIC: Sequence = {
  bpm: 72,
  loop: true,
  loopBeats: 16,
  tracks: [
    {
      instrument: 'kick',
      notes: [
        { time: 0, duration: 0.1, midi: 36, velocity: 0.9 },
        { time: 2, duration: 0.1, midi: 36, velocity: 0.85 },
        { time: 4, duration: 0.1, midi: 36, velocity: 0.9 },
        { time: 6, duration: 0.1, midi: 36, velocity: 0.85 },
        { time: 8, duration: 0.1, midi: 36, velocity: 0.9 },
        { time: 10, duration: 0.1, midi: 36, velocity: 0.85 },
        { time: 12, duration: 0.1, midi: 36, velocity: 0.9 },
        { time: 14, duration: 0.1, midi: 36, velocity: 0.85 },
      ],
    },
    {
      instrument: 'snare',
      notes: [
        { time: 1, duration: 0.08, midi: 38, velocity: 0.7 },
        { time: 3, duration: 0.08, midi: 38, velocity: 0.75 },
        { time: 5, duration: 0.08, midi: 38, velocity: 0.7 },
        { time: 7, duration: 0.08, midi: 38, velocity: 0.75 },
        { time: 9, duration: 0.08, midi: 38, velocity: 0.7 },
        { time: 11, duration: 0.08, midi: 38, velocity: 0.75 },
        { time: 13, duration: 0.08, midi: 38, velocity: 0.7 },
        { time: 15, duration: 0.08, midi: 38, velocity: 0.75 },
      ],
    },
    {
      instrument: 'hihat',
      notes: Array.from({ length: 32 }).map((_, idx) => ({
        time: idx * 0.5,
        duration: 0.06,
        midi: 64,
        velocity: idx % 2 === 0 ? 0.35 : 0.3,
      })),
    },
  ],
}
