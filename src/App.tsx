import { useEffect, useState } from 'react'
import PixelGrid from './components/PixelGrid'
import type { PixelGridOrientation } from './components/pixelGridCore'

const TEXT = 'visualcore'

const getOrientation = (): PixelGridOrientation => {
  if (typeof window === 'undefined') {
    return 'landscape'
  }
  return window.innerHeight > window.innerWidth ? 'portrait' : 'landscape'
}

const App = () => {
  const [orientation, setOrientation] = useState<PixelGridOrientation>(() => getOrientation())

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
