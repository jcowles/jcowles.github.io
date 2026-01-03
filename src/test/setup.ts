import '@testing-library/jest-dom/vitest'

type MockCanvasContext = {
  fillRect: (...args: unknown[]) => void
  clearRect: (...args: unknown[]) => void
  fillStyle: string | CanvasGradient | CanvasPattern
}

const createMockContext = (): MockCanvasContext => ({
  fillRect: () => {},
  clearRect: () => {},
  fillStyle: '#000',
})

Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
  value: function getContext() {
    return createMockContext()
  },
})
