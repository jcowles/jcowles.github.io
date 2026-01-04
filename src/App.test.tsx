import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'

const renderSpy = vi.fn()

interface MockPixelGridProps {
  phase?: string
  scatterSignal?: number
  onScatterStart?: () => void
  onScatterComplete?: () => void
}

vi.mock('./components/PixelGrid', () => {
  const MockPixelGrid = (props: MockPixelGridProps) => {
    renderSpy(props)
    return <div data-testid="mock-pixel-grid" />
  }

  return { default: MockPixelGrid }
})

import App from './App'

afterEach(() => {
  vi.useRealTimers()
  renderSpy.mockReset()
})

describe('App layout', () => {
  test('renders the pixel grid canvas shell', () => {
    render(<App />)

    const appRoot = screen.getByTestId('app-root')
    const pixelGrid = screen.getByTestId('pixel-grid')
    const mockGrid = screen.getByTestId('mock-pixel-grid')

    expect(appRoot).toBeInTheDocument()
    expect(pixelGrid).toBeInTheDocument()
    expect(mockGrid).toBeInTheDocument()

    expect(pixelGrid).not.toHaveAttribute('data-phase')
    expect(renderSpy).toHaveBeenCalledTimes(1)
    expect(renderSpy).toHaveBeenCalledWith({ orientation: 'landscape' })
  })

  test('exposes the brand text for assistive tech', () => {
    render(<App />)

    const label = screen.getByText(/visualcore/i)
    expect(label).toBeInTheDocument()
    expect(label.tagName.toLowerCase()).toBe('span')
  })
})
