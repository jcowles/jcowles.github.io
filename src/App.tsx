import PixelGrid from './components/PixelGrid'

const TEXT = 'visualcore'

const App = () => {
  return (
    <div
      data-testid="app-root"
      className="relative flex h-screen w-screen select-none items-center justify-center overflow-hidden bg-[#082c4a] text-white"
    >
      <div data-testid="pixel-grid" className="absolute inset-0">
        <PixelGrid />
      </div>

      <span className="sr-only">{TEXT}</span>
    </div>
  )
}

export default App
