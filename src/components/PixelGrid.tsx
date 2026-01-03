import type { FC, PointerEvent } from 'react'
import { useCallback, useEffect, useRef } from 'react'

interface PixelGridProps {
  active: boolean
}

const GRID_SIZE = 128
const BASE_ALPHA = 0.08
const HIGHLIGHT_ALPHA = 0.85

const PixelGrid: FC<PixelGridProps> = ({ active }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const pointerRef = useRef<{ x: number; y: number } | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const cellSizeRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 })
  const dprRef = useRef<number>(window.devicePixelRatio || 1)
  const influenceRadiusRef = useRef<number>(0)

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }

    const ctx = canvas.getContext('2d')
    if (!ctx) {
      return
    }

    const { width, height } = canvas
    const pointer = pointerRef.current
    const cellWidth = cellSizeRef.current.width
    const cellHeight = cellSizeRef.current.height

    ctx.fillStyle = '#05060f'
    ctx.fillRect(0, 0, width, height)

    const influenceRadius = influenceRadiusRef.current

    for (let y = 0; y < GRID_SIZE; y += 1) {
      for (let x = 0; x < GRID_SIZE; x += 1) {
        let intensity = BASE_ALPHA

        if (pointer && active) {
          const cellCenterX = (x + 0.5) * cellWidth
          const cellCenterY = (y + 0.5) * cellHeight
          const dx = pointer.x - cellCenterX
          const dy = pointer.y - cellCenterY
          const distance = Math.sqrt(dx * dx + dy * dy)
          const falloff = Math.max(0, 1 - distance / influenceRadius)
          intensity += Math.pow(falloff, 1.8) * HIGHLIGHT_ALPHA
        }

        ctx.fillStyle = `rgba(113, 93, 250, ${Math.min(intensity, 1)})`
        ctx.fillRect(x * cellWidth, y * cellHeight, cellWidth + 1, cellHeight + 1)
      }
    }
  }, [active])

  const scheduleDraw = useCallback(() => {
    if (animationFrameRef.current !== null) {
      return
    }

    animationFrameRef.current = window.requestAnimationFrame(() => {
      animationFrameRef.current = null
      draw()
    })
  }, [draw])

  const resize = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }

    const dpr = window.devicePixelRatio || 1
    dprRef.current = dpr

    const width = window.innerWidth
    const height = window.innerHeight

    canvas.width = Math.floor(width * dpr)
    canvas.height = Math.floor(height * dpr)
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`

    cellSizeRef.current = {
      width: canvas.width / GRID_SIZE,
      height: canvas.height / GRID_SIZE,
    }

    const avgCell = (cellSizeRef.current.width + cellSizeRef.current.height) / 2
    influenceRadiusRef.current = avgCell * 18

    draw()
  }, [draw])

  useEffect(() => {
    resize()
    window.addEventListener('resize', resize)
    return () => {
      window.removeEventListener('resize', resize)
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }, [resize])

  useEffect(() => {
    draw()
  }, [active, draw])

  const updatePointer = useCallback(
    (event: PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current
      if (!canvas) {
        return
      }

      const rect = canvas.getBoundingClientRect()
      const dpr = dprRef.current
      pointerRef.current = {
        x: (event.clientX - rect.left) * dpr,
        y: (event.clientY - rect.top) * dpr,
      }
      scheduleDraw()
    },
    [scheduleDraw],
  )

  const releasePointer = useCallback(() => {
    pointerRef.current = null
    scheduleDraw()
  }, [scheduleDraw])

  return (
    <canvas
      ref={canvasRef}
      className="h-full w-full"
      onPointerMove={updatePointer}
      onPointerDown={updatePointer}
      onPointerLeave={releasePointer}
    />
  )
}

export default PixelGrid
