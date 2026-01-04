export const GRID_SIZE = 72
export const TEXT_ALPHA = 0.85
export const HIGHLIGHT_ALPHA = 0.96
export const DECAY_FACTOR = 0.965
export const MIN_VISIBLE_INTENSITY = 0.001
export const MIN_RIPPLE_INTENSITY = 0.06
export const BACKGROUND_COLOR = '#082c4a'
export const SCATTER_DURATION = 3000
export const RIPPLE_STEP_DELAY_MS = 22
export const EXPLOSION_RADIUS = 16
export const EXPLOSION_DURATION_MS = 380

const TEXT_CONTENT = 'VISUALCORE'
const TEXT_SCALE_RATIO = 0.14

export const DEFAULT_COLOR: [number, number, number] = [118, 99, 255]
export const GRADIENT_STOPS: Array<{ stop: number; color: [number, number, number] }> = [
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

export const GLOBAL_EXPLOSION_GRAVITY = 0.22
export const GLOBAL_EXPLOSION_DRAG = 0.96
export const GLOBAL_EXPLOSION_INTENSITY_DECAY = 0.92
export const TEXT_REVEAL_DURATION_MS = 3000
export const TEXT_REVEAL_SMOOTHING = 0.08
export const HIGHLIGHT_BLEND = 0.5
export const AUTO_SCATTER_INTERVAL_MS =
  Math.max(SCATTER_DURATION + EXPLOSION_DURATION_MS, TEXT_REVEAL_DURATION_MS) + 600
export const SCATTER_PARTICLE_SPEED_MIN = 0.01
export const SCATTER_PARTICLE_SPEED_MAX = 0.5
export const SCATTER_PARTICLE_DRAG = 0.9
export const SCATTER_PARTICLE_INTENSITY_DECAY = 0.98
export const SCATTER_PARTICLE_MIN_INTENSITY = 0.4
export const SCATTER_PARTICLE_MAX_AGE_MS = 500
export const SCATTER_PARTICLE_MAX_COUNT = 800
export const SCATTER_PARTICLE_FRAME_MS = 1000 / 60
export const TRAIL_RELEASE_MAX_AGE_MS = 400
export const SCATTER_PARTICLE_SPAWN_COOLDOWN_MS = 140
export const SCATTER_PARTICLE_CURL_DEFAULT = 0.75
const CURL_NOISE_SCALE = 0.0125
const CURL_NOISE_EPSILON = 0.006
export const GRIDLINE_ALPHA = 0.14
export const FLICKER_INTENSITY = 0.15
export const FLICKER_UPDATE_INTERVAL_MS = 120
export const TEXT_FADE_OUT_DURATION_MS = TEXT_REVEAL_DURATION_MS
export const TEXT_LOOP_PAUSE_MS = 2000

export const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

export const computeSweepReveal = (progress: number, ratio: number) => {
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

export const computeCurlNoise = (x: number, y: number, time: number) => {
  const eps = CURL_NOISE_EPSILON
  const sample = (sx: number, sy: number) => sampleNoise(sx, sy, time)
  const dy = sample(x, y + eps) - sample(x, y - eps)
  const dx = sample(x + eps, y) - sample(x - eps, y)
  return { x: dy * 0.5, y: -dx * 0.5 }
}

export function assertInvariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`[PixelGrid] ${message}`)
  }
}

export interface DownsampledCell {
  cellIndex: number
  coverage: number
  x: number
  y: number
  color: [number, number, number]
}

export interface ExplosionParticle {
  x: number
  y: number
  vx: number
  vy: number
  intensity: number
  color: [number, number, number]
}

export interface ScatterParticle {
  x: number
  y: number
  vx: number
  vy: number
  intensity: number
  ageMs: number
  lastCellIndex: number
}

export interface TextData {
  mask: Float32Array
  colors: Float32Array
  revealRatios: Float32Array
  cellIndices: Int32Array
  cellIndexLookup: Int32Array
  fadeRatios: Float32Array
}

export interface VisualcoreDebugState {
  mask: Float32Array
  colors: Float32Array
  cellIndices: ReadonlyArray<number>
  sourceDataURL: string
  toDataURL: () => string
  showPreview: () => void
}

type GlobalWithProcessEnv = typeof globalThis & {
  process?: {
    env?: {
      NODE_ENV?: string
    }
  }
}

type ImportMetaWithOptionalEnv = ImportMeta & {
  readonly env?: {
    readonly MODE?: string
  }
}

declare global {
  interface Window {
    __visualcoreDebug?: VisualcoreDebugState
    __VISUALCORE_AUTO_PREVIEW?: boolean
  }
}

export const downsampleCanvasCoverage = (
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
  const fadeRatios = new Float32Array(totalCells)
  revealRatios.fill(1)
  const cellIndices: number[] = []

  const minStripe = Math.floor(GRID_SIZE * 0.3)
  const maxStripe = Math.ceil(GRID_SIZE * 0.7)

  for (let y = 0; y < GRID_SIZE; y += 1) {
    for (let x = 0; x < GRID_SIZE; x += 1) {
      const cellIndex = y * GRID_SIZE + x
      const offset = cellIndex * 3
      const ratio = x / Math.max(1, GRID_SIZE - 1)

      if (y >= minStripe && y <= maxStripe) {
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

      fadeRatios[cellIndex] = ratio
    }
  }

  return {
    mask,
    colors,
    revealRatios,
    cellIndices: Int32Array.from(cellIndices),
    cellIndexLookup,
    fadeRatios,
  }
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

export const sampleGradient = (t: number): [number, number, number] => {
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

export const RIPPLE_OFFSETS: Array<[number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
]

export const createTextData = (): TextData => {
  const totalCells = GRID_SIZE * GRID_SIZE
  const cellIndexLookup = new Int32Array(totalCells)
  cellIndexLookup.fill(-1)

  const mask = new Float32Array(totalCells)
  const colors = new Float32Array(totalCells * 3)
  const revealRatios = new Float32Array(totalCells)
  revealRatios.fill(1)
  const fadeRatios = new Float32Array(totalCells)
  const cellIndices: number[] = []


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
    fadeRatios[cellIndex] = ratio

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
    fadeRatios[cellIndex] = ratio
  }

  assertInvariant(cellIndices.length > 0, 'text sampling produced empty mask')

  const maskSamples = cellIndices.map((index) => mask[index])
  const maxValue = Math.max(...maskSamples)
  const minValue = Math.min(...maskSamples)

  assertInvariant(Number.isFinite(maxValue) && maxValue > 0, 'mask is missing positive coverage values')
  assertInvariant(maxValue <= 1.01, 'mask coverage exceeds normalized range')
  assertInvariant(minValue >= 0, 'mask coverage contains negative values')

  if (typeof window !== 'undefined') {
    const debug: VisualcoreDebugState = {
      mask,
      colors,
      cellIndices,
      sourceDataURL,
      toDataURL: () => createMaskPreview(mask, colors),
      showPreview: () => {
        const maskDataURL = debug.toDataURL()
        const fallbackSourceDataURL = debug.sourceDataURL
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
        if (fallbackSourceDataURL && sourceImg && sourceLabel) {
          sourceImg.src = fallbackSourceDataURL
          sourceImg.style.display = 'block'
          sourceLabel.style.display = 'block'
        } else if (sourceImg && sourceLabel) {
          sourceImg.style.display = 'none'
          sourceLabel.style.display = 'none'
        }
      },
    }
    window.__visualcoreDebug = debug

    const nodeEnv = (() => {
      if (typeof globalThis !== 'object' || globalThis === null || !('process' in globalThis)) {
        return undefined
      }
      const withProcess = globalThis as GlobalWithProcessEnv
      const value = withProcess.process?.env?.NODE_ENV
      return typeof value === 'string' ? value : undefined
    })()

    const importMetaMode = (() => {
      if (typeof import.meta === 'undefined') {
        return undefined
      }
      const meta = import.meta as ImportMetaWithOptionalEnv
      return meta.env?.MODE
    })()

    const isTestEnv = nodeEnv === 'test'
    const isProdEnv = importMetaMode === 'production'
    const autoPreviewSetting = window.__VISUALCORE_AUTO_PREVIEW
    const shouldAutoPreview = !isTestEnv && !isProdEnv && autoPreviewSetting === true

    if (!shouldAutoPreview && typeof document !== 'undefined') {
      const existing = document.getElementById('__visualcore-debug-preview')
      existing?.remove()
    }

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
    fadeRatios,
  }
}
