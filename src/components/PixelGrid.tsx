import { useCallback, useEffect, useMemo, useRef, type PointerEvent } from 'react'
import {
  AUTO_SCATTER_INTERVAL_MS,
  BACKGROUND_COLOR,
  DECAY_FACTOR,
  EXPLOSION_DURATION_MS,
  EXPLOSION_RADIUS,
  GLOBAL_EXPLOSION_DRAG,
  GLOBAL_EXPLOSION_GRAVITY,
  GLOBAL_EXPLOSION_INTENSITY_DECAY,
  GRIDLINE_ALPHA,
  GRID_SIZE,
  HIGHLIGHT_ALPHA,
  HIGHLIGHT_BLEND,
  MIN_RIPPLE_INTENSITY,
  MIN_VISIBLE_INTENSITY,
  RIPPLE_OFFSETS,
  RIPPLE_STEP_DELAY_MS,
  SCATTER_DURATION,
  SCATTER_PARTICLE_CURL_DEFAULT,
  SCATTER_PARTICLE_DRAG,
  SCATTER_PARTICLE_FRAME_MS,
  TRAIL_RELEASE_MAX_AGE_MS,
  SCATTER_PARTICLE_INTENSITY_DECAY,
  SCATTER_PARTICLE_MAX_AGE_MS,
  SCATTER_PARTICLE_MAX_COUNT,
  SCATTER_PARTICLE_MIN_INTENSITY,
  SCATTER_PARTICLE_SPAWN_COOLDOWN_MS,
  SCATTER_PARTICLE_SPEED_MAX,
  SCATTER_PARTICLE_SPEED_MIN,
  TEXT_ALPHA,
  TEXT_REVEAL_DURATION_MS,
  clamp,
  computeCurlNoise,
  computeSweepReveal,
  createTextData,
} from './pixelGridCore'
import type { ExplosionParticle, ScatterParticle } from './pixelGridCore'

interface PixelGridProps {
  scatterSignal?: number
  curlAmount?: number
}

const PixelGrid = ({ scatterSignal = 0, curlAmount }: PixelGridProps) => {
  const textData = useMemo(() => createTextData(), [])

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
  const lastScatterSignalRef = useRef<number>(scatterSignal)
  const globalExplosionParticlesRef = useRef<ExplosionParticle[]>([])
  const globalExplosionActiveRef = useRef<boolean>(false)
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
    const clampedValue = Math.min(1, value)
    if (intensities[cellIndex] < clampedValue) {
      intensities[cellIndex] = clampedValue
    }
    ages[cellIndex] = 0

    if (
      clampedValue > MIN_VISIBLE_INTENSITY &&
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
        completeScatterRef.current()
      }
    }, SCATTER_DURATION + EXPLOSION_DURATION_MS + 400)
  }, [])

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
    const revealProgress = textRevealProgressRef.current
    const phaseVisibility = 0.45

    ctx.fillStyle = BACKGROUND_COLOR
    ctx.fillRect(0, 0, width, height)

    const drawExplosion =
      globalExplosionActiveRef.current && globalExplosionParticlesRef.current.length > 0

    if (drawExplosion) {
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
    } else {
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
    }

    if (GRIDLINE_ALPHA > 0) {
      const gridWidth = cellSize * GRID_SIZE
      const gridHeight = cellSize * GRID_SIZE
      const strokeColor = `rgba(0, 0, 0, ${GRIDLINE_ALPHA})`
      ctx.save()
      ctx.strokeStyle = strokeColor
      ctx.lineWidth = Math.max(1, (dprRef.current || 1) * 0.35)
      ctx.beginPath()
      for (let x = 0; x <= GRID_SIZE; x += 1) {
        const posX = offsetX + x * cellSize
        ctx.moveTo(posX, offsetY)
        ctx.lineTo(posX, offsetY + gridHeight)
      }
      for (let y = 0; y <= GRID_SIZE; y += 1) {
        const posY = offsetY + y * cellSize
        ctx.moveTo(offsetX, posY)
        ctx.lineTo(offsetX + gridWidth, posY)
      }
      ctx.stroke()
      ctx.restore()
    }
  }, [
    globalExplosionActiveRef,
    globalExplosionParticlesRef,
    highlightActiveFlagsRef,
    highlightActiveRef,
    textData,
  ])

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
    function frameCallback(timestamp: number) {
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
        hasEnergy ||
        explosionHasEnergy ||
        globalExplosionActiveRef.current ||
        needsReveal ||
        framePendingRef.current

      frameRunningRef.current = false

      if (shouldContinue) {
        framePendingRef.current = false
        animationFrameRef.current = window.requestAnimationFrame(frameCallback)
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

  const igniteCell = useCallback(
    (cellX: number, cellY: number, intensity = 1) => {
      if (cellX < 0 || cellX >= GRID_SIZE || cellY < 0 || cellY >= GRID_SIZE) {
        return
      }

      const index = cellY * GRID_SIZE + cellX
      const intensities = intensitiesRef.current
      const ages = intensityAgeRef.current
      const clampedValue = Math.min(Math.max(intensity, 0), 1)
      const next = Math.max(intensities[index], clampedValue)
      intensities[index] = next
      ages[index] = 0

      if (clampedValue >= 0.9) {
        trySpawnParticleForHighlight(index, clampedValue)
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
        completeScatterRef.current()
      }
    },
    [
      clearScatterCompletionGuard,
      ensureScatterCompletionGuard,
      spawnScatterParticle,
      textData.cellIndexLookup,
    ],
  )

  useEffect(() => {
    scatterCellRef.current = scatterCell
  }, [scatterCell])

  const handlePointerActivation = useCallback(
    (event: PointerEvent<HTMLCanvasElement>) => {
      if (globalExplosionActiveRef.current) {
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
      if (globalExplosionActiveRef.current) {
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

  const scheduleAutoScatter = useCallback(function scheduleAutoScatterCallback() {
    if (autoScatterTimerRef.current !== null) {
      return
    }
    autoScatterTimerRef.current = window.setTimeout(() => {
      autoScatterTimerRef.current = null
      if (globalExplosionActiveRef.current || scatterActiveRef.current) {
        scheduleAutoScatterCallback()
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

  const handlePointerDown = useCallback(
    (event: PointerEvent<HTMLCanvasElement>) => {
      if (globalExplosionActiveRef.current) {
        return
      }

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
