import { useEffect, useRef } from 'react'

const GLYPHS = ['0', '1', '@']
const FONT_SIZE = 13
const ROW_HEIGHT = 18
const COLUMN_WIDTH = 16
const FADE_DURATION = 0.55

interface MatrixRainProps {
  className?: string
}

interface MatrixColumn {
  x: number
  headRow: number
  drawnRow: number
  rowsPerSecond: number
  glyph: string
  alpha: number
}

function randomGlyph() {
  return GLYPHS[Math.floor(Math.random() * GLYPHS.length)]
}

function resolveColor(value: string): [number, number, number] {
  const scratch = document.createElement('canvas')
  scratch.width = 1
  scratch.height = 1

  const context = scratch.getContext('2d', { willReadFrequently: true })

  if (!context) {
    return [5, 150, 105]
  }

  context.fillStyle = value
  context.fillRect(0, 0, 1, 1)

  const [red, green, blue] = context.getImageData(0, 0, 1, 1).data

  return [red, green, blue]
}

function startMatrixRain(
  canvas: HTMLCanvasElement,
  context: CanvasRenderingContext2D,
): () => void {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
  const font = `${FONT_SIZE}px ui-monospace, SFMono-Regular, Menlo, monospace`

  let width = 0
  let height = 0
  let columns: Array<MatrixColumn> = []
  let glyphColor: [number, number, number] = [5, 150, 105]
  let frame = 0
  let lastTimestamp: number | null = null

  function createColumn(index: number): MatrixColumn {
    const headRow = Math.random() * (height / ROW_HEIGHT)

    return {
      x: index * COLUMN_WIDTH + COLUMN_WIDTH / 2,
      headRow,
      drawnRow: Math.floor(headRow),
      rowsPerSecond: 7 + Math.random() * 9,
      glyph: randomGlyph(),
      alpha: 0.32 + Math.random() * 0.3,
    }
  }

  function paintStill() {
    context.clearRect(0, 0, width, height)
    context.globalCompositeOperation = 'source-over'

    const [red, green, blue] = glyphColor
    const rows = Math.ceil(height / ROW_HEIGHT)

    for (const column of columns) {
      for (let row = 0; row < rows; row += 1) {
        if (Math.random() > 0.22) {
          continue
        }

        const alpha = 0.18 + Math.random() * 0.18

        context.fillStyle = `rgba(${red}, ${green}, ${blue}, ${alpha})`
        context.fillText(randomGlyph(), column.x, row * ROW_HEIGHT)
      }
    }
  }

  function resize() {
    const rect = canvas.getBoundingClientRect()

    width = rect.width
    height = rect.height

    if (width < 1 || height < 1) {
      return
    }

    const ratio = Math.min(window.devicePixelRatio || 1, 2)

    canvas.width = Math.max(1, Math.round(width * ratio))
    canvas.height = Math.max(1, Math.round(height * ratio))
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    context.font = font
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    glyphColor = resolveColor(getComputedStyle(canvas).color)
    columns = Array.from(
      { length: Math.max(1, Math.floor(width / COLUMN_WIDTH)) },
      (_, index) => createColumn(index),
    )

    paintStill()
  }

  function step(timestamp: number) {
    const elapsed =
      lastTimestamp === null ? 0 : (timestamp - lastTimestamp) / 1000

    lastTimestamp = timestamp

    const delta = Math.min(elapsed, 0.1)
    const [red, green, blue] = glyphColor
    const maxRow = Math.ceil(height / ROW_HEIGHT) + 2

    context.globalCompositeOperation = 'destination-out'
    context.fillStyle = `rgba(0, 0, 0, ${1 - Math.exp(-delta / FADE_DURATION)})`
    context.fillRect(0, 0, width, height)
    context.globalCompositeOperation = 'source-over'

    for (const column of columns) {
      column.headRow += column.rowsPerSecond * delta

      const targetRow = Math.floor(column.headRow)

      while (column.drawnRow < targetRow) {
        column.drawnRow += 1

        const alpha = Math.min(0.8, column.alpha * (0.7 + Math.random() * 0.6))

        context.fillStyle = `rgba(${red}, ${green}, ${blue}, ${alpha})`
        context.fillText(column.glyph, column.x, column.drawnRow * ROW_HEIGHT)
        column.glyph = randomGlyph()
      }

      if (column.drawnRow > maxRow) {
        column.headRow = -Math.random() * 12 - 2
        column.drawnRow = Math.floor(column.headRow)
        column.rowsPerSecond = 7 + Math.random() * 9
        column.alpha = 0.32 + Math.random() * 0.3
        column.glyph = randomGlyph()
      }
    }

    frame = window.requestAnimationFrame(step)
  }

  function start() {
    if (reduceMotion.matches || frame !== 0 || document.hidden) {
      return
    }

    lastTimestamp = null
    frame = window.requestAnimationFrame(step)
  }

  function stop() {
    if (frame !== 0) {
      window.cancelAnimationFrame(frame)
      frame = 0
    }
  }

  function handleMotionChange() {
    stop()

    if (reduceMotion.matches) {
      paintStill()
    } else {
      start()
    }
  }

  function handleVisibilityChange() {
    if (document.hidden) {
      stop()
    } else {
      start()
    }
  }

  const observer = new ResizeObserver(resize)

  observer.observe(canvas)
  reduceMotion.addEventListener('change', handleMotionChange)
  document.addEventListener('visibilitychange', handleVisibilityChange)

  resize()
  start()

  return () => {
    stop()
    observer.disconnect()
    reduceMotion.removeEventListener('change', handleMotionChange)
    document.removeEventListener('visibilitychange', handleVisibilityChange)
  }
}

export function MatrixRain({ className }: MatrixRainProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current

    if (!canvas) {
      return
    }

    const context = canvas.getContext('2d')

    if (!context) {
      return
    }

    return startMatrixRain(canvas, context)
  }, [])

  return <canvas ref={canvasRef} aria-hidden="true" className={className} />
}
