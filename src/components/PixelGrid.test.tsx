import { describe, expect, test, vi } from 'vitest'
import { createTextData } from './PixelGrid'

const GRID_SIZE = 64

const buildCanvasStub = () => {
  const canvas = {
    width: 0,
    height: 0,
    style: {} as CSSStyleDeclaration,
    getContext: (contextId: string) => {
      if (contextId !== '2d') {
        return null
      }

      let buffer = new Uint8ClampedArray(canvas.width * canvas.height * 4)

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
