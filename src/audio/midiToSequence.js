#!/usr/bin/env node
// Convert MIDI to sequencer tracks JSON (per channel) for our simple engine
import fs from 'node:fs'

const inputPath = process.argv[2]
if (!inputPath) {
  console.error('Usage: node src/audio/midiToSequence.js <file.mid>')
  process.exit(1)
}

const readVarInt = (data, offset) => {
  let result = 0
  let i = offset
  while (true) {
    const byte = data[i]
    i += 1
    result = (result << 7) | (byte & 0x7f)
    if ((byte & 0x80) === 0) break
  }
  return { value: result, next: i }
}

const parseMidi = (data) => {
  let i = 0
  const readStr = (len) => {
    const str = Buffer.from(data.slice(i, i + len)).toString('ascii')
    i += len
    return str
  }
  const readUInt32 = () => {
    const v = (data[i] << 24) | (data[i + 1] << 16) | (data[i + 2] << 8) | data[i + 3]
    i += 4
    return v >>> 0
  }
  const readUInt16 = () => {
    const v = (data[i] << 8) | data[i + 1]
    i += 2
    return v
  }

  if (readStr(4) !== 'MThd') throw new Error('Invalid header chunk')
  const headerLen = readUInt32()
  if (headerLen !== 6) throw new Error('Unexpected header length')
  const format = readUInt16()
  const ntrks = readUInt16()
  const division = readUInt16()

  const tempos = []
  const tracks = []

  for (let t = 0; t < ntrks; t += 1) {
    const chunkType = readStr(4)
    const chunkLen = readUInt32()
    if (chunkType !== 'MTrk') {
      i += chunkLen
      continue
    }
    const end = i + chunkLen
    let tick = 0
    let runningStatus = null
    const notes = []
    while (i < end) {
      const delta = readVarInt(data, i)
      tick += delta.value
      i = delta.next
      let status = data[i]
      if (status < 0x80) {
        if (runningStatus === null) throw new Error('Running status without previous status')
        status = runningStatus
      } else {
        i += 1
        runningStatus = status
      }

      if (status === 0xff) {
        const metaType = data[i]
        i += 1
        const len = readVarInt(data, i)
        i = len.next
        const metaData = data.slice(i, i + len.value)
        i += len.value
        if (metaType === 0x51 && len.value === 3) {
          const mpq = (metaData[0] << 16) | (metaData[1] << 8) | metaData[2]
          const bpm = 60000000 / mpq
          tempos.push({ tick, bpm })
        }
        continue
      }

      if (status === 0xf0 || status === 0xf7) {
        const len = readVarInt(data, i)
        i = len.next + len.value
        continue
      }

      const eventType = status & 0xf0
      const channel = status & 0x0f
      const needsOneByte = eventType === 0xc0 || eventType === 0xd0

      const d1 = data[i]
      i += 1
      const d2 = needsOneByte ? null : data[i]
      if (!needsOneByte) i += 1

      if (eventType === 0x90 || eventType === 0x80) {
        const velocity = eventType === 0x80 ? 0 : d2
        if (velocity === 0) {
          notes.push({ tick, type: 'off', note: d1, channel })
        } else {
          notes.push({ tick, type: 'on', note: d1, velocity, channel })
        }
      }
    }
    tracks.push({ notes })
  }

  return { format, ntrks, division, tempos, tracks }
}

const instrumentMap = {
  0: 'saw',
  1: 'triangle',
  2: 'pulse',
}

try {
  const data = fs.readFileSync(inputPath)
  const midi = parseMidi(new Uint8Array(data))
  const ticksPerQuarter = midi.division
  const toBeats = (tick) => +(tick / ticksPerQuarter)
  const bpm = midi.tempos.length ? midi.tempos[midi.tempos.length - 1].bpm : 96

  const tracks = midi.tracks.map((trk, idx) => {
    const active = new Map()
    const pairs = []
    for (const evt of trk.notes) {
      const key = `${evt.channel}:${evt.note}`
      if (evt.type === 'on' && evt.velocity > 0) {
        active.set(key, { start: evt.tick, velocity: evt.velocity, midi: evt.note, channel: evt.channel })
      } else {
        const start = active.get(key)
        if (start) {
          const dur = evt.tick - start.start
          if (dur > 0) {
            pairs.push({
              time: toBeats(start.start),
              duration: toBeats(dur),
              midi: start.midi,
              velocity: Math.min(1, (start.velocity || 80) / 100),
              channel: start.channel,
            })
          }
          active.delete(key)
        }
      }
    }
    if (!pairs.length) return null
    return {
      instrument: instrumentMap[idx] || instrumentMap[pairs[0].channel] || 'sine',
      notes: pairs.sort((a, b) => a.time - b.time),
    }
  }).filter(Boolean)

  const sequence = { bpm: Math.round(bpm * 1000) / 1000, loop: true, tracks }
  console.log(JSON.stringify(sequence, null, 2))
} catch (err) {
  console.error('Failed to parse MIDI:', err)
  process.exit(1)
}
