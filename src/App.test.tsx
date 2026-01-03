import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { act } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import App from './App'

afterEach(() => {
  vi.useRealTimers()
})

describe('App splash experience', () => {
  test('renders splash text on load', () => {
    render(<App />)

    expect(screen.getByText(/visual core/i)).toBeInTheDocument()
    expect(screen.getByTestId('pixel-grid')).toHaveClass('pointer-events-none', { exact: false })
  })

  test('activates pixel grid after skipping intro', async () => {
    vi.useFakeTimers()
    render(<App />)

    const root = screen.getByTestId('app-root')
    const grid = screen.getByTestId('pixel-grid')
    const text = screen.getByTestId('intro-text')

    expect(grid).toHaveClass('pointer-events-none', { exact: false })

    fireEvent.pointerDown(root)
    expect(grid).toHaveClass('pointer-events-auto', { exact: false })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })

    expect(text).toHaveClass('opacity-0', { exact: false })
  })
})
