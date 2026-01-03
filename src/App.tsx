import { useCallback, useEffect, useRef, useState } from 'react'
import PixelGrid, { type Phase } from './components/PixelGrid'

const TEXT = 'visualcore'
const INTRO_DURATION_MS = 2400
const TRANSITION_DURATION_MS = 700

const App = () => {
  const [phase, setPhase] = useState<Phase>('intro')
  const [scatterSignal, setScatterSignal] = useState(0)
  const introTimerRef = useRef<number | null>(null)
  const transitionTimerRef = useRef<number | null>(null)

  const clearIntroTimer = useCallback(() => {
    if (introTimerRef.current !== null) {
      window.clearTimeout(introTimerRef.current)
      introTimerRef.current = null
    }
  }, [])

  const clearTransitionTimer = useCallback(() => {
    if (transitionTimerRef.current !== null) {
      window.clearTimeout(transitionTimerRef.current)
      transitionTimerRef.current = null
    }
  }, [])

  const triggerScatterAll = useCallback(() => {
    setScatterSignal((value) => value + 1)
  }, [])

  const handleScatterStart = useCallback(() => {
    setPhase((current) => {
      if (current !== 'intro') {
        return current
      }
      clearTransitionTimer()
      transitionTimerRef.current = window.setTimeout(() => {
        setPhase('grid')
        transitionTimerRef.current = null
      }, TRANSITION_DURATION_MS)
      return 'transition'
    })
  }, [clearTransitionTimer])

  const handleScatterComplete = useCallback(() => {
    clearTransitionTimer()
    setPhase('grid')
  }, [clearTransitionTimer])

  useEffect(() => {
    introTimerRef.current = window.setTimeout(() => {
      triggerScatterAll()
      introTimerRef.current = null
    }, INTRO_DURATION_MS)

    return () => {
      clearIntroTimer()
      clearTransitionTimer()
    }
  }, [clearIntroTimer, clearTransitionTimer, triggerScatterAll])

  useEffect(() => {
    if (phase !== 'intro') {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === ' ' || event.key.toLowerCase() === 'enter') {
        event.preventDefault()
        clearIntroTimer()
        triggerScatterAll()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [clearIntroTimer, phase, triggerScatterAll])

  const handlePointerInteraction = useCallback(() => {
    if (phase !== 'intro') {
      return
    }
    clearIntroTimer()
    triggerScatterAll()
  }, [clearIntroTimer, phase, triggerScatterAll])

  return (
    <div
      data-testid="app-root"
      className="relative flex h-screen w-screen select-none items-center justify-center overflow-hidden bg-[#082c4a] text-white"
      onPointerDown={handlePointerInteraction}
    >
      <div data-testid="pixel-grid" data-phase={phase} className="absolute inset-0">
        <PixelGrid
          phase={phase}
          onScatterStart={handleScatterStart}
          onScatterComplete={handleScatterComplete}
          scatterSignal={scatterSignal}
        />
      </div>

      <span className="sr-only">{TEXT}</span>
    </div>
  )
}

export default App
