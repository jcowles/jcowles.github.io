import { createSynth, type InstrumentName, type SynthVoice } from './basicSynth'

export interface SequenceNote {
  time: number // beats from start
  duration: number // beats
  midi: number
  velocity?: number
}

export interface SequenceTrack {
  instrument: InstrumentName
  notes: SequenceNote[]
}

export interface Sequence {
  bpm: number
  tracks: SequenceTrack[]
  loop?: boolean
  loopBeats?: number
}

export const flattenTracks = (sequence: Sequence) =>
  sequence.tracks
    .flatMap((track) => track.notes.map((n) => ({ ...n, instrument: track.instrument })))
    .sort((a, b) => a.time - b.time)

export const computeLoopLengthBeats = (sequence: Sequence) => {
  if (typeof sequence.loopBeats === 'number' && sequence.loopBeats > 0) {
    return sequence.loopBeats
  }
  return sequence.tracks.reduce<number>((max, track) => {
    const trackMax = track.notes.reduce<number>((m, n) => Math.max(m, n.time + n.duration), 0)
    return Math.max(max, trackMax)
  }, 0)
}

export interface Sequencer {
  start: (sequence?: Sequence) => void
  stop: () => void
  isPlaying: () => boolean
  setBpm: (bpm: number) => void
  setOnBeat: (handler?: (beat: number, bpm: number) => void) => void
  dispose: () => void
}

const midiToFreq = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12)

const defaultSequence: Sequence = {
  bpm: 72,
  loop: true,
  // Habanera intro (Bizet) reduced from MIDI: 4-bar loop with lead, chords, bass
  tracks: [
    {
      instrument: 'saw',
      notes: [
        { time: 8.0, duration: 0.1, midi: 62, velocity: 0.92 },
        { time: 8.5, duration: 0.1, midi: 61, velocity: 0.9 },
        { time: 9.0, duration: 0.07, midi: 60, velocity: 0.9 },
        { time: 9.33, duration: 0.07, midi: 60, velocity: 0.9 },
        { time: 9.67, duration: 0.07, midi: 60, velocity: 0.9 },
        { time: 10.0, duration: 0.1, midi: 59, velocity: 0.88 },
        { time: 10.5, duration: 0.1, midi: 58, velocity: 0.86 },
        { time: 11.0, duration: 0.1, midi: 57, velocity: 0.86 },
        { time: 11.5, duration: 0.05, midi: 57, velocity: 0.84 },
        { time: 11.75, duration: 0.05, midi: 57, velocity: 0.84 },
        { time: 12.0, duration: 0.1, midi: 56, velocity: 0.82 },
        { time: 12.5, duration: 0.1, midi: 55, velocity: 0.82 },
        { time: 13.0, duration: 0.17, midi: 53, velocity: 0.82 },
        { time: 13.17, duration: 0.17, midi: 55, velocity: 0.82 },
        { time: 13.33, duration: 0.17, midi: 53, velocity: 0.82 },
        { time: 13.5, duration: 0.25, midi: 52, velocity: 0.8 },
        { time: 13.75, duration: 0.25, midi: 53, velocity: 0.8 },
        { time: 14.0, duration: 0.1, midi: 55, velocity: 0.82 },
        { time: 14.5, duration: 0.1, midi: 53, velocity: 0.82 },
        { time: 15.0, duration: 1.0, midi: 52, velocity: 0.82 },

        { time: 16.0, duration: 0.1, midi: 62, velocity: 0.92 },
        { time: 16.5, duration: 0.1, midi: 61, velocity: 0.9 },
        { time: 17.0, duration: 0.07, midi: 60, velocity: 0.9 },
        { time: 17.33, duration: 0.07, midi: 60, velocity: 0.9 },
        { time: 17.67, duration: 0.07, midi: 60, velocity: 0.9 },
        { time: 18.0, duration: 0.1, midi: 59, velocity: 0.88 },
        { time: 18.5, duration: 0.1, midi: 58, velocity: 0.86 },
        { time: 19.0, duration: 0.05, midi: 57, velocity: 0.86 },
        { time: 19.25, duration: 0.05, midi: 57, velocity: 0.86 },
        { time: 19.75, duration: 0.05, midi: 57, velocity: 0.86 },
        { time: 20.0, duration: 0.1, midi: 55, velocity: 0.84 },
        { time: 20.5, duration: 0.1, midi: 53, velocity: 0.84 },
        { time: 21.0, duration: 0.17, midi: 52, velocity: 0.84 },
        { time: 21.17, duration: 0.17, midi: 53, velocity: 0.84 },
        { time: 21.33, duration: 0.17, midi: 52, velocity: 0.84 },
        { time: 21.5, duration: 0.25, midi: 50, velocity: 0.82 },
        { time: 21.75, duration: 0.25, midi: 52, velocity: 0.82 },
        { time: 22.0, duration: 0.1, midi: 53, velocity: 0.82 },
        { time: 22.5, duration: 0.1, midi: 52, velocity: 0.82 },
        { time: 23.0, duration: 1.0, midi: 50, velocity: 0.82 },
      ],
    },
    {
      instrument: 'triangle',
      notes: [
        { time: 8.0, duration: 0.1, midi: 62, velocity: 0.5 },
        { time: 8.0, duration: 0.1, midi: 65, velocity: 0.5 },
        { time: 8.5, duration: 0.1, midi: 62, velocity: 0.5 },
        { time: 8.5, duration: 0.1, midi: 65, velocity: 0.5 },
        { time: 9.0, duration: 0.1, midi: 62, velocity: 0.5 },
        { time: 9.0, duration: 0.1, midi: 65, velocity: 0.5 },
        { time: 10.0, duration: 0.1, midi: 62, velocity: 0.5 },
        { time: 10.0, duration: 0.1, midi: 65, velocity: 0.5 },
        { time: 10.5, duration: 0.1, midi: 62, velocity: 0.5 },
        { time: 10.5, duration: 0.1, midi: 65, velocity: 0.5 },
        { time: 11.0, duration: 0.1, midi: 62, velocity: 0.5 },
        { time: 11.0, duration: 0.1, midi: 65, velocity: 0.5 },

        { time: 12.0, duration: 0.1, midi: 62, velocity: 0.5 },
        { time: 12.0, duration: 0.1, midi: 57, velocity: 0.5 },
        { time: 12.5, duration: 0.1, midi: 62, velocity: 0.5 },
        { time: 12.5, duration: 0.1, midi: 57, velocity: 0.5 },
        { time: 13.0, duration: 0.1, midi: 62, velocity: 0.5 },
        { time: 13.0, duration: 0.1, midi: 57, velocity: 0.5 },
        { time: 14.0, duration: 0.1, midi: 62, velocity: 0.5 },
        { time: 14.0, duration: 0.1, midi: 57, velocity: 0.5 },
        { time: 14.5, duration: 0.1, midi: 62, velocity: 0.5 },
        { time: 14.5, duration: 0.1, midi: 57, velocity: 0.5 },
        { time: 15.0, duration: 0.1, midi: 62, velocity: 0.5 },
        { time: 15.0, duration: 0.1, midi: 58, velocity: 0.5 },

        { time: 16.0, duration: 0.1, midi: 64, velocity: 0.5 },
        { time: 16.0, duration: 0.1, midi: 62, velocity: 0.5 },
        { time: 16.5, duration: 0.1, midi: 64, velocity: 0.5 },
        { time: 16.5, duration: 0.1, midi: 62, velocity: 0.5 },
        { time: 17.0, duration: 0.1, midi: 64, velocity: 0.5 },
        { time: 17.0, duration: 0.1, midi: 62, velocity: 0.5 },
        { time: 18.0, duration: 0.1, midi: 64, velocity: 0.5 },
        { time: 18.0, duration: 0.1, midi: 62, velocity: 0.5 },
        { time: 18.5, duration: 0.1, midi: 64, velocity: 0.5 },
        { time: 18.5, duration: 0.1, midi: 62, velocity: 0.5 },
        { time: 19.0, duration: 0.1, midi: 64, velocity: 0.5 },
        { time: 19.0, duration: 0.1, midi: 62, velocity: 0.5 },
        { time: 20.0, duration: 0.1, midi: 62, velocity: 0.5 },
        { time: 20.0, duration: 0.1, midi: 58, velocity: 0.5 },
        { time: 20.5, duration: 0.1, midi: 62, velocity: 0.5 },
        { time: 20.5, duration: 0.1, midi: 58, velocity: 0.5 },
        { time: 21.0, duration: 0.1, midi: 61, velocity: 0.5 },
        { time: 21.0, duration: 0.1, midi: 55, velocity: 0.5 },
        { time: 22.0, duration: 0.1, midi: 61, velocity: 0.5 },
        { time: 22.5, duration: 0.1, midi: 61, velocity: 0.5 },
        { time: 22.5, duration: 0.1, midi: 55, velocity: 0.5 },
        { time: 23.0, duration: 0.1, midi: 53, velocity: 0.5 },
      ],
    },
    {
      instrument: 'pulse',
      notes: [
        { time: 0.0, duration: 0.1, midi: 38, velocity: 0.72 },
        { time: 0.75, duration: 0.25, midi: 45, velocity: 0.7 },
        { time: 1.0, duration: 0.1, midi: 53, velocity: 0.7 },
        { time: 1.5, duration: 0.1, midi: 45, velocity: 0.7 },

        { time: 2.0, duration: 0.1, midi: 38, velocity: 0.7 },
        { time: 2.75, duration: 0.25, midi: 45, velocity: 0.68 },
        { time: 3.0, duration: 0.1, midi: 53, velocity: 0.68 },
        { time: 3.5, duration: 0.1, midi: 45, velocity: 0.68 },

        { time: 4.0, duration: 0.1, midi: 38, velocity: 0.7 },
        { time: 4.75, duration: 0.25, midi: 45, velocity: 0.68 },
        { time: 5.0, duration: 0.1, midi: 53, velocity: 0.68 },
        { time: 5.5, duration: 0.1, midi: 45, velocity: 0.68 },

        { time: 6.0, duration: 0.1, midi: 38, velocity: 0.7 },
        { time: 6.75, duration: 0.25, midi: 45, velocity: 0.68 },
        { time: 7.0, duration: 0.1, midi: 53, velocity: 0.68 },
        { time: 7.5, duration: 0.1, midi: 45, velocity: 0.68 },

        { time: 8.0, duration: 0.1, midi: 45, velocity: 0.72 },
        { time: 8.75, duration: 0.25, midi: 45, velocity: 0.7 },
        { time: 9.0, duration: 0.1, midi: 52, velocity: 0.7 },
        { time: 9.5, duration: 0.1, midi: 45, velocity: 0.7 },

        { time: 10.0, duration: 0.1, midi: 45, velocity: 0.7 },
        { time: 10.75, duration: 0.25, midi: 45, velocity: 0.68 },
        { time: 11.0, duration: 0.1, midi: 52, velocity: 0.68 },
        { time: 11.5, duration: 0.1, midi: 45, velocity: 0.68 },

        { time: 12.0, duration: 0.1, midi: 45, velocity: 0.7 },
        { time: 12.75, duration: 0.25, midi: 45, velocity: 0.68 },
        { time: 13.0, duration: 0.1, midi: 52, velocity: 0.68 },
        { time: 13.5, duration: 0.1, midi: 45, velocity: 0.68 },

        { time: 14.0, duration: 0.1, midi: 45, velocity: 0.7 },
        { time: 14.75, duration: 0.25, midi: 46, velocity: 0.68 },
        { time: 15.0, duration: 0.1, midi: 55, velocity: 0.68 },
        { time: 15.5, duration: 0.1, midi: 46, velocity: 0.68 },
      ],
    },
  ],
}

export const createSequencer = (context: AudioContext): Sequencer => {
  const synthCache = new Map<InstrumentName, SynthVoice>()
  const ensureSynth = (instrument: InstrumentName) => {
    if (!synthCache.has(instrument)) {
      synthCache.set(instrument, createSynth(context))
    }
    return synthCache.get(instrument)!
  }

  let currentSequence: Sequence = defaultSequence
  let playing = false
  let bpm = currentSequence.bpm
  let lookaheadTimer: number | null = null
  let beatTimer: number | null = null
  let startTime = 0
  let nextIndex = 0
  let loopLengthBeats = 0
  let combinedNotes: Array<SequenceNote & { instrument: InstrumentName }> = []
  let onBeatHandler: ((beat: number, bpm: number) => void) | undefined

  const clearBeatTimer = () => {
    if (beatTimer !== null) {
      window.clearInterval(beatTimer)
      beatTimer = null
    }
  }

  const stop = () => {
    playing = false
    if (lookaheadTimer !== null) {
      window.clearInterval(lookaheadTimer)
      lookaheadTimer = null
    }
    clearBeatTimer()
    nextIndex = 0
  }

  const dispose = () => {
    stop()
    synthCache.forEach((s) => s.dispose())
    synthCache.clear()
  }

  const setOnBeat = (handler?: (beat: number, bpm: number) => void) => {
    onBeatHandler = handler
  }

  const setBpm = (nextBpm: number) => {
    bpm = Math.max(30, Math.min(nextBpm, 240))
  }

  const scheduleNotes = () => {
    if (!playing) return
    const now = context.currentTime
    const secPerBeat = 60 / bpm
    const windowAhead = 0.35 // seconds
    const playhead = now - startTime

    while (nextIndex < combinedNotes.length) {
      const note = combinedNotes[nextIndex]
      const noteTime = note.time * secPerBeat
      if (noteTime > playhead + windowAhead) {
        break
      }
      const synth = ensureSynth(note.instrument)
      const freq = midiToFreq(note.midi)
      const durationSec = Math.max(0.05, note.duration * secPerBeat)
      synth.playNote(freq, startTime + noteTime, durationSec, {
        velocity: note.velocity,
        instrument: note.instrument,
      })
      nextIndex += 1
    }

    if (nextIndex >= combinedNotes.length) {
      if (currentSequence.loop) {
        startTime = startTime + loopLengthBeats * secPerBeat
        nextIndex = 0
      } else {
        stop()
      }
    }
  }

  const start = (sequence: Sequence = currentSequence) => {
    stop()
    currentSequence = sequence
    bpm = sequence.bpm

    combinedNotes = flattenTracks(sequence)
    loopLengthBeats = computeLoopLengthBeats(sequence)

    startTime = context.currentTime + 0.05
    nextIndex = 0
    playing = true
    scheduleNotes()

    const secPerBeat = 60 / bpm
    clearBeatTimer()
    let beatCount = 0
    beatTimer = window.setInterval(() => {
      if (onBeatHandler) {
        onBeatHandler(beatCount, bpm)
      }
      beatCount += 1
      if (!sequence.loop && beatCount * 1 > loopLengthBeats + 1) {
        clearBeatTimer()
      }
    }, secPerBeat * 1000)

    lookaheadTimer = window.setInterval(scheduleNotes, 100)
  }

  return {
    start,
    stop,
    isPlaying: () => playing,
    setBpm,
    setOnBeat,
    dispose,
  }
}

export const HABANERA_SEQUENCE: Sequence = defaultSequence
