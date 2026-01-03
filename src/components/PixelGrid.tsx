import { useCallback, useEffect, useMemo, useRef, type PointerEvent } from 'react'

export type Phase = 'intro' | 'transition' | 'grid'

interface PixelGridProps {
  phase: Phase
  onScatterStart: () => void
  onScatterComplete: () => void
  scatterSignal: number
}

const GRID_SIZE = 64
const TEXT_ALPHA = 0.85
const HIGHLIGHT_ALPHA = 0.96
const DECAY_FACTOR = 0.965
const MIN_VISIBLE_INTENSITY = 0.001
const MIN_RIPPLE_INTENSITY = 0.06
const BACKGROUND_COLOR = '#082c4a'
const SCATTER_DURATION = 900
const SCATTER_STEPS = 7
const RIPPLE_STEP_DELAY_MS = 22
const EXPLOSION_RADIUS = 100
const EXPLOSION_DURATION_MS = 380

const TEXT_CONTENT = 'visualcore'

const DEFAULT_COLOR: [number, number, number] = [118, 99, 255]
const GRADIENT_STOPS: Array<{ stop: number; color: [number, number, number] }> = [
  { stop: 0, color: [116, 92, 255] },
  { stop: 0.55, color: [255, 93, 210] },
  { stop: 1, color: [108, 201, 255] },
]

const CANVAS_SCALE = 18
const HORIZONTAL_PADDING_CELLS = 2
const VERTICAL_PADDING_RATIO = 0.35
const MIN_CELLS_RATIO = 0.08
const MAX_CELLS_RATIO = 0.28

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

function assertInvariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`[PixelGrid] ${message}`)
  }
}

const createFallbackTextData = (totalCells: number, cellIndexLookup: Int32Array): TextData => {
  const mask = new Float32Array(totalCells)
  const colors = new Float32Array(totalCells * 3)
  const cellIndices: number[] = []

  const minStripe = Math.floor(GRID_SIZE * 0.3)
  const maxStripe = Math.ceil(GRID_SIZE * 0.7)

  for (let y = 0; y < GRID_SIZE; y += 1) {
    for (let x = 0; x < GRID_SIZE; x += 1) {
      const cellIndex = y * GRID_SIZE + x
      const offset = cellIndex * 3

      if (y >= minStripe && y <= maxStripe) {
        const ratio = x / Math.max(1, GRID_SIZE - 1)
        const [r, g, b] = sampleGradient(ratio)
        colors[offset] = r
        colors[offset + 1] = g
        colors[offset + 2] = b
        mask[cellIndex] = 1
        cellIndexLookup[cellIndex] = cellIndices.length
        cellIndices.push(cellIndex)
      } else {
        colors[offset] = DEFAULT_COLOR[0]
        colors[offset + 1] = DEFAULT_COLOR[1]
        colors[offset + 2] = DEFAULT_COLOR[2]
        mask[cellIndex] = 0
      }
    }
  }

  return {
    mask,
    colors,
    cellIndices: Int32Array.from(cellIndices),
    cellIndexLookup,
  }
}

interface TextData {
  mask: Float32Array
  colors: Float32Array
  cellIndices: Int32Array
  cellIndexLookup: Int32Array
}

const RIPPLE_OFFSETS: Array<[number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
]

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

const sampleGradient = (t: number): [number, number, number] => {
  if (GRADIENT_STOPS.length === 0) {
    return DEFAULT_COLOR
  }

  const clamped = Math.min(1, Math.max(0, t))

  for (let index = 0; index < GRADIENT_STOPS.length - 1; index += 1) {
    const current = GRADIENT_STOPS[index]
    const next = GRADIENT_STOPS[index + 1]
    if (clamped >= current.stop && clamped <= next.stop) {
      const span = next.stop - current.stop || 1
      const localT = (clamped - current.stop) / span
      return [
        Math.round(lerp(current.color[0], next.color[0], localT)),
        Math.round(lerp(current.color[1], next.color[1], localT)),
        Math.round(lerp(current.color[2], next.color[2], localT)),
      ]
    }
  }

  const last = GRADIENT_STOPS[GRADIENT_STOPS.length - 1]
  return last.color
}

const createTextData = (): TextData => {
  const totalCells = GRID_SIZE * GRID_SIZE
  const cellIndexLookup = new Int32Array(totalCells)
  cellIndexLookup.fill(-1)

  const mask = new Float32Array(totalCells)
  const colors = new Float32Array(totalCells * 3)
  const cellIndices: number[] = []

  if (typeof document === 'undefined') {
    return createFallbackTextData(totalCells, cellIndexLookup)
  }

  const canvas = document.createElement('canvas')
  canvas.width = GRID_SIZE * CANVAS_SCALE
  canvas.height = GRID_SIZE * CANVAS_SCALE

  const ctx = canvas.getContext('2d')
  if (!ctx || typeof ctx.fillText !== 'function' || typeof ctx.getImageData !== 'function') {
    return createFallbackTextData(totalCells, cellIndexLookup)
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#fff'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `700 ${Math.floor(canvas.height * 0.58)}px "Inter", "Poppins", sans-serif`
  ctx.fillText(TEXT_CONTENT, canvas.width / 2, canvas.height / 2)

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height).data
  const cells: Array<{ cellIndex: number; coverage: number; x: number; y: number }> = []
  let maxCoverage = 0

  for (let y = 0; y < GRID_SIZE; y += 1) {
    for (let x = 0; x < GRID_SIZE; x += 1) {
      let alphaSum = 0
      for (let sy = 0; sy < CANVAS_SCALE; sy += 1) {
        for (let sx = 0; sx < CANVAS_SCALE; sx += 1) {
          const pixelX = x * CANVAS_SCALE + sx
          const pixelY = y * CANVAS_SCALE + sy
          const index = (pixelY * canvas.width + pixelX) * 4 + 3
          alphaSum += imageData[index]
        }
      }

      const coverage = alphaSum / (CANVAS_SCALE * CANVAS_SCALE * 255)
      if (coverage > 0) {
        maxCoverage = Math.max(maxCoverage, coverage)
      }

      cells.push({ cellIndex: y * GRID_SIZE + x, coverage, x, y })
    }
  }

  const filledCells = cells.filter((cell) => cell.coverage > 0)
  if (filledCells.length === 0) {
    return createFallbackTextData(totalCells, cellIndexLookup)
  }

  filledCells.sort((a, b) => b.coverage - a.coverage)

  const minCells = Math.floor(GRID_SIZE * GRID_SIZE * MIN_CELLS_RATIO)
  const maxCells = Math.floor(GRID_SIZE * GRID_SIZE * MAX_CELLS_RATIO)
  const keepCount = clamp(filledCells.length, minCells, maxCells)
  const cutoff = Math.max(0.03, filledCells[Math.min(keepCount - 1, filledCells.length - 1)].coverage)

  const keptCells = filledCells.filter((cell) => cell.coverage >= cutoff)
  keptCells.sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x))

  const minX = keptCells[0].x
  const maxX = keptCells[keptCells.length - 1].x
  const minY = keptCells.reduce((acc, cell) => Math.min(acc, cell.y), GRID_SIZE - 1)
  const maxY = keptCells.reduce((acc, cell) => Math.max(acc, cell.y), 0)
  const spanX = Math.max(1, maxX - minX)
  const spanY = Math.max(1, maxY - minY)

  mask.fill(0)

  const verticalPadding = Math.floor(GRID_SIZE * VERTICAL_PADDING_RATIO)
  const usableHeight = Math.max(2, GRID_SIZE - verticalPadding * 2)
  const usableWidth = Math.max(2, GRID_SIZE - HORIZONTAL_PADDING_CELLS * 2)

  keptCells.forEach((cell) => {
    const xRatio = spanX > 0 ? (cell.x - minX) / spanX : 0.5
    const yRatio = spanY > 0 ? (cell.y - minY) / spanY : 0.5

    const targetX = clamp(
      Math.round(HORIZONTAL_PADDING_CELLS + xRatio * (usableWidth - 1)),
      0,
      GRID_SIZE - 1,
    )
    const targetY = clamp(
      Math.round(verticalPadding + yRatio * (usableHeight - 1)),
      0,
      GRID_SIZE - 1,
    )

    const cellIndex = targetY * GRID_SIZE + targetX
    const normalizedCoverage = maxCoverage > 0 ? clamp((cell.coverage / maxCoverage) ** 0.85, 0, 1) : 0

    if (mask[cellIndex] >= normalizedCoverage) {
      return
    }

    const offset = cellIndex * 3
    const [r, g, b] = sampleGradient(xRatio)
    colors[offset] = r
    colors[offset + 1] = g
    colors[offset + 2] = b
    mask[cellIndex] = normalizedCoverage

    if (cellIndexLookup[cellIndex] === -1) {
      cellIndexLookup[cellIndex] = cellIndices.length
      cellIndices.push(cellIndex)
    }
  })

  for (let cellIndex = 0; cellIndex < totalCells; cellIndex += 1) {
    if (cellIndexLookup[cellIndex] !== -1) {
      continue
    }
    const offset = cellIndex * 3
    colors[offset] = DEFAULT_COLOR[0]
    colors[offset + 1] = DEFAULT_COLOR[1]
    colors[offset + 2] = DEFAULT_COLOR[2]
    mask[cellIndex] = 0
  }

  assertInvariant(cellIndices.length > 0, 'text sampling produced empty mask')

  const maskSamples = cellIndices.map((index) => mask[index])
  const maxValue = Math.max(...maskSamples)
  const minValue = Math.min(...maskSamples)

  assertInvariant(Number.isFinite(maxValue) && maxValue > 0, 'mask is missing positive coverage values')
  assertInvariant(maxValue <= 1.01, 'mask coverage exceeds normalized range')
  assertInvariant(minValue >= 0, 'mask coverage contains negative values')

  if (typeof window !== 'undefined') {
    const debug = {
      mask,
      colors,
      cellIndices,
      toDataURL: () => {
        const debugCanvas = document.createElement('canvas')
        debugCanvas.width = GRID_SIZE
        debugCanvas.height = GRID_SIZE
        const debugCtx = debugCanvas.getContext('2d')
        if (!debugCtx) {
          return ''
        }
        const imageData = debugCtx.createImageData(GRID_SIZE, GRID_SIZE)
        for (let i = 0; i < mask.length; i += 1) {
          const value = mask[i]
          const colorOffset = i * 4
          const sampleOffset = i * 3
          imageData.data[colorOffset] = colors[sampleOffset]
          imageData.data[colorOffset + 1] = colors[sampleOffset + 1]
          imageData.data[colorOffset + 2] = colors[sampleOffset + 2]
          imageData.data[colorOffset + 3] = Math.round(clamp(value, 0, 1) * 255)
        }
        debugCtx.putImageData(imageData, 0, 0)
        return debugCanvas.toDataURL('image/png')
      },
    }
    ;(window as any).__visualcoreDebug = debug
  }

  return {
    mask,
    colors,
    cellIndices: Int32Array.from(cellIndices),
    cellIndexLookup,
  }
}

const PixelGrid = ({ phase, onScatterStart, onScatterComplete, scatterSignal }: PixelGridProps) => {

  const textData = useMemo(createTextData, [])

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const dprRef = useRef<number>(window.devicePixelRatio || 1)
  const metricsRef = useRef<{ offsetX: number; offsetY: number; cellSize: number }>({
    offsetX: 0,
    offsetY: 0,
    cellSize: 1,
  })

  const intensitiesRef = useRef<Float32Array>(new Float32Array(GRID_SIZE * GRID_SIZE))
  const textScatterFlagsRef = useRef<Uint8Array>(new Uint8Array(textData.cellIndices.length))
  const remainingTextCellsRef = useRef<number>(textData.cellIndices.length)
  const scatterStartedRef = useRef<boolean>(false)
  const scatterCompleteRef = useRef<boolean>(false)
  const scatterCompletionGuardRef = useRef<number | null>(null)
  const scatterTimersRef = useRef<number[]>([])
  const explosionTimersRef = useRef<number[]>([])
  const rippleTimersRef = useRef<number[]>([])
  const phaseRef = useRef<Phase>(phase)
  const lastScatterSignalRef = useRef<number>(scatterSignal)

  const clearScatterTimers = useCallback(() => {
    scatterTimersRef.current.forEach((timer) => window.clearTimeout(timer))
    scatterTimersRef.current = []
  }, [])

  const clearExplosionTimers = useCallback(() => {
    explosionTimersRef.current.forEach((timer) => window.clearTimeout(timer))
    explosionTimersRef.current = []
  }, [])

  const clearRippleTimers = useCallback(() => {
    rippleTimersRef.current.forEach((timer) => window.clearTimeout(timer))
    rippleTimersRef.current = []
  }, [])

  const clearScatterCompletionGuard = useCallback(() => {
    if (scatterCompletionGuardRef.current !== null) {
      window.clearTimeout(scatterCompletionGuardRef.current)
      scatterCompletionGuardRef.current = null
    }
  }, [])

  const ensureScatterCompletionGuard = useCallback(() => {
    if (scatterCompletionGuardRef.current !== null) {
      return
    }

    scatterCompletionGuardRef.current = window.setTimeout(() => {
      scatterCompletionGuardRef.current = null
      if (!scatterCompleteRef.current) {
        scatterCompleteRef.current = true
        onScatterComplete()
      }
    }, SCATTER_DURATION + EXPLOSION_DURATION_MS + 400)
  }, [onScatterComplete])

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
    const { offsetX, offsetY, cellSize } = metricsRef.current
    const intensities = intensitiesRef.current
    const { mask, colors } = textData
    const currentPhase = phaseRef.current
    const textVisibility = currentPhase === 'intro' ? 1 : currentPhase === 'transition' ? 0.55 : 0

    ctx.fillStyle = BACKGROUND_COLOR
    ctx.fillRect(0, 0, width, height)

    for (let y = 0; y < GRID_SIZE; y += 1) {
      const rowOffset = y * GRID_SIZE
      for (let x = 0; x < GRID_SIZE; x += 1) {
        const cellIndex = rowOffset + x
        const coverage = mask[cellIndex]
        const intensity = intensities[cellIndex]

        if (coverage <= 0 && intensity <= MIN_VISIBLE_INTENSITY) {
          continue
        }

        const colorOffset = cellIndex * 3
        const baseR = colors[colorOffset]
        const baseG = colors[colorOffset + 1]
        const baseB = colors[colorOffset + 2]

        const normalizedCoverage = coverage > 0 ? Math.max(coverage, 0.45) : 0
        const baseAlpha = normalizedCoverage > 0 ? TEXT_ALPHA * textVisibility * normalizedCoverage : 0
        const highlightAlpha = intensity * HIGHLIGHT_ALPHA
        const finalAlpha = Math.min(baseAlpha + highlightAlpha, 1)
        if (finalAlpha <= 0) {
          continue
        }

        const highlightBoost = Math.min(1, intensity * 0.6 + normalizedCoverage * 0.35 * textVisibility)
        const r = Math.round(baseR + (255 - baseR) * highlightBoost)
        const g = Math.round(baseG + (255 - baseG) * highlightBoost)
        const b = Math.round(baseB + (255 - baseB) * highlightBoost)

        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${finalAlpha})`
        ctx.fillRect(offsetX + x * cellSize, offsetY + y * cellSize, cellSize, cellSize)
      }
    }
  }, [textData])

  const decayIntensities = useCallback(() => {
    const intensities = intensitiesRef.current
    const flags = textScatterFlagsRef.current
    const textCells = textData.cellIndices
    let hasEnergy = false

    if (phaseRef.current !== 'grid') {
      for (let index = 0; index < textCells.length; index += 1) {
        if (flags[index] === 0) {
          const cellIndex = textCells[index]
          intensities[cellIndex] = 1
          hasEnergy = true
        }
      }
    }

    for (let index = 0; index < intensities.length; index += 1) {
      const value = intensities[index]
      if (value <= MIN_VISIBLE_INTENSITY) {
        intensities[index] = 0
        continue
      }

      const next = value * DECAY_FACTOR
      intensities[index] = next <= MIN_VISIBLE_INTENSITY ? 0 : next
      if (intensities[index] > 0) {
        hasEnergy = true
      }
    }

    return hasEnergy
  }, [textData.cellIndices])

  const frame = useCallback(() => {
    animationFrameRef.current = null
    const hasEnergy = decayIntensities()
    draw()

    if (phaseRef.current !== 'grid' || hasEnergy) {
      animationFrameRef.current = window.requestAnimationFrame(frame)
    }
  }, [decayIntensities, draw])

  const scheduleFrame = useCallback(() => {
    if (animationFrameRef.current !== null) {
      return
    }
    animationFrameRef.current = window.requestAnimationFrame(frame)
  }, [frame])

  const igniteCell = useCallback(
    (cellX: number, cellY: number, intensity = 1) => {
      if (cellX < 0 || cellX >= GRID_SIZE || cellY < 0 || cellY >= GRID_SIZE) {
        return
      }

      const index = cellY * GRID_SIZE + cellX
      const intensities = intensitiesRef.current
      intensities[index] = Math.max(intensities[index], Math.min(Math.max(intensity, 0), 1))
      scheduleFrame()
    },
    [scheduleFrame],
  )

  const applyRipple = useCallback(
    (cellX: number, cellY: number) => {
      clearRippleTimers()

      const queue: Array<{ x: number; y: number; intensity: number; depth: number }> = [
        { x: cellX, y: cellY, intensity: 1, depth: 0 },
      ]
      const visited = new Set<string>()

      for (let index = 0; index < queue.length; index += 1) {
        const { x, y, intensity, depth } = queue[index]
        if (x < 0 || x >= GRID_SIZE || y < 0 || y >= GRID_SIZE) {
          continue
        }

        const key = `${x},${y}`
        if (visited.has(key)) {
          continue
        }
        visited.add(key)

        const timeout = window.setTimeout(() => {
          igniteCell(x, y, intensity)
        }, depth * RIPPLE_STEP_DELAY_MS)
        rippleTimersRef.current.push(timeout)

        const nextIntensity = intensity * 0.5
        if (nextIntensity < MIN_RIPPLE_INTENSITY) {
          continue
        }

        for (const [dx, dy] of RIPPLE_OFFSETS) {
          queue.push({ x: x + dx, y: y + dy, intensity: nextIntensity, depth: depth + 1 })
        }
      }
    },
    [igniteCell],
  )

  const scatterCell = useCallback(
    (cellIndex: number) => {
      const textIndex = textData.cellIndexLookup[cellIndex]
      if (textIndex === -1) {
        return
      }

      const flags = textScatterFlagsRef.current
      if (flags[textIndex] === 1) {
        return
      }

      flags[textIndex] = 1
      remainingTextCellsRef.current -= 1
      ensureScatterCompletionGuard()

      if (!scatterStartedRef.current) {
        scatterStartedRef.current = true
        onScatterStart()
      }

      const cellX = cellIndex % GRID_SIZE
      const cellY = Math.floor(cellIndex / GRID_SIZE)
      const angle = Math.random() * Math.PI * 2
      const magnitude = 12 + Math.random() * 8
      const vx = Math.cos(angle) * magnitude
      const vy = Math.sin(angle) * magnitude

      for (let stepIndex = 1; stepIndex <= SCATTER_STEPS; stepIndex += 1) {
        const progress = stepIndex / SCATTER_STEPS
        const targetX = Math.round(cellX + vx * progress)
        const targetY = Math.round(cellY + vy * progress)
        const delay = progress * SCATTER_DURATION * 0.9
        const intensity = Math.max(0.1, 1 - progress * 0.85)

        const timer = window.setTimeout(() => {
          igniteCell(targetX, targetY, intensity)
        }, delay)
        scatterTimersRef.current.push(timer)
      }

      const completionTimer = window.setTimeout(() => {
        if (!scatterCompleteRef.current && remainingTextCellsRef.current <= 0) {
          clearScatterCompletionGuard()
          scatterCompleteRef.current = true
          onScatterComplete()
        }
      }, SCATTER_DURATION + 180)
      scatterTimersRef.current.push(completionTimer)
    },
    [
      clearScatterCompletionGuard,
      ensureScatterCompletionGuard,
      igniteCell,
      onScatterComplete,
      onScatterStart,
      textData.cellIndexLookup,
    ],
  )

  const getCellFromEvent = useCallback((event: PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) {
      return null
    }

    const rect = canvas.getBoundingClientRect()
    const dpr = dprRef.current
    const { offsetX, offsetY, cellSize } = metricsRef.current

    const positionX = (event.clientX - rect.left) * dpr - offsetX
    const positionY = (event.clientY - rect.top) * dpr - offsetY

    if (positionX < 0 || positionY < 0) {
      return null
    }

    const cellX = Math.floor(positionX / cellSize)
    const cellY = Math.floor(positionY / cellSize)

    if (cellX < 0 || cellX >= GRID_SIZE || cellY < 0 || cellY >= GRID_SIZE) {
      return null
    }

    return { cellX, cellY, cellIndex: cellY * GRID_SIZE + cellX }
  }, [])

  const handlePointerActivation = useCallback(
    (event: PointerEvent<HTMLCanvasElement>) => {
      const coords = getCellFromEvent(event)
      if (!coords) {
        return
      }

      igniteCell(coords.cellX, coords.cellY, 1)
      scatterCell(coords.cellIndex)
      applyRipple(coords.cellX, coords.cellY)
    },
    [applyRipple, getCellFromEvent, igniteCell, scatterCell],
  )

  const triggerExplosion = useCallback(
    (event: PointerEvent<HTMLCanvasElement>) => {
      const coords = getCellFromEvent(event)
      if (!coords) {
        return
      }

      const { cellX, cellY } = coords
      clearExplosionTimers()

      for (let dy = -EXPLOSION_RADIUS; dy <= EXPLOSION_RADIUS; dy += 1) {
        for (let dx = -EXPLOSION_RADIUS; dx <= EXPLOSION_RADIUS; dx += 1) {
          const distance = Math.hypot(dx, dy)
          if (distance > EXPLOSION_RADIUS) {
            continue
          }

          const targetX = cellX + dx
          const targetY = cellY + dy
          if (targetX < 0 || targetX >= GRID_SIZE || targetY < 0 || targetY >= GRID_SIZE) {
            continue
          }

          const normalized = distance / Math.max(EXPLOSION_RADIUS, 1)
          const delay = normalized * EXPLOSION_DURATION_MS
          const intensity = Math.max(0.25, 1 - normalized * 0.75)

          const timer = window.setTimeout(() => {
            igniteCell(targetX, targetY, intensity)
            scatterCell(targetY * GRID_SIZE + targetX)
          }, delay)

          explosionTimersRef.current.push(timer)
        }
      }
    },
    [clearExplosionTimers, getCellFromEvent, igniteCell, scatterCell],
  )

  const scatterAll = useCallback(() => {
    const indices = textData.cellIndices
    if (indices.length === 0) {
      return
    }

    clearScatterTimers()
    clearExplosionTimers()
    clearRippleTimers()

    indices.forEach((cellIndex, order) => {
      const delay = (order / indices.length) * 240
      const timer = window.setTimeout(() => {
        scatterCell(cellIndex)
      }, delay)
      scatterTimersRef.current.push(timer)
    })
  }, [clearExplosionTimers, clearRippleTimers, clearScatterTimers, scatterCell, textData.cellIndices])

  useEffect(() => {
    if (scatterSignal === lastScatterSignalRef.current) {
      return
    }

    lastScatterSignalRef.current = scatterSignal

    textScatterFlagsRef.current.fill(0)
    remainingTextCellsRef.current = textData.cellIndices.length
    scatterStartedRef.current = false
    scatterCompleteRef.current = false

    clearScatterTimers()
    clearExplosionTimers()
    clearRippleTimers()
    clearScatterCompletionGuard()

    scatterAll()

    if (!scatterStartedRef.current) {
      scatterStartedRef.current = true
      onScatterStart()
    }

    scatterCompletionGuardRef.current = window.setTimeout(() => {
      if (!scatterCompleteRef.current) {
        scatterCompleteRef.current = true
        onScatterComplete()
      }
    }, SCATTER_DURATION + EXPLOSION_DURATION_MS + 300)
  }, [
    clearExplosionTimers,
    clearRippleTimers,
    clearScatterCompletionGuard,
    clearScatterTimers,
    onScatterComplete,
    onScatterStart,
    scatterAll,
    scatterSignal,
    textData.cellIndices.length,
  ])

  const resize = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }

    const dpr = window.devicePixelRatio || 1
    dprRef.current = dpr

    const displayWidth = window.innerWidth
    const displayHeight = window.innerHeight

    canvas.width = Math.floor(displayWidth * dpr)
    canvas.height = Math.floor(displayHeight * dpr)
    canvas.style.width = `${displayWidth}px`
    canvas.style.height = `${displayHeight}px`

    const cellSize = Math.max(canvas.width / GRID_SIZE, canvas.height / GRID_SIZE)
    const gridWidth = cellSize * GRID_SIZE
    const gridHeight = cellSize * GRID_SIZE

    metricsRef.current = {
      offsetX: (canvas.width - gridWidth) / 2,
      offsetY: (canvas.height - gridHeight) / 2,
      cellSize,
    }

    draw()
  }, [draw])

  useEffect(() => {
    resize()
    window.addEventListener('resize', resize)
    scheduleFrame()

    return () => {
      window.removeEventListener('resize', resize)
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current)
      }
      clearScatterTimers()
      clearExplosionTimers()
      clearRippleTimers()
      clearScatterCompletionGuard()
    }
  }, [
    clearExplosionTimers,
    clearRippleTimers,
    clearScatterCompletionGuard,
    clearScatterTimers,
    resize,
    scheduleFrame,
  ])

  useEffect(() => {
    phaseRef.current = phase
    if (phase === 'intro' && scatterStartedRef.current) {
      textScatterFlagsRef.current.fill(0)
      remainingTextCellsRef.current = textData.cellIndices.length
      scatterStartedRef.current = false
      scatterCompleteRef.current = false
      intensitiesRef.current.fill(0)
      clearScatterTimers()
      clearExplosionTimers()
      clearRippleTimers()
      clearScatterCompletionGuard()
    }
    scheduleFrame()
  }, [
    clearExplosionTimers,
    clearRippleTimers,
    clearScatterCompletionGuard,
    clearScatterTimers,
    phase,
    scheduleFrame,
    textData.cellIndices.length,
  ])

  useEffect(() => {
    if (scatterSignal === lastScatterSignalRef.current) {
      return
    }
    lastScatterSignalRef.current = scatterSignal
    scatterAll()
  }, [scatterAll, scatterSignal])

  const handlePointerDown = useCallback(
    (event: PointerEvent<HTMLCanvasElement>) => {
      handlePointerActivation(event)
      triggerExplosion(event)
    },
    [handlePointerActivation, triggerExplosion],
  )

  return (
    <canvas
      ref={canvasRef}
      className="h-full w-full touch-none"
      onPointerMove={handlePointerActivation}
      onPointerEnter={handlePointerActivation}
      onPointerDown={handlePointerDown}
    />
  )
}

export default PixelGrid
export { createTextData }
