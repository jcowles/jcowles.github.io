import { useCallback, useEffect, useMemo, useRef, type PointerEvent } from 'react'

export type Phase = 'intro' | 'transition' | 'grid'

interface PixelGridProps {
  phase: Phase
  onScatterStart: () => void
  onScatterComplete: () => void
  scatterSignal: number
  curlAmount?: number
}

const GRID_SIZE = 98
const TEXT_ALPHA = 0.85
const HIGHLIGHT_ALPHA = 0.96
const DECAY_FACTOR = 0.965
const MIN_VISIBLE_INTENSITY = 0.001
const MIN_RIPPLE_INTENSITY = 0.06
const BACKGROUND_COLOR = '#082c4a'
const SCATTER_DURATION = 3000
const RIPPLE_STEP_DELAY_MS = 22
const EXPLOSION_RADIUS = 100
const EXPLOSION_DURATION_MS = 380

const TEXT_CONTENT = 'VISUALCORE'
const TEXT_SCALE_RATIO = 0.14

const DEFAULT_COLOR: [number, number, number] = [118, 99, 255]
const GRADIENT_STOPS: Array<{ stop: number; color: [number, number, number] }> = [
  { stop: 0, color: [116, 92, 255] },
  { stop: 0.55, color: [255, 93, 210] },
  { stop: 1, color: [108, 201, 255] },
]

const CANVAS_SCALE = 18
const HORIZONTAL_MARGIN_CELLS = 2
const VERTICAL_MARGIN_RATIO = 0.35
const MIN_CELLS_RATIO = 0.02
const MAX_CELLS_RATIO = 0.2
const COVERAGE_THRESHOLD = 0.35
const MAX_ALPHA_MULTIPLIER = 1
const SAMPLE_ALPHA_THRESHOLD = 0.5

const GLOBAL_EXPLOSION_BASE_SPEED = 1.45
const GLOBAL_EXPLOSION_SPEED_JITTER = 0.55
const GLOBAL_EXPLOSION_GRAVITY = 0.22
const GLOBAL_EXPLOSION_DRAG = 0.96
const GLOBAL_EXPLOSION_INTENSITY_DECAY = 0.92
const GLOBAL_EXPLOSION_INTERACTIVE_DELAY_MS = 3200
const TEXT_REVEAL_DURATION_MS = 3000
const TEXT_REVEAL_SMOOTHING = 0.08
const HIGHLIGHT_BLEND = 0.5
const AUTO_SCATTER_INTERVAL_MS =
  Math.max(SCATTER_DURATION + EXPLOSION_DURATION_MS, TEXT_REVEAL_DURATION_MS) + 600
const SCATTER_PARTICLE_SPEED_MIN = .01
const SCATTER_PARTICLE_SPEED_MAX = .5
const SCATTER_PARTICLE_DRAG = 0.9
const SCATTER_PARTICLE_INTENSITY_DECAY = 0.98
const SCATTER_PARTICLE_MIN_INTENSITY = .4
const SCATTER_PARTICLE_MAX_AGE_MS = 500
const SCATTER_PARTICLE_MAX_COUNT = 800
const SCATTER_PARTICLE_FRAME_MS = 1000 / 60
const TRAIL_RELEASE_MAX_AGE_MS = 400
const SCATTER_PARTICLE_SPAWN_COOLDOWN_MS = 140
const SCATTER_PARTICLE_CURL_DEFAULT = .25
const CURL_NOISE_SCALE = 5
const CURL_NOISE_EPSILON = 1



const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))


const computeSweepReveal = (progress: number, ratio: number) => {
  if (progress <= 0) {
    return 0
  }
  if (progress >= 1) {
    return 1
  }

  const tolerance = Math.max(TEXT_REVEAL_SMOOTHING, 0)
  return progress + tolerance >= ratio ? 1 : 0
}

const sampleNoise = (x: number, y: number, time: number) => {
  const nx = x * CURL_NOISE_SCALE
  const ny = y * CURL_NOISE_SCALE
  const t = time * 0.0006
  return (
    Math.sin(nx * 12.9898 + ny * 78.233 + t * 19.19) +
    Math.cos(nx * 6.153 + ny * 27.897 + t * 11.73)
  )
}

const computeCurlNoise = (x: number, y: number, time: number) => {
  const eps = CURL_NOISE_EPSILON
  const sample = (sx: number, sy: number) => sampleNoise(sx, sy, time)
  const dy = sample(x, y + eps) - sample(x, y - eps)
  const dx = sample(x + eps, y) - sample(x - eps, y)
  return { x: dy * 0.5, y: -dx * 0.5 }
}

function assertInvariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`[PixelGrid] ${message}`)
  }
}

interface DownsampledCell {
  cellIndex: number
  coverage: number
  x: number
  y: number
  color: [number, number, number]
}

interface ExplosionParticle {
  x: number
  y: number
  vx: number
  vy: number
  intensity: number
  color: [number, number, number]
}

interface ScatterParticle {
  x: number
  y: number
  vx: number
  vy: number
  intensity: number
  ageMs: number
  lastCellIndex: number
}

const downsampleCanvasCoverage = (
  imageData: Uint8ClampedArray,
  canvasWidth: number,
  canvasHeight: number,
  gridSize: number,
  scale: number,
  alphaThreshold: number,
  coverageThreshold: number,
): { cells: DownsampledCell[]; maxCoverage: number } => {
  const cells: DownsampledCell[] = []
  let maxCoverage = 0

  for (let gridY = 0; gridY < gridSize; gridY += 1) {
    for (let gridX = 0; gridX < gridSize; gridX += 1) {
      let positiveCount = 0
      let sampleCount = 0
      let rSum = 0
      let gSum = 0
      let bSum = 0

      for (let sy = 0; sy < scale; sy += 1) {
        const pixelY = gridY * scale + sy
        if (pixelY >= canvasHeight) {
          continue
        }
        for (let sx = 0; sx < scale; sx += 1) {
          const pixelX = gridX * scale + sx
          if (pixelX >= canvasWidth) {
            continue
          }
          const pixelIndex = (pixelY * canvasWidth + pixelX) * 4
          const r = imageData[pixelIndex]
          const g = imageData[pixelIndex + 1]
          const b = imageData[pixelIndex + 2]
          const intensity = Math.max(r, g, b) / 255
          sampleCount += 1
          if (intensity >= alphaThreshold) {
            positiveCount += 1
            rSum += r
            gSum += g
            bSum += b
          }
        }
      }

      if (sampleCount === 0) {
        continue
      }

      const coverage = positiveCount / sampleCount
      if (coverage < coverageThreshold) {
        continue
      }

      const color: [number, number, number] = [
        Math.round(rSum / Math.max(positiveCount, 1)),
        Math.round(gSum / Math.max(positiveCount, 1)),
        Math.round(bSum / Math.max(positiveCount, 1)),
      ]

      maxCoverage = Math.max(maxCoverage, coverage)
      cells.push({ cellIndex: gridY * gridSize + gridX, coverage, x: gridX, y: gridY, color })
    }
  }

  return { cells, maxCoverage }
}

const createMaskPreview = (mask: Float32Array, colors: Float32Array): string => {


  if (typeof document === 'undefined') {
    return ''
  }

  const previewCanvas = document.createElement('canvas')
  previewCanvas.width = GRID_SIZE
  previewCanvas.height = GRID_SIZE
  const previewCtx = previewCanvas.getContext('2d')
  if (!previewCtx) {
    return ''
  }

  previewCtx.clearRect(0, 0, GRID_SIZE, GRID_SIZE)
  previewCtx.fillStyle = '#05060f'
  previewCtx.fillRect(0, 0, GRID_SIZE, GRID_SIZE)
  previewCtx.imageSmoothingEnabled = false

  if (typeof previewCtx.createImageData === 'function') {
    const imageData = previewCtx.createImageData(GRID_SIZE, GRID_SIZE)
    for (let i = 0; i < mask.length; i += 1) {
      const value = clamp(mask[i], 0, 1)
      const offset = i * 4
      const colorOffset = i * 3
      imageData.data[offset] = colors[colorOffset]
      imageData.data[offset + 1] = colors[colorOffset + 1]
      imageData.data[offset + 2] = colors[colorOffset + 2]
      imageData.data[offset + 3] = Math.round(value * 255)
    }
    previewCtx.putImageData(imageData, 0, 0)
  } else {
    for (let i = 0; i < mask.length; i += 1) {
      const value = clamp(mask[i], 0, 1)
      if (value <= 0) {
        continue
      }
      const x = i % GRID_SIZE
      const y = Math.floor(i / GRID_SIZE)
      const colorOffset = i * 3
      previewCtx.fillStyle = `rgba(${colors[colorOffset]}, ${colors[colorOffset + 1]}, ${colors[colorOffset + 2]}, ${value})`
      previewCtx.fillRect(x, y, 1, 1)
    }
  }

  return typeof previewCanvas.toDataURL === 'function' ? previewCanvas.toDataURL('image/png') : ''
}

const createFallbackTextData = (totalCells: number, cellIndexLookup: Int32Array): TextData => {
  const mask = new Float32Array(totalCells)
  const colors = new Float32Array(totalCells * 3)
  const revealRatios = new Float32Array(totalCells)
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
        revealRatios[cellIndex] = ratio
        cellIndexLookup[cellIndex] = cellIndices.length
        cellIndices.push(cellIndex)
      } else {
        colors[offset] = DEFAULT_COLOR[0]
        colors[offset + 1] = DEFAULT_COLOR[1]
        colors[offset + 2] = DEFAULT_COLOR[2]
        mask[cellIndex] = 0
        revealRatios[cellIndex] = 1
      }
    }
  }

  return {
    mask,
    colors,
    revealRatios,
    cellIndices: Int32Array.from(cellIndices),
    cellIndexLookup,
  }
}

interface TextData {
  mask: Float32Array
  colors: Float32Array
  revealRatios: Float32Array
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
  const revealRatios = new Float32Array(totalCells)
  revealRatios.fill(1)
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
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `700 ${Math.floor(canvas.height * TEXT_SCALE_RATIO)}px "Inter", "Poppins", sans-serif`

  if (typeof ctx.createLinearGradient === 'function') {
    const gradient = ctx.createLinearGradient(0, 0, canvas.width, 0)
    if (GRADIENT_STOPS.length > 0) {
      GRADIENT_STOPS.forEach(({ stop, color }) => {
        gradient.addColorStop(stop, `rgb(${color[0]}, ${color[1]}, ${color[2]})`)
      })
    } else {
      gradient.addColorStop(0, '#ffffff')
      gradient.addColorStop(1, '#ffffff')
    }
    ctx.fillStyle = gradient
  } else {
    ctx.fillStyle = '#ffffff'
  }

  ctx.fillText(TEXT_CONTENT, canvas.width / 2, canvas.height / 2)

  const sourceDataURL = typeof canvas.toDataURL === 'function' ? canvas.toDataURL('image/png') : ''
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height).data

  const { cells, maxCoverage } = downsampleCanvasCoverage(
    imageData,
    canvas.width,
    canvas.height,
    GRID_SIZE,
    CANVAS_SCALE,
    SAMPLE_ALPHA_THRESHOLD,
    COVERAGE_THRESHOLD,
  )

  if (cells.length === 0 || maxCoverage <= 0) {
    return createFallbackTextData(totalCells, cellIndexLookup)
  }

  cells.sort((a, b) => b.coverage - a.coverage)

  const minCells = Math.floor(GRID_SIZE * GRID_SIZE * MIN_CELLS_RATIO)
  const maxCells = Math.floor(GRID_SIZE * GRID_SIZE * MAX_CELLS_RATIO)
  const keepCount = clamp(cells.length, minCells, maxCells)
  const cutoff = Math.max(COVERAGE_THRESHOLD, cells[Math.min(keepCount - 1, cells.length - 1)].coverage)

  const keptCells = cells
    .filter((cell) => cell.coverage >= cutoff)
    .sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x))

  const minX = keptCells.reduce((acc, cell) => Math.min(acc, cell.x), GRID_SIZE - 1)
  const maxX = keptCells.reduce((acc, cell) => Math.max(acc, cell.x), 0)
  const minY = keptCells.reduce((acc, cell) => Math.min(acc, cell.y), GRID_SIZE - 1)
  const maxY = keptCells.reduce((acc, cell) => Math.max(acc, cell.y), 0)

  const width = Math.max(1, maxX - minX + 1)
  const height = Math.max(1, maxY - minY + 1)

  const maxOffsetX = Math.max(0, GRID_SIZE - width)
  const preferredOffsetX = Math.floor((GRID_SIZE - width) / 2)
  const offsetX = clamp(
    preferredOffsetX,
    Math.min(HORIZONTAL_MARGIN_CELLS, maxOffsetX),
    maxOffsetX,
  )

  const verticalMarginCells = Math.floor(GRID_SIZE * VERTICAL_MARGIN_RATIO)
  const maxOffsetY = Math.max(0, GRID_SIZE - height)
  const preferredOffsetY = Math.floor((GRID_SIZE - height) / 2)
  const offsetY = clamp(
    preferredOffsetY,
    Math.min(verticalMarginCells, maxOffsetY),
    maxOffsetY,
  )

  mask.fill(0)

  keptCells.forEach((cell) => {
    const targetX = clamp(cell.x - minX + offsetX, 0, GRID_SIZE - 1)
    const targetY = clamp(cell.y - minY + offsetY, 0, GRID_SIZE - 1)
    const cellIndex = targetY * GRID_SIZE + targetX

    const normalizedCoverage = clamp((cell.coverage / maxCoverage) * MAX_ALPHA_MULTIPLIER, 0, 1)

    if (mask[cellIndex] >= normalizedCoverage) {
      return
    }

    const offset = cellIndex * 3
    const ratio = width > 1 ? (cell.x - minX) / (width - 1) : 0.5
    const [r, g, b] = cell.color
    colors[offset] = r
    colors[offset + 1] = g
    colors[offset + 2] = b
    mask[cellIndex] = normalizedCoverage
    revealRatios[cellIndex] = ratio

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
    const x = cellIndex % GRID_SIZE
    const ratio = x / Math.max(1, GRID_SIZE - 1)
    const [r, g, b] = sampleGradient(ratio)
    colors[offset] = r
    colors[offset + 1] = g
    colors[offset + 2] = b
    mask[cellIndex] = 0
    revealRatios[cellIndex] = ratio
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
      sourceDataURL,
      toDataURL: () => createMaskPreview(mask, colors),
      showPreview: () => {
        const maskDataURL = debug.toDataURL()
        const sourceDataURL = debug.sourceDataURL
        if (!maskDataURL) {
          return
        }
        let container = document.getElementById('__visualcore-debug-preview') as HTMLDivElement | null
        if (!container) {
          container = document.createElement('div')
          container.id = '__visualcore-debug-preview'
          Object.assign(container.style, {
            position: 'fixed',
            top: '1rem',
            right: '1rem',
            padding: '0.5rem',
            background: 'rgba(5, 6, 15, 0.85)',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: '0.5rem',
            zIndex: '2147483647',
            pointerEvents: 'auto',
            color: '#fff',
            fontSize: '0.75rem',
            fontFamily: 'monospace',
            boxShadow: '0 12px 32px rgba(0,0,0,0.35)',
          })
          const close = document.createElement('button')
          close.type = 'button'
          close.textContent = '×'
          Object.assign(close.style, {
            position: 'absolute',
            top: '0.15rem',
            right: '0.3rem',
            border: 'none',
            background: 'transparent',
            color: '#fff',
            cursor: 'pointer',
            fontSize: '0.85rem',
          })
          close.addEventListener('click', () => {
            container?.remove()
          })
          container.append(close)
          const title = document.createElement('div')
          title.textContent = 'visualcore splash buffer'
          Object.assign(title.style, {
            marginBottom: '0.25rem',
          })
          container.append(title)

          const maskLabel = document.createElement('div')
          maskLabel.textContent = 'Sampled mask'
          Object.assign(maskLabel.style, {
            marginBottom: '0.15rem',
          })
          container.append(maskLabel)

          const maskImg = document.createElement('img')
          maskImg.dataset.type = 'mask'
          Object.assign(maskImg.style, {
            width: '128px',
            height: '128px',
            imageRendering: 'pixelated',
            display: 'block',
            marginBottom: '0.35rem',
            border: '1px solid rgba(255,255,255,0.12)',
          })
          container.append(maskImg)

          const sourceLabel = document.createElement('div')
          sourceLabel.dataset.type = 'source-label'
          sourceLabel.textContent = 'Canvas source'
          Object.assign(sourceLabel.style, {
            marginBottom: '0.15rem',
            display: 'none',
          })
          container.append(sourceLabel)

          const sourceImg = document.createElement('img')
          sourceImg.dataset.type = 'source'
          Object.assign(sourceImg.style, {
            width: '128px',
            height: '128px',
            imageRendering: 'pixelated',
            display: 'none',
            border: '1px solid rgba(255,255,255,0.12)',
          })
          container.append(sourceImg)

          document.body.append(container)
        }

        const maskImg = container.querySelector('img[data-type="mask"]') as HTMLImageElement | null
        if (maskImg) {
          maskImg.src = maskDataURL
        }

        const sourceImg = container.querySelector('img[data-type="source"]') as HTMLImageElement | null
        const sourceLabel = container.querySelector('[data-type="source-label"]') as HTMLDivElement | null
        if (sourceDataURL && sourceImg && sourceLabel) {
          sourceImg.src = sourceDataURL
          sourceImg.style.display = 'block'
          sourceLabel.style.display = 'block'
        } else if (sourceImg && sourceLabel) {
          sourceImg.style.display = 'none'
          sourceLabel.style.display = 'none'
        }
      },
    }
    ;(window as any).__visualcoreDebug = debug

    const isTestEnv = typeof globalThis !== 'undefined' && (globalThis as any).process?.env?.NODE_ENV === 'test'
    const isProdEnv = typeof import.meta !== 'undefined' && (import.meta as any).env?.MODE === 'production'
    const autoPreviewSetting = (window as any).__VISUALCORE_AUTO_PREVIEW
    const shouldAutoPreview = !isTestEnv && !isProdEnv && (autoPreviewSetting === undefined ? true : Boolean(autoPreviewSetting))
    if (shouldAutoPreview && typeof document !== 'undefined') {
      debug.showPreview()
    }
  }

  return {
    mask,
    colors,
    revealRatios,
    cellIndices: Int32Array.from(cellIndices),
    cellIndexLookup,
  }
}

const PixelGrid = ({ phase, onScatterStart, onScatterComplete, scatterSignal, curlAmount }: PixelGridProps) => {


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
  const globalExplosionParticlesRef = useRef<ExplosionParticle[]>([])
  const globalExplosionActiveRef = useRef<boolean>(false)
  const firstInteractionHandledRef = useRef<boolean>(false)
  const interactiveEnabledRef = useRef<boolean>(false)
  const interactiveEnableTimerRef = useRef<number | null>(null)
  const lastFrameTimeRef = useRef<number | null>(null)
  const textRevealProgressRef = useRef<number>(0)
  const autoScatterTimerRef = useRef<number | null>(null)
  const scatterActiveRef = useRef<boolean>(false)
  const pendingForcedScatterRef = useRef<boolean>(false)
  const completeScatterRef = useRef<() => void>(() => {})
  const scatterParticlesRef = useRef<ScatterParticle[]>([])
  const scatterCellRef = useRef<
    (cellIndex: number, options?: { intensity?: number; allowDuplicate?: boolean }) => void
  >(() => {})
  const pendingTextScatterRef = useRef<number[]>([])
  const lastParticleSpawnRef = useRef<Float32Array>(new Float32Array(GRID_SIZE * GRID_SIZE))
  const intensityAgeRef = useRef<Float32Array>(new Float32Array(GRID_SIZE * GRID_SIZE))
  const highlightActiveRef = useRef<number[]>([])
  const highlightActiveFlagsRef = useRef<Uint8Array>(new Uint8Array(GRID_SIZE * GRID_SIZE))
  const curlAmountRef = useRef<number>(curlAmount ?? SCATTER_PARTICLE_CURL_DEFAULT)
  const noiseTimeRef = useRef<number>(0)
  const frameRunningRef = useRef<boolean>(false)
  const framePendingRef = useRef<boolean>(false)
  const textRevealTriggeredRef = useRef<Uint8Array>(new Uint8Array(textData.cellIndices.length))
  const particleSpawnInitRef = useRef(false)

  if (!particleSpawnInitRef.current) {
    lastParticleSpawnRef.current.fill(-Infinity)
    intensityAgeRef.current.fill(0)
    highlightActiveFlagsRef.current.fill(0)
    highlightActiveRef.current.length = 0
    particleSpawnInitRef.current = true
  }

  useEffect(() => {
    curlAmountRef.current = typeof curlAmount === 'number' ? curlAmount : SCATTER_PARTICLE_CURL_DEFAULT
  }, [curlAmount])



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

  const depositIntensity = useCallback((cellIndex: number, value: number) => {
    const intensities = intensitiesRef.current
    const ages = intensityAgeRef.current
    const highlightFlags = highlightActiveFlagsRef.current
    if (cellIndex < 0 || cellIndex >= intensities.length || value <= 0) {
      return
    }
    const clamped = Math.min(1, value)
    if (intensities[cellIndex] < clamped) {
      intensities[cellIndex] = clamped
    }
    ages[cellIndex] = 0

    if (
      clamped > MIN_VISIBLE_INTENSITY &&
      highlightFlags[cellIndex] === 0 &&
      textData.mask[cellIndex] <= 0
    ) {
      highlightFlags[cellIndex] = 1
      highlightActiveRef.current.push(cellIndex)
    }
  }, [highlightActiveFlagsRef, highlightActiveRef, textData.mask])

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
        completeScatterRef.current()
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
    const { mask, colors, revealRatios } = textData
    const currentPhase = phaseRef.current
    const revealProgress = textRevealProgressRef.current
    const phaseVisibility = currentPhase === 'intro' ? 1 : currentPhase === 'transition' ? 0.65 : 0.45

    ctx.fillStyle = BACKGROUND_COLOR
    ctx.fillRect(0, 0, width, height)

    if (globalExplosionActiveRef.current && globalExplosionParticlesRef.current.length > 0) {
      const explosionCellSize = metricsRef.current.cellSize
      const drawSize = Math.max(explosionCellSize * 0.9, 1)
      const sizeOffset = (explosionCellSize - drawSize) / 2

      for (let index = 0; index < globalExplosionParticlesRef.current.length; index += 1) {
        const particle = globalExplosionParticlesRef.current[index]
        if (particle.intensity <= MIN_VISIBLE_INTENSITY) {
          continue
        }

        const alpha = Math.min(1, particle.intensity)
        const centerX = offsetX + particle.x * explosionCellSize
        const centerY = offsetY + particle.y * explosionCellSize
        const drawX = centerX - explosionCellSize / 2 + sizeOffset
        const drawY = centerY - explosionCellSize / 2 + sizeOffset
        ctx.fillStyle = `rgba(${particle.color[0]}, ${particle.color[1]}, ${particle.color[2]}, ${alpha})`
        ctx.fillRect(drawX, drawY, drawSize, drawSize)
      }

      return
    }

    const textCells = textData.cellIndices
    for (let index = 0; index < textCells.length; index += 1) {
      const cellIndex = textCells[index]
      const coverage = mask[cellIndex]
      const intensity = intensities[cellIndex]
      const revealRatio = revealRatios[cellIndex]
      const revealWeight = computeSweepReveal(revealProgress, revealRatio)

      if (coverage <= 0 && intensity <= MIN_VISIBLE_INTENSITY && revealWeight <= 0) {
        continue
      }

      const colorOffset = cellIndex * 3
      const baseR = colors[colorOffset]
      const baseG = colors[colorOffset + 1]
      const baseB = colors[colorOffset + 2]

      const normalizedCoverage = coverage > 0 ? Math.max(coverage, revealWeight) : 0
      const hasTextFill = normalizedCoverage > 0 && revealWeight > 0
      const baseVisibility = hasTextFill ? phaseVisibility * revealWeight : 0
      const baseAlpha = hasTextFill ? TEXT_ALPHA * baseVisibility * normalizedCoverage : 0

      const highlightAlpha = intensity > 0 ? intensity * HIGHLIGHT_ALPHA : 0
      const finalAlpha = Math.min(baseAlpha + highlightAlpha, 1)
      if (finalAlpha <= 0) {
        continue
      }

      const highlightStrength = Math.min(1, intensity * HIGHLIGHT_BLEND)
      const r = Math.round(baseR + (255 - baseR) * highlightStrength)
      const g = Math.round(baseG + (255 - baseG) * highlightStrength)
      const b = Math.round(baseB + (255 - baseB) * highlightStrength)

      const cellX = cellIndex % GRID_SIZE
      const cellY = Math.floor(cellIndex / GRID_SIZE)
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${finalAlpha})`
      ctx.fillRect(offsetX + cellX * cellSize, offsetY + cellY * cellSize, cellSize, cellSize)
    }

    const highlightFlags = highlightActiveFlagsRef.current
    const highlightList = highlightActiveRef.current
    for (let listIndex = highlightList.length - 1; listIndex >= 0; listIndex -= 1) {
      const cellIndex = highlightList[listIndex]
      if (highlightFlags[cellIndex] === 0) {
        highlightList[listIndex] = highlightList[highlightList.length - 1]
        highlightList.pop()
        continue
      }

      const intensity = intensities[cellIndex]
      if (intensity <= MIN_VISIBLE_INTENSITY) {
        highlightFlags[cellIndex] = 0
        highlightList[listIndex] = highlightList[highlightList.length - 1]
        highlightList.pop()
        continue
      }

      if (mask[cellIndex] > 0) {
        continue
      }

      const highlightAlpha = Math.min(1, intensity * HIGHLIGHT_ALPHA)
      if (highlightAlpha <= 0) {
        highlightFlags[cellIndex] = 0
        highlightList[listIndex] = highlightList[highlightList.length - 1]
        highlightList.pop()
        continue
      }

      const colorOffset = cellIndex * 3
      const baseR = colors[colorOffset]
      const baseG = colors[colorOffset + 1]
      const baseB = colors[colorOffset + 2]
      const highlightStrength = Math.min(1, intensity * HIGHLIGHT_BLEND)
      const r = Math.round(baseR + (255 - baseR) * highlightStrength)
      const g = Math.round(baseG + (255 - baseG) * highlightStrength)
      const b = Math.round(baseB + (255 - baseB) * highlightStrength)
      const cellX = cellIndex % GRID_SIZE
      const cellY = Math.floor(cellIndex / GRID_SIZE)
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${highlightAlpha})`
      ctx.fillRect(offsetX + cellX * cellSize, offsetY + cellY * cellSize, cellSize, cellSize)
    }
  }, [globalExplosionActiveRef, globalExplosionParticlesRef, highlightActiveFlagsRef, highlightActiveRef, textData])

  const updateGlobalExplosion = useCallback((delta = 1) => {
    if (!globalExplosionActiveRef.current) {
      return false
    }

    const particles = globalExplosionParticlesRef.current
    if (particles.length === 0) {
      globalExplosionActiveRef.current = false
      intensitiesRef.current.fill(0)
      return false
    }

    const dragStep = Math.pow(GLOBAL_EXPLOSION_DRAG, delta)
    const intensityDecay = Math.pow(GLOBAL_EXPLOSION_INTENSITY_DECAY, delta)
    const gravityStep = GLOBAL_EXPLOSION_GRAVITY * delta

    const nextParticles: ExplosionParticle[] = []
    const intensities = intensitiesRef.current
    intensities.fill(0)
    let hasEnergy = false

    for (let index = 0; index < particles.length; index += 1) {
      const particle = particles[index]
      particle.vx *= dragStep
      particle.vy = (particle.vy + gravityStep) * dragStep
      particle.x += particle.vx * delta
      particle.y += particle.vy * delta
      particle.intensity *= intensityDecay

      if (particle.intensity <= MIN_VISIBLE_INTENSITY) {
        continue
      }

      if (particle.x < -1 || particle.x > GRID_SIZE || particle.y < -1 || particle.y > GRID_SIZE + 6) {
        continue
      }

      hasEnergy = true

      if (particle.x >= 0 && particle.x < GRID_SIZE && particle.y >= 0 && particle.y < GRID_SIZE) {
        const cellX = Math.floor(particle.x)
        const cellY = Math.floor(particle.y)
        const cellIndex = cellY * GRID_SIZE + cellX
        const normalizedIntensity = Math.min(1, particle.intensity)
        if (intensities[cellIndex] < normalizedIntensity) {
          intensities[cellIndex] = normalizedIntensity
        }
      }

      nextParticles.push(particle)
    }

    globalExplosionParticlesRef.current = nextParticles

    if (!hasEnergy) {
      globalExplosionActiveRef.current = false
      globalExplosionParticlesRef.current = []
      intensities.fill(0)
      return false
    }

    return true
  }, [])

  const updateScatterParticles = useCallback(
    (delta = 1) => {
      const particles = scatterParticlesRef.current
      if (particles.length === 0) {
        return false
      }

      const dragStep = Math.pow(SCATTER_PARTICLE_DRAG, delta)
      const decayStep = Math.pow(SCATTER_PARTICLE_INTENSITY_DECAY, delta)
      const nextParticles: ScatterParticle[] = []
      let hasEnergy = false

      for (let index = 0; index < particles.length; index += 1) {
        const particle = particles[index]
        particle.vx *= dragStep
        particle.vy *= dragStep
        particle.x += particle.vx * delta
        particle.y += particle.vy * delta
        particle.intensity *= decayStep
        particle.ageMs += delta * SCATTER_PARTICLE_FRAME_MS

        const curlAmountValue = curlAmountRef.current
        if (curlAmountValue > 0) {
          const curl = computeCurlNoise(particle.x, particle.y, noiseTimeRef.current)
          particle.vx += curl.x * curlAmountValue * delta
          particle.vy += curl.y * curlAmountValue * delta
        }

        if (
          particle.intensity <= SCATTER_PARTICLE_MIN_INTENSITY ||
          particle.ageMs >= SCATTER_PARTICLE_MAX_AGE_MS
        ) {
          continue
        }

        const cellX = Math.floor(particle.x)
        const cellY = Math.floor(particle.y)
        if (cellX < 0 || cellX >= GRID_SIZE || cellY < 0 || cellY >= GRID_SIZE) {
          continue
        }

        const cellIndex = cellY * GRID_SIZE + cellX
        const headIntensity = clamp(particle.intensity, 0, 1)
        depositIntensity(cellIndex, headIntensity)

        if (particle.lastCellIndex !== cellIndex) {
          depositIntensity(particle.lastCellIndex, clamp(particle.intensity * 0.9, 0, 1))
          particle.lastCellIndex = cellIndex
        }

        nextParticles.push(particle)
        hasEnergy = true
      }

      scatterParticlesRef.current = nextParticles
      return hasEnergy
    },
    [depositIntensity],
  )

  const decayIntensities = useCallback(
    ({ suppressIntroGlow = false, delta = 1 }: { suppressIntroGlow?: boolean; delta?: number } = {}) => {
      const intensities = intensitiesRef.current
      const flags = textScatterFlagsRef.current
      const textCells = textData.cellIndices
      const revealRatios = textData.revealRatios
      const revealProgress = textRevealProgressRef.current
      const decayStep = Math.pow(DECAY_FACTOR, delta)
      let hasEnergy = false

      const ages = intensityAgeRef.current
      const highlightFlags = highlightActiveFlagsRef.current
      if (!suppressIntroGlow) {
        const revealTriggered = textRevealTriggeredRef.current
        const pendingTextScatter = pendingTextScatterRef.current
        for (let index = 0; index < textCells.length; index += 1) {
          if (flags[index] !== 0) {
            continue
          }
          const cellIndex = textCells[index]
          const revealRatio = revealRatios[cellIndex]
          const revealWeight = computeSweepReveal(revealProgress, revealRatio)

          if (revealWeight >= 1 && revealTriggered[index] === 0) {
            revealTriggered[index] = 1
            pendingTextScatter.push(cellIndex)
          }

          if (revealWeight > 0 && revealWeight < 1) {
            hasEnergy = true
          }
        }
      }

      for (let index = 0; index < intensities.length; index += 1) {
        const value = intensities[index]
        if (value <= MIN_VISIBLE_INTENSITY) {
          intensities[index] = 0
          ages[index] = 0
          highlightFlags[index] = 0
          continue
        }

        ages[index] += delta * SCATTER_PARTICLE_FRAME_MS
        if (ages[index] >= TRAIL_RELEASE_MAX_AGE_MS) {
          intensities[index] = 0
          ages[index] = 0
          highlightFlags[index] = 0
          continue
        }

        const next = value * decayStep
        intensities[index] = next <= MIN_VISIBLE_INTENSITY ? 0 : next
        if (intensities[index] === 0) {
          ages[index] = 0
          highlightFlags[index] = 0
          continue
        }
        hasEnergy = true
      }

      return hasEnergy
    },
    [highlightActiveFlagsRef, textData.cellIndices, textData.revealRatios],
  )

  const frame = useCallback(
    (timestamp: number) => {
      frameRunningRef.current = true
      framePendingRef.current = false

      const lastTimestamp = lastFrameTimeRef.current
      const deltaMs = lastTimestamp === null ? 16 : timestamp - lastTimestamp
      const frameDelta = Math.min(deltaMs / (1000 / 60), 2)
      lastFrameTimeRef.current = timestamp
      animationFrameRef.current = null
      noiseTimeRef.current += deltaMs

      if (textRevealProgressRef.current < 1) {
        textRevealProgressRef.current = Math.min(
          1,
          textRevealProgressRef.current + deltaMs / TEXT_REVEAL_DURATION_MS,
        )
      }

      const explosionHasEnergy = updateGlobalExplosion(frameDelta)
      const intensityHasEnergy = decayIntensities({
        suppressIntroGlow: explosionHasEnergy,
        delta: frameDelta,
      })

      const pendingScatter = pendingTextScatterRef.current
      if (pendingScatter.length > 0) {
        const batchSize = 96
        const take = Math.min(batchSize, pendingScatter.length)
        for (let index = 0; index < take; index += 1) {
          scatterCellRef.current(pendingScatter[index])
        }
        pendingScatter.splice(0, take)
      }

      const particlesHaveEnergy = updateScatterParticles(frameDelta)
      draw()

      const needsReveal = textRevealProgressRef.current < 1
      const hasEnergy = explosionHasEnergy || intensityHasEnergy || particlesHaveEnergy

      const shouldContinue =
        phaseRef.current !== 'grid' ||
        hasEnergy ||
        explosionHasEnergy ||
        globalExplosionActiveRef.current ||
        needsReveal ||
        framePendingRef.current

      frameRunningRef.current = false

      if (shouldContinue) {
        framePendingRef.current = false
        animationFrameRef.current = window.requestAnimationFrame(frame)
      } else {
        lastFrameTimeRef.current = null
      }
    },
    [decayIntensities, draw, updateGlobalExplosion, updateScatterParticles],
  )

  const scheduleFrame = useCallback(
    (force = false) => {
      if (frameRunningRef.current) {
        framePendingRef.current = true
        return
      }

      if (animationFrameRef.current !== null) {
        if (!force) {
          return
        }
        window.cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }

      framePendingRef.current = false
      animationFrameRef.current = window.requestAnimationFrame(frame)
    },
    [frame],
  )

  const spawnScatterParticle = useCallback(
    (cellIndex: number, baseIntensity = 1) => {
      if (!Number.isFinite(cellIndex) || cellIndex < 0 || cellIndex >= GRID_SIZE * GRID_SIZE) {
        return
      }

      const cellX = cellIndex % GRID_SIZE
      const cellY = Math.floor(cellIndex / GRID_SIZE)
      const intensity = clamp(baseIntensity, 0, 1)
      const angle = Math.random() * Math.PI * 2
      const speed =
        SCATTER_PARTICLE_SPEED_MIN +
        Math.random() * (SCATTER_PARTICLE_SPEED_MAX - SCATTER_PARTICLE_SPEED_MIN)
      if (scatterParticlesRef.current.length >= SCATTER_PARTICLE_MAX_COUNT) {
        return
      }

      const particle: ScatterParticle = {
        x: cellX + 0.5,
        y: cellY + 0.5,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        intensity,
        ageMs: 0,
        lastCellIndex: cellIndex,
      }

      scatterParticlesRef.current.push(particle)
      depositIntensity(cellIndex, intensity)
      scheduleFrame()
    },
    [depositIntensity, scheduleFrame],
  )

  const trySpawnParticleForHighlight = useCallback(
    (cellIndex: number, intensity: number) => {
      if (cellIndex < 0 || cellIndex >= GRID_SIZE * GRID_SIZE || intensity <= 0) {
        return
      }

      const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
      const lastSpawn = lastParticleSpawnRef.current[cellIndex]
      if (Number.isFinite(lastSpawn) && now - lastSpawn < SCATTER_PARTICLE_SPAWN_COOLDOWN_MS) {
        return
      }

      lastParticleSpawnRef.current[cellIndex] = now
      spawnScatterParticle(cellIndex, intensity)
    },
    [spawnScatterParticle],
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

  const startGlobalExplosion = useCallback(
    (event: PointerEvent<HTMLCanvasElement> | null) => {
      if (globalExplosionActiveRef.current) {
        return
      }

      const coords = event ? getCellFromEvent(event) : null
      const originX = coords?.cellX ?? Math.floor(GRID_SIZE / 2)
      const originY = coords?.cellY ?? Math.floor(GRID_SIZE / 2)
      const particles: ExplosionParticle[] = []
      const originCenterX = originX + 0.5
      const originCenterY = originY + 0.5
      const { mask, colors } = textData

      for (let y = 0; y < GRID_SIZE; y += 1) {
        for (let x = 0; x < GRID_SIZE; x += 1) {
          const cellIndex = y * GRID_SIZE + x
          const pointX = x + 0.5
          const pointY = y + 0.5
          const dx = pointX - originCenterX
          const dy = pointY - originCenterY
          const distance = Math.hypot(dx, dy) || 1
          const directionX = dx / distance
          const directionY = dy / distance
          const speed = GLOBAL_EXPLOSION_BASE_SPEED + Math.random() * GLOBAL_EXPLOSION_SPEED_JITTER
          const jitter = (Math.random() - 0.5) * 0.6
          const jitterCos = Math.cos(jitter)
          const jitterSin = Math.sin(jitter)
          const rotatedX = directionX * jitterCos - directionY * jitterSin
          const rotatedY = directionX * jitterSin + directionY * jitterCos
          const offset = cellIndex * 3
          const color: [number, number, number] = [colors[offset], colors[offset + 1], colors[offset + 2]]
          const baseIntensity = mask[cellIndex] > 0 ? clamp(mask[cellIndex] * 1.25, 0.4, 1) : 0.35

          particles.push({
            x: pointX,
            y: pointY,
            vx: rotatedX * speed,
            vy: rotatedY * speed - speed * 0.45,
            intensity: baseIntensity,
            color,
          })
        }
      }

      globalExplosionParticlesRef.current = particles
      globalExplosionActiveRef.current = true
      interactiveEnabledRef.current = false
      completeScatterRef.current()
      clearScatterTimers()
      clearExplosionTimers()
      clearRippleTimers()
      clearScatterCompletionGuard()
      intensitiesRef.current.fill(0)
      lastFrameTimeRef.current = null
      scheduleFrame(true)

      if (interactiveEnableTimerRef.current !== null) {
        window.clearTimeout(interactiveEnableTimerRef.current)
      }
      interactiveEnableTimerRef.current = window.setTimeout(() => {
        interactiveEnableTimerRef.current = null
        interactiveEnabledRef.current = true
        globalExplosionActiveRef.current = false
        globalExplosionParticlesRef.current = []
        intensitiesRef.current.fill(0)
        lastFrameTimeRef.current = null
      }, GLOBAL_EXPLOSION_INTERACTIVE_DELAY_MS)
    },
    [
      clearExplosionTimers,
      clearRippleTimers,
      clearScatterCompletionGuard,
      clearScatterTimers,
      getCellFromEvent,
      scheduleFrame,
      textData,
    ],
  )

  const igniteCell = useCallback(
    (cellX: number, cellY: number, intensity = 1) => {
      if (cellX < 0 || cellX >= GRID_SIZE || cellY < 0 || cellY >= GRID_SIZE) {
        return
      }

      const index = cellY * GRID_SIZE + cellX
      const intensities = intensitiesRef.current
      const ages = intensityAgeRef.current
      const clamped = Math.min(Math.max(intensity, 0), 1)
      const next = Math.max(intensities[index], clamped)
      intensities[index] = next
      ages[index] = 0

      if (clamped >= 0.9) {
        trySpawnParticleForHighlight(index, clamped)
      }

      scheduleFrame()
    },
    [scheduleFrame, trySpawnParticleForHighlight],
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
    (cellIndex: number, { intensity = 1, allowDuplicate = false }: { intensity?: number; allowDuplicate?: boolean } = {}) => {
      if (cellIndex < 0 || cellIndex >= GRID_SIZE * GRID_SIZE) {
        return
      }

      const textIndex = textData.cellIndexLookup[cellIndex]
      let shouldSpawn = true

      if (textIndex !== -1) {
        const flags = textScatterFlagsRef.current
        if (!allowDuplicate && flags[textIndex] === 1) {
          shouldSpawn = false
        }

        if (shouldSpawn && flags[textIndex] === 0) {
          flags[textIndex] = 1
          textRevealTriggeredRef.current[textIndex] = 1
          remainingTextCellsRef.current -= 1
          ensureScatterCompletionGuard()

          if (!scatterStartedRef.current) {
            scatterStartedRef.current = true
            onScatterStart()
          }
        }
      } else if (!allowDuplicate) {
        shouldSpawn = true
      }

      if (!shouldSpawn) {
        return
      }

      spawnScatterParticle(cellIndex, intensity)

      if (textIndex !== -1 && !scatterCompleteRef.current && remainingTextCellsRef.current <= 0) {
        clearScatterCompletionGuard()
        scatterCompleteRef.current = true
        onScatterComplete()
        completeScatterRef.current()
      }
    },
    [
      clearScatterCompletionGuard,
      ensureScatterCompletionGuard,
      onScatterComplete,
      onScatterStart,
      spawnScatterParticle,
      textData.cellIndexLookup,
    ],
  )

  useEffect(() => {
    scatterCellRef.current = scatterCell
  }, [scatterCell])

  const handlePointerActivation = useCallback(
    (event: PointerEvent<HTMLCanvasElement>) => {
      if (!interactiveEnabledRef.current || globalExplosionActiveRef.current) {
        return
      }

      const coords = getCellFromEvent(event)
      if (!coords) {
        return
      }

      igniteCell(coords.cellX, coords.cellY, 1)
      applyRipple(coords.cellX, coords.cellY)
    },
    [applyRipple, getCellFromEvent, igniteCell],
  )

  const triggerExplosion = useCallback(
    (event: PointerEvent<HTMLCanvasElement>) => {
      if (!interactiveEnabledRef.current || globalExplosionActiveRef.current) {
        return
      }

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
            scatterCell(targetY * GRID_SIZE + targetX, {
              intensity,
              allowDuplicate: true,
            })
          }, delay)

          explosionTimersRef.current.push(timer)
        }
      }
    },
    [clearExplosionTimers, getCellFromEvent, igniteCell, scatterCell],
  )

  const scatterAll = useCallback(
    ({ force = false }: { force?: boolean } = {}) => {
      const indices = textData.cellIndices
      if (indices.length === 0) {
        return
      }

      if (scatterActiveRef.current && !force) {
        return
      }

      scatterActiveRef.current = true
      pendingForcedScatterRef.current = false

      if (autoScatterTimerRef.current !== null) {
        window.clearTimeout(autoScatterTimerRef.current)
        autoScatterTimerRef.current = null
      }

      textRevealProgressRef.current = 0
      lastFrameTimeRef.current = null

      textScatterFlagsRef.current.fill(0)
      remainingTextCellsRef.current = textData.cellIndices.length
      scatterStartedRef.current = false
      scatterCompleteRef.current = false
      scatterParticlesRef.current = []
      pendingTextScatterRef.current.length = 0
      textRevealTriggeredRef.current.fill(0)
      highlightActiveRef.current.length = 0
      highlightActiveFlagsRef.current.fill(0)
      lastParticleSpawnRef.current.fill(-Infinity)
      intensitiesRef.current.fill(0)
      intensityAgeRef.current.fill(0)

      clearScatterCompletionGuard()
      clearScatterTimers()
      clearExplosionTimers()
      clearRippleTimers()

      scheduleFrame(true)
    },
    [
      clearExplosionTimers,
      clearRippleTimers,
      clearScatterCompletionGuard,
      clearScatterTimers,
      scatterCell,
      scheduleFrame,
      textData.cellIndices,
    ],
  )

  const scheduleAutoScatter = useCallback(() => {
    if (autoScatterTimerRef.current !== null) {
      return
    }
    autoScatterTimerRef.current = window.setTimeout(() => {
      autoScatterTimerRef.current = null
      if (globalExplosionActiveRef.current || scatterActiveRef.current) {
        scheduleAutoScatter()
        return
      }
      if (pendingForcedScatterRef.current) {
        scatterAll({ force: true })
        return
      }
      scatterAll()
    }, AUTO_SCATTER_INTERVAL_MS)
  }, [scatterAll])

  const completeScatter = useCallback(() => {
    if (!scatterActiveRef.current) {
      return
    }
    scatterActiveRef.current = false

    if (pendingForcedScatterRef.current) {
      if (globalExplosionActiveRef.current) {
        scheduleAutoScatter()
        return
      }
      pendingForcedScatterRef.current = false
      scatterAll({ force: true })
      return
    }

    scheduleAutoScatter()
  }, [scatterAll, scheduleAutoScatter])
  completeScatterRef.current = completeScatter

  useEffect(() => {
    scatterAll({ force: true })
    scheduleAutoScatter()

    return () => {
      if (autoScatterTimerRef.current !== null) {
        window.clearTimeout(autoScatterTimerRef.current)
        autoScatterTimerRef.current = null
      }
    }
  }, [scheduleAutoScatter, scatterAll])

  useEffect(() => {
    if (scatterSignal === lastScatterSignalRef.current) {
      return
    }

    lastScatterSignalRef.current = scatterSignal

    if (scatterActiveRef.current || globalExplosionActiveRef.current) {
      pendingForcedScatterRef.current = true
      return
    }

    scatterAll({ force: true })
  }, [scatterAll, scatterSignal])

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
      globalExplosionActiveRef.current = false
      globalExplosionParticlesRef.current = []
      scatterParticlesRef.current = []
      pendingTextScatterRef.current.length = 0
      textRevealTriggeredRef.current.fill(0)
      highlightActiveRef.current.length = 0
      highlightActiveFlagsRef.current.fill(0)
      lastParticleSpawnRef.current.fill(-Infinity)
      intensitiesRef.current.fill(0)
      intensityAgeRef.current.fill(0)
      lastFrameTimeRef.current = null
      if (interactiveEnableTimerRef.current !== null) {
        window.clearTimeout(interactiveEnableTimerRef.current)
        interactiveEnableTimerRef.current = null
      }
      if (autoScatterTimerRef.current !== null) {
        window.clearTimeout(autoScatterTimerRef.current)
        autoScatterTimerRef.current = null
      }
      scheduleFrame(true)
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
      scatterParticlesRef.current = []
      pendingTextScatterRef.current.length = 0
      textRevealTriggeredRef.current.fill(0)
      highlightActiveRef.current.length = 0
      highlightActiveFlagsRef.current.fill(0)
      lastParticleSpawnRef.current.fill(-Infinity)
      intensitiesRef.current.fill(0)
      intensityAgeRef.current.fill(0)
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
      if (!firstInteractionHandledRef.current) {
        firstInteractionHandledRef.current = true
        startGlobalExplosion(event)
        return
      }

      if (!interactiveEnabledRef.current || globalExplosionActiveRef.current) {
        return
      }

      handlePointerActivation(event)
      triggerExplosion(event)
    },
    [handlePointerActivation, startGlobalExplosion, triggerExplosion],
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
export { downsampleCanvasCoverage }
export { createTextData }
