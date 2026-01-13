import { useEffect, useRef, useState } from 'react'
import PixelGrid from './components/PixelGrid'
import type { PixelGridOrientation } from './components/pixelGridCore'
import { createSequencer } from './audio/basicSequencer'
import { HABANERA_FULL } from './audio/song-habanera'
import { DRUM_PATTERN_BASIC } from './audio/drumPatterns'

const TEXT = 'visualcore'

const getOrientation = (): PixelGridOrientation => {
  if (typeof window === 'undefined') {
    return 'landscape'
  }
  return window.innerHeight > window.innerWidth ? 'portrait' : 'landscape'
}

const App = () => {
  const [orientation, setOrientation] = useState<PixelGridOrientation>(() => getOrientation())
  const audioStartedRef = useRef(false)

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }
    const update = () => {
      const next = getOrientation()
      setOrientation((current) => (current === next ? current : next))
    }

    update()
    window.addEventListener('resize', update)
    window.addEventListener('orientationchange', update)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('orientationchange', update)
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const AudioCtx = (window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
    if (!AudioCtx) {
      return
    }

    const context = new AudioCtx()
    const melodySequencer = createSequencer(context)
    const drumSequencer = createSequencer(context)

    const startAudio = async () => {
      if (audioStartedRef.current) return
      try {
        if (context.state === 'suspended') {
          await context.resume()
        }
        melodySequencer.start(HABANERA_FULL)
        drumSequencer.start(DRUM_PATTERN_BASIC)
        audioStartedRef.current = true
        window.removeEventListener('pointerdown', resumeOnInput)
        window.removeEventListener('keydown', resumeOnInput)
      } catch {
        // ignore autoplay block failures
      }
    }

    const resumeOnInput = () => {
      void startAudio()
    }

    void startAudio()
    window.addEventListener('pointerdown', resumeOnInput)
    window.addEventListener('keydown', resumeOnInput)

    return () => {
      window.removeEventListener('pointerdown', resumeOnInput)
      window.removeEventListener('keydown', resumeOnInput)
      melodySequencer.stop()
      melodySequencer.dispose()
      drumSequencer.stop()
      drumSequencer.dispose()
      context.close().catch(() => {})
    }
  }, [])

  return (
    <div
      data-testid="app-root"
      className="relative flex h-screen w-screen select-none items-center justify-center overflow-hidden bg-[#082c4a] text-white"
    >
      <div data-testid="pixel-grid" className="absolute inset-0">
        <PixelGrid key={orientation} orientation={orientation} />
      </div>

      <span className="sr-only">{TEXT}</span>
    </div>
  )
}

export default App
