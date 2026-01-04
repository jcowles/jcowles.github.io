import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { act } from 'react'
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

describe('App splash experience with intro overlay', () => {
  test('renders intro overlay and passes intro phase to grid', () => {
    vi.useFakeTimers()
    render(<App />)

    expect(screen.getByText(/visualcore/i)).toBeInTheDocument()
    expect(screen.getByTestId('pixel-grid')).toHaveAttribute('data-phase', 'intro')
    expect(renderSpy).toHaveBeenCalledWith(
      expect.objectContaining({ phase: 'intro', scatterSignal: 0 }),
    )
  })

  test('transitions to grid after user interaction', async () => {
    vi.useFakeTimers()
    render(<App />)

    const pixelGrid = screen.getByTestId('pixel-grid')
    const root = screen.getByTestId('app-root')

    fireEvent.pointerDown(root)

    const latestCall = renderSpy.mock.calls[renderSpy.mock.calls.length - 1]
    const latestProps = latestCall?.[0]
    expect(latestProps?.scatterSignal).toBe(1)
    expect(pixelGrid).toHaveAttribute('data-phase', 'intro')

    act(() => {
      latestProps?.onScatterStart()
    })

    expect(screen.getByTestId('pixel-grid')).toHaveAttribute('data-phase', 'transition')

    act(() => {
      latestProps?.onScatterComplete()
    })

    expect(screen.getByTestId('pixel-grid')).toHaveAttribute('data-phase', 'grid')
  })

  test('auto transitions after intro duration', async () => {
    vi.useFakeTimers()
    render(<App />)

    await act(async () => {
      vi.advanceTimersByTime(2400)
    })

    const autoCall = renderSpy.mock.calls[renderSpy.mock.calls.length - 1]
    const latestProps = autoCall?.[0]
    expect(latestProps?.scatterSignal).toBe(1)
    expect(screen.getByTestId('pixel-grid')).toHaveAttribute('data-phase', 'intro')

    act(() => {
      latestProps?.onScatterStart()
    })
    expect(screen.getByTestId('pixel-grid')).toHaveAttribute('data-phase', 'transition')

    act(() => {
      latestProps?.onScatterComplete()
    })
    expect(screen.getByTestId('pixel-grid')).toHaveAttribute('data-phase', 'grid')
  })
})
