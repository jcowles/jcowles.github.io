export type InstrumentName =
  | 'sine'
  | 'square'
  | 'saw'
  | 'triangle'
  | 'pulse'
  | 'piano'
  | 'kick'
  | 'snare'
  | 'hihat'

export interface NoteOptions {
  velocity?: number
  instrument?: InstrumentName
  attack?: number
  release?: number
}

export interface SynthVoice {
  playNote: (frequency: number, startTime: number, duration: number, options?: NoteOptions) => void
  dispose: () => void
}

const createPulseWave = (context: AudioContext, duty = 0.15) => {
  const real = new Float32Array([0, 1])
  const imag = new Float32Array([0, 0])
  const wave = context.createPeriodicWave(real, imag)
  return { wave, duty: Math.min(Math.max(duty, 0.01), 0.99) }
}

const createNoiseBuffer = (context: AudioContext) => {
  const buffer = context.createBuffer(1, context.sampleRate, context.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < data.length; i += 1) {
    data[i] = Math.random() * 2 - 1
  }
  return buffer
}

export const createSynth = (context: AudioContext): SynthVoice => {
  const output = context.createGain()
  output.gain.value = 0.9
  output.connect(context.destination)

  const pulse = createPulseWave(context)
  const noiseBuffer = createNoiseBuffer(context)

  const playNote = (
    frequency: number,
    startTime: number,
    duration: number,
    options: NoteOptions = {},
  ) => {
    const instrument: InstrumentName = options.instrument ?? 'sine'
    const velocity = Math.min(Math.max(options.velocity ?? 0.8, 0), 1)

    const piano = instrument === 'piano'
    const drum = instrument === 'kick' || instrument === 'snare' || instrument === 'hihat'

    // Drum branch: use noise/sine bursts with fast envelopes
    if (drum) {
      const gain = context.createGain()
      gain.gain.setValueAtTime(0, startTime)
      const endTime = startTime + duration

      if (instrument === 'kick') {
        const osc = context.createOscillator()
        osc.type = 'sine'
        const startFreq = frequency || 60
        osc.frequency.setValueAtTime(startFreq, startTime)
        osc.frequency.exponentialRampToValueAtTime(Math.max(30, startFreq * 0.4), startTime + 0.08)
        gain.gain.linearRampToValueAtTime(velocity, startTime + 0.005)
        gain.gain.exponentialRampToValueAtTime(0.0001, endTime + 0.1)
        osc.connect(gain)
        gain.connect(output)
        osc.start(startTime)
        osc.stop(endTime + 0.12)
        return
      }

      // Noise-based snare/hihat
      const noise = context.createBufferSource()
      noise.buffer = noiseBuffer
      const filter = context.createBiquadFilter()
      if (instrument === 'snare') {
        filter.type = 'bandpass'
        filter.frequency.value = 1800
        filter.Q.value = 0.7
        gain.gain.linearRampToValueAtTime(velocity * 0.8, startTime + 0.002)
        gain.gain.exponentialRampToValueAtTime(0.0001, endTime + 0.08)
      } else {
        filter.type = 'highpass'
        filter.frequency.value = 8000
        filter.Q.value = 0.8
        gain.gain.linearRampToValueAtTime(velocity * 0.5, startTime + 0.001)
        gain.gain.exponentialRampToValueAtTime(0.0001, endTime + 0.04)
      }
      noise.connect(filter)
      filter.connect(gain)
      gain.connect(output)
      noise.start(startTime)
      noise.stop(endTime + 0.12)
      return
    }

    const oscList: OscillatorNode[] = []
    const gain = context.createGain()

    const attack = piano ? 0.006 : Math.max(0.001, options.attack ?? 0.01)
    const decay = piano ? 0.14 : 0
    const sustainLevel = piano ? Math.max(0.02, velocity * 0.08) : velocity
    const release = piano ? 0.18 : Math.max(0.03, options.release ?? 0.08)

    const addOsc = (type: OscillatorType | 'pulse', detuneCents = 0) => {
      const osc = context.createOscillator()
      if (type === 'pulse') {
        osc.setPeriodicWave(pulse.wave)
      } else {
        osc.type = type
      }
      osc.frequency.value = frequency
      if (detuneCents !== 0) {
        osc.detune.value = detuneCents
      }
      osc.connect(gain)
      oscList.push(osc)
    }

    switch (instrument) {
      case 'square':
        addOsc('square')
        break
      case 'triangle':
        addOsc('triangle')
        break
      case 'sine':
        addOsc('sine')
        break
      case 'saw':
        addOsc('sawtooth')
        break
      case 'pulse':
        addOsc('pulse')
        break
      case 'piano':
        addOsc('triangle', -5)
        addOsc('sine', 5)
        break
      case 'kick':
        addOsc('sine')
        break
      case 'snare':
        addOsc('triangle', 5)
        break
      case 'hihat':
        addOsc('triangle', 12)
        break
    }

    gain.gain.setValueAtTime(0, startTime)
    gain.gain.linearRampToValueAtTime(velocity, startTime + attack)
    if ((piano || drum) && decay > 0) {
      gain.gain.linearRampToValueAtTime(sustainLevel, startTime + attack + decay)
    }
    const endTime = startTime + duration
    gain.gain.setTargetAtTime(0, endTime, release)

    gain.connect(output)

    for (const osc of oscList) {
      osc.start(startTime)
      osc.stop(endTime + release * 2)
    }
  }

  const dispose = () => {
    output.disconnect()
  }

  return { playNote, dispose }
}
