import type { CSSProperties, FC } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import PixelGrid from './components/PixelGrid'

const INTRO_DURATION = 5000
const TEXT = 'visual core'

type Phase = 'intro' | 'transition' | 'grid'

interface CharacterConfig {
  char: string
  direction: 1 | -1
  duration: number
  delay: number
}

const App: FC = () => {
  const [phase, setPhase] = useState<Phase>('intro')

  const characters = useMemo<CharacterConfig[]>(() => {
    return Array.from(TEXT).map((char, index) => ({
      char,
      direction: index % 2 === 0 ? 1 : -1,
      duration: 650 + (index % 5) * 140,
      delay: index * 45,
    }))
  }, [])

  const longestCharacterDuration = useMemo(() => {
    return characters.reduce((max, character) => {
      return Math.max(max, character.duration + character.delay)
    }, 0)
  }, [characters])

  const triggerTransition = useCallback(() => {
    setPhase((current) => (current === 'intro' ? 'transition' : current))
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      triggerTransition()
    }, INTRO_DURATION)

    return () => {
      window.clearTimeout(timer)
    }
  }, [triggerTransition])

  useEffect(() => {
    if (phase !== 'transition') {
      return
    }

    const timer = window.setTimeout(() => {
      setPhase('grid')
    }, Math.ceil(longestCharacterDuration) + 200)

    return () => {
      window.clearTimeout(timer)
    }
  }, [longestCharacterDuration, phase])

  useEffect(() => {
    if (phase !== 'intro') {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === ' ' || event.key.toLowerCase() === 'enter') {
        event.preventDefault()
        triggerTransition()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [phase, triggerTransition])

  const gridActive = phase !== 'intro'
  const hideText = phase === 'grid'

  return (
    <div
      data-testid="app-root"
      className="relative flex h-screen w-screen select-none items-center justify-center overflow-hidden bg-[#05060f] text-white"
      onPointerDown={triggerTransition}
    >
      <div
        data-testid="pixel-grid"
        className={`absolute inset-0 transition-opacity duration-[1400ms] ${
          gridActive ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
      >
        <PixelGrid active={gridActive} />
      </div>

      <div
        data-testid="intro-text"
        className={`relative z-10 flex items-center justify-center px-6 text-center font-display uppercase tracking-[0.55em] text-white/90 transition-opacity duration-700 ${
          hideText ? 'pointer-events-none opacity-0 delay-700' : 'opacity-100'
        }`}
        style={headingStyle}
      >
        <div className="flex flex-wrap items-center justify-center gap-[0.08em]" aria-hidden>
          {characters.map((character, index) => {
            const style: CSSProperties = {
              transition: `transform ${character.duration}ms cubic-bezier(0.25, 1, 0.5, 1), opacity ${character.duration}ms ease, filter ${character.duration}ms ease`,
              transitionDelay: `${character.delay}ms`,
              transform:
                phase === 'intro'
                  ? 'translateY(0%)'
                  : `translateY(${character.direction * 120}%) scale(${phase === 'transition' ? 1.05 : 1})`,
              opacity: phase === 'intro' ? 1 : 0,
              filter: phase === 'intro' ? 'blur(0px)' : 'blur(8px)',
            }

            return (
              <span key={`${character.char}-${index}`} className="inline-block" style={style}>
                {character.char === ' ' ? '\u00A0' : character.char}
              </span>
            )
          })}
        </div>
        <span className="sr-only">{TEXT}</span>
      </div>
    </div>
  )
}

const headingStyle: CSSProperties = {
  fontSize: 'clamp(3rem, 14vw, 12rem)',
  letterSpacing: '0.6em',
}

export default App
