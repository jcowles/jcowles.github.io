import { describe, expect, test, vi } from 'vitest'
import { createTextData, downsampleCanvasCoverage } from './pixelGridCore'

const GRID_SIZE = 64

const SCALE = 18

const buildCanvasStub = () => {
  const canvas = {
    width: 0,
    height: 0,
    style: {} as CSSStyleDeclaration,
    getContext: (contextId: string) => {
      if (contextId !== '2d') {
        return null
      }

      const buffer = new Uint8ClampedArray(canvas.width * canvas.height * 4)

      const fillRegion = (startX: number, endX: number, topY: number, bottomY: number) => {
        for (let y = topY; y < bottomY && y < canvas.height; y += 1) {
          for (let x = startX; x < endX && x < canvas.width; x += 1) {
            const index = (y * canvas.width + x) * 4 + 3
            buffer[index] = 255
          }
        }
      }

      const ctx = {
        fillStyle: '#000',
        textAlign: 'center',
        textBaseline: 'middle',
        font: '',
        clearRect: () => {
          buffer.fill(0)
        },
        fillRect: () => {},
        fillText: (text: string) => {
          if (!text.length) {
            return
          }

          buffer.fill(0)

          const charWidth = Math.floor(canvas.width / text.length)
          const charHeight = Math.floor(canvas.height * 0.6)
          const offsetY = Math.max(0, Math.floor((canvas.height - charHeight) / 2))
          const strokeWidth = Math.max(2, Math.floor(charWidth * 0.6))

          for (let index = 0; index < text.length; index += 1) {
            const startX = Math.max(0, index * charWidth + Math.floor(charWidth * 0.2))
            const endX = Math.min(canvas.width, startX + strokeWidth)
            fillRegion(startX, endX, offsetY, offsetY + charHeight)
          }
        },
        getImageData: () => ({ data: buffer }),
      } as unknown as CanvasRenderingContext2D

      return ctx
    },
  }

  return canvas as unknown as HTMLCanvasElement
}

interface CoverageCell {
  cellX: number
  cellY: number
  value?: number
}

const buildCoverageCanvasStub = (coverage: CoverageCell[]) => {
  const coverageMap = coverage.map((cell) => ({
    ...cell,
    value: typeof cell.value === 'number' ? cell.value : 1,
  }))

  const canvas = {
    width: GRID_SIZE * SCALE,
    height: GRID_SIZE * SCALE,
    style: {} as CSSStyleDeclaration,
    getContext: (contextId: string) => {
      if (contextId !== '2d') {
        return null
      }

      const width = canvas.width
      const height = canvas.height
      const buffer = new Uint8ClampedArray(width * height * 4)

      const ctx = {
        fillStyle: '#000',
        textAlign: 'center',
        textBaseline: 'middle',
        font: '',
        clearRect: () => {
          buffer.fill(0)
        },
        fillRect: () => {},
        fillText: () => {},
        getImageData: () => {
          buffer.fill(0)
          coverageMap.forEach(({ cellX, cellY, value }) => {
            for (let sy = cellY * SCALE; sy < (cellY + 1) * SCALE; sy += 1) {
              for (let sx = cellX * SCALE; sx < (cellX + 1) * SCALE; sx += 1) {
                if (sx < 0 || sx >= width || sy < 0 || sy >= height) {
                  continue
                }
                const index = (sy * width + sx) * 4 + 3
                buffer[index] = Math.round(255 * value)
              }
            }
          })
          return { data: buffer }
        },
      } as unknown as CanvasRenderingContext2D

      return ctx
    },
  }

  return canvas as unknown as HTMLCanvasElement
}

describe('downsampleCanvasCoverage', () => {
  test('aggregates alpha coverage into grid cells', () => {
    const gridSize = 4
    const scale = 2
    const width = gridSize * scale
    const height = gridSize * scale
    const imageData = new Uint8ClampedArray(width * height * 4)

    const fillCell = (cellX: number, cellY: number, alpha: number) => {
      for (let sy = 0; sy < scale; sy += 1) {
        const pixelY = cellY * scale + sy
        for (let sx = 0; sx < scale; sx += 1) {
          const pixelX = cellX * scale + sx
          const index = (pixelY * width + pixelX) * 4
          imageData[index + 3] = alpha
        }
      }
    }

    fillCell(0, 0, 255)
    fillCell(1, 0, 128)
    fillCell(2, 0, 64)

    const { cells, maxCoverage } = downsampleCanvasCoverage(imageData, width, height, gridSize, scale, 0.05, 0.01)

    expect(cells.length).toBe(3)
    expect(maxCoverage).toBeGreaterThan(0.9)

    expect(cells[0].coverage).toBeCloseTo(1, 3)
    expect(cells[1].coverage).toBeCloseTo(0.5, 2)
    expect(cells[2].coverage).toBeCloseTo(0.25, 2)

    expect(cells[0].cellIndex).toBe(0)
    expect(cells[1].cellIndex).toBe(1)
    expect(cells[2].cellIndex).toBe(2)
  })
})

describe('createTextData splash mask', () => {
  const withCanvasStub = (factory: () => HTMLCanvasElement, run: () => void) => {
    const originalCreateElement = document.createElement
    const spy = vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      if (tagName.toLowerCase() === 'canvas') {
        return factory()
      }
      return originalCreateElement.call(document, tagName)
    })

    try {
      run()
    } finally {
      spy.mockRestore()
    }
  }

  test('produces tight gradient-aligned coverage with dark background', () => {
    withCanvasStub(buildCanvasStub, () => {
      const { cellIndices, mask, colors } = createTextData()

      expect(cellIndices.length).toBeGreaterThan(0)

      const indicesArray = Array.from(cellIndices)
      expect(indicesArray.length).toBeLessThan(GRID_SIZE * GRID_SIZE * 0.45)
      expect(indicesArray.length).toBeGreaterThan(GRID_SIZE * GRID_SIZE * 0.03)

      const hasDarkCells = mask.some((value, index) => value === 0 && !indicesArray.includes(index))
      expect(hasDarkCells).toBe(true)

      const minColumn = Math.min(...indicesArray.map((index) => index % GRID_SIZE))
      const maxColumn = Math.max(...indicesArray.map((index) => index % GRID_SIZE))
      expect(maxColumn - minColumn).toBeGreaterThan(GRID_SIZE * 0.4)

      const colorKeys = new Set(
        indicesArray.map((index) => {
          const offset = index * 3
          return `${colors[offset]}-${colors[offset + 1]}-${colors[offset + 2]}`
        }),
      )
      expect(colorKeys.size).toBeGreaterThan(6)

      const averageMask =
        indicesArray.reduce((total, index) => total + mask[index], 0) / indicesArray.length
      expect(averageMask).toBeGreaterThan(0.25)
    })
  })

  test('is deterministic across repeated generations', () => {
    type TextDataResult = ReturnType<typeof createTextData>
    let first: TextDataResult | undefined
    let second: TextDataResult | undefined

    withCanvasStub(buildCanvasStub, () => {
      first = createTextData()
    })

    withCanvasStub(buildCanvasStub, () => {
      second = createTextData()
    })

    expect(first).toBeDefined()
    expect(second).toBeDefined()

    const firstIndices = Array.from(first!.cellIndices)
    const secondIndices = Array.from(second!.cellIndices)
    expect(secondIndices).toEqual(firstIndices)

    const firstMask = Array.from(first!.mask)
    const secondMask = Array.from(second!.mask)
    expect(secondMask).toEqual(firstMask)

    const firstColors = Array.from(first!.colors)
    const secondColors = Array.from(second!.colors)
    expect(secondColors).toEqual(firstColors)
  })

  test('maps offscreen canvas coverage into mask and colors', () => {
    const coverage = [
      { cellX: 10, cellY: 6, value: 1 },
      { cellX: 30, cellY: 6, value: 0.5 },
    ]

    withCanvasStub(() => buildCoverageCanvasStub(coverage), () => {
      const data = createTextData()
      const positive = Array.from(data.mask)
        .map((value, index) => ({ value, index }))
        .filter((entry) => entry.value > 0)
        .sort((a, b) => b.value - a.value)

      expect(positive.length).toBeGreaterThanOrEqual(2)

      const strongest = positive[0]
      const nextStrongest = positive[1]
      const strongestColor = data.colors.slice(strongest.index * 3, strongest.index * 3 + 3)
      const nextColor = data.colors.slice(nextStrongest.index * 3, nextStrongest.index * 3 + 3)

      expect(strongest.value).toBeGreaterThan(0.8)
      expect(nextStrongest.value).toBeGreaterThan(0.3)
      expect(nextStrongest.value).toBeLessThan(strongest.value)

      const strongestX = strongest.index % GRID_SIZE
      const nextX = nextStrongest.index % GRID_SIZE
      expect(strongestX).toBeLessThan(nextX)

      expect(strongestColor).not.toEqual(nextColor)
      expect(strongestColor[2]).toBeGreaterThan(strongestColor[0])
      expect(nextColor[1]).toBeGreaterThan(strongestColor[1])
    })
  })

  test('positions rendered glyph within padded vertical band', () => {
    withCanvasStub(buildCanvasStub, () => {
      const { cellIndices, mask } = createTextData()
      const indices = Array.from(cellIndices)
      const ys = indices.map((index) => Math.floor(index / GRID_SIZE))
      const minY = Math.min(...ys)
      const maxY = Math.max(...ys)

      expect(minY).toBeGreaterThanOrEqual(1)
      expect(maxY).toBeLessThan(GRID_SIZE)
      expect(maxY - minY).toBeLessThanOrEqual(Math.ceil(GRID_SIZE * 0.7))

      const topRowCoverage = new Set(
        indices
          .filter((index) => Math.floor(index / GRID_SIZE) === minY)
          .map((index) => mask[index]),
      )
      expect(topRowCoverage.size).toBeGreaterThan(0)
    })
  })

  test('applies left-to-right gradient ordering', () => {
    withCanvasStub(buildCanvasStub, () => {
      const { cellIndices, colors } = createTextData()
      const sorted = Array.from(cellIndices).sort((a, b) => (a % GRID_SIZE) - (b % GRID_SIZE))
      const sampleLeft = colors.slice(sorted[0] * 3, sorted[0] * 3 + 3)
      const sampleMid = colors.slice(sorted[Math.floor(sorted.length / 2)] * 3, sorted[Math.floor(sorted.length / 2)] * 3 + 3)
      const sampleRight = colors.slice(sorted[sorted.length - 1] * 3, sorted[sorted.length - 1] * 3 + 3)

      expect(sampleLeft[2]).toBeGreaterThan(sampleLeft[0])
      expect(sampleMid[0]).toBeGreaterThan(sampleLeft[0])
      expect(sampleRight[1]).toBeGreaterThan(sampleMid[1])
    })
  })

  test('normalizes coverage into bounded range', () => {
    withCanvasStub(buildCanvasStub, () => {
      const { mask } = createTextData()
      const positiveValues = Array.from(mask).filter((value) => value > 0)
      const maxValue = Math.max(...positiveValues)
      const minValue = Math.min(...positiveValues)
      const averageValue = positiveValues.reduce((total, value) => total + value, 0) / positiveValues.length

      expect(maxValue).toBeLessThanOrEqual(1)
      expect(maxValue).toBeGreaterThan(0.9)
      expect(minValue).toBeGreaterThan(0.2)
      expect(averageValue).toBeGreaterThan(0.4)
      expect(averageValue).toBeLessThanOrEqual(1)
    })
  })

  test('preserves relative coverage ordering across sampled cells', () => {
    const coverage = [
      { cellX: 12, cellY: 10, value: 1 },
      { cellX: 20, cellY: 10, value: 0.4 },
      { cellX: 28, cellY: 10, value: 0.15 },
    ]

    withCanvasStub(() => buildCoverageCanvasStub(coverage), () => {
      const { mask } = createTextData()
      const positive = Array.from(mask)
        .map((value, index) => ({ value, index }))
        .filter((entry) => entry.value > 0)
        .sort((a, b) => b.value - a.value)

      expect(positive.length).toBeGreaterThanOrEqual(2)

      const first = positive[0]
      const second = positive[1]
      const third = positive[2] ?? positive[positive.length - 1]

      expect(first.value).toBeGreaterThan(second.value)
      if (positive.length >= 3) {
        expect(second.value).toBeGreaterThan(third.value)
      }
      expect(first.value).toBeGreaterThan(0.8)
      expect(third.value).toBeLessThan(0.6)
    })
  })

  test('falls back when 2d context is unavailable', () => {
    const fallbackCanvas = () => {
      const canvas = {
        width: GRID_SIZE,
        height: GRID_SIZE,
        style: {} as CSSStyleDeclaration,
        getContext: () => null,
      }
      return canvas as unknown as HTMLCanvasElement
    }

    withCanvasStub(fallbackCanvas, () => {
      const { cellIndices, mask } = createTextData()

      expect(cellIndices.length).toBeGreaterThan(0)
      const indicesArray = Array.from(cellIndices)
      const minCoverage = Math.min(...indicesArray.map((index) => mask[index]))
      expect(minCoverage).toBeGreaterThanOrEqual(0.9)
    })
  })
})
