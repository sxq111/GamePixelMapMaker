import { useState, useRef, useEffect, useCallback } from 'react'
import './App.css'

interface Point {
  x: number
  y: number
}

// Mesh data for a single line
interface LineMesh {
  vertices: number[]   // [x, y, x, y, ...] in pixels
  uvs: number[]        // [u, v, u, v, ...]
  indices: number[]    // triangle indices
  closed: boolean      // whether this line is a closed loop
}

interface SimplifiedLine {
  points: Point[]
  closed: boolean
  polygons: Point[][]
}

interface MapData {
  wallPoints: Point[]
  startPoint: Point | null
  endPoint: Point | null
  lines: Point[][]
  lineCount: number
  closedLineCount: number  // number of closed loops
  simplifiedLines: SimplifiedLine[]
  originalPointCount: number
  simplifiedPointCount: number
  meshes: LineMesh[]   // mesh data for each line
  items: ItemPoint[]
}

interface ItemPoint {
  x: number
  y: number
  color: string
}

// Deep copy a point
const copyPoint = (p: Point): Point => ({ x: p.x, y: p.y })

// RDP (Ramer-Douglas-Peucker) algorithm for line simplification
const rdpSimplify = (points: Point[], epsilon: number): Point[] => {
  if (points.length === 0) return []
  if (points.length === 1) return [copyPoint(points[0])]
  if (points.length === 2) return [copyPoint(points[0]), copyPoint(points[1])]

  // Find the point with maximum distance from the line between first and last
  let maxDist = 0
  let maxIndex = 0

  const start = points[0]
  const end = points[points.length - 1]

  for (let i = 1; i < points.length - 1; i++) {
    const dist = perpendicularDistance(points[i], start, end)
    if (dist > maxDist) {
      maxDist = dist
      maxIndex = i
    }
  }

  // If max distance is greater than epsilon, recursively simplify
  if (maxDist > epsilon) {
    const left = rdpSimplify(points.slice(0, maxIndex + 1), epsilon)
    const right = rdpSimplify(points.slice(maxIndex), epsilon)
    // Combine results (remove duplicate point at junction)
    return [...left.slice(0, -1), ...right]
  } else {
    // All points are close enough, just keep endpoints (deep copy)
    return [copyPoint(start), copyPoint(end)]
  }
}

// Calculate perpendicular distance from point to line
const perpendicularDistance = (point: Point, lineStart: Point, lineEnd: Point): number => {
  const dx = lineEnd.x - lineStart.x
  const dy = lineEnd.y - lineStart.y

  // If line is a point, return distance to that point
  if (dx === 0 && dy === 0) {
    return Math.sqrt(
      Math.pow(point.x - lineStart.x, 2) + Math.pow(point.y - lineStart.y, 2)
    )
  }

  // Calculate perpendicular distance using cross product
  const numerator = Math.abs(
    dy * point.x - dx * point.y + lineEnd.x * lineStart.y - lineEnd.y * lineStart.x
  )
  const denominator = Math.sqrt(dx * dx + dy * dy)

  return numerator / denominator
}

// Generate collision polygons from points and thickness
const generatePolygons = (points: Point[], thickness: number, closed: boolean): Point[][] => {
  if (points.length < 2) return []

  const halfThickness = thickness / 2
  const leftSide: Point[] = []
  const rightSide: Point[] = []
  const n = points.length

  for (let i = 0; i < n; i++) {
    const curr = points[i]
    let perpX: number, perpY: number

    const hasPrev = closed || i > 0
    const hasNext = closed || i < n - 1
    const prevIdx = closed ? (i - 1 + n) % n : i - 1
    const nextIdx = closed ? (i + 1) % n : i + 1

    if (hasPrev && hasNext) {
      const prev = points[prevIdx]
      const next = points[nextIdx]
      const dx1 = curr.x - prev.x
      const dy1 = curr.y - prev.y
      const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1) || 1
      const dx2 = next.x - curr.x
      const dy2 = next.y - curr.y
      const len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2) || 1
      const n1x = -dy1 / len1
      const n1y = dx1 / len1
      const n2x = -dy2 / len2
      const n2y = dx2 / len2
      perpX = (n1x + n2x) / 2
      perpY = (n1y + n2y) / 2
      const perpLen = Math.sqrt(perpX * perpX + perpY * perpY) || 1
      perpX /= perpLen
      perpY /= perpLen
      const dot = n1x * perpX + n1y * perpY
      if (Math.abs(dot) > 0.1) {
        perpX /= dot
        perpY /= dot
      }
    } else if (hasNext) {
      const next = points[nextIdx]
      const dx = next.x - curr.x
      const dy = next.y - curr.y
      const len = Math.sqrt(dx * dx + dy * dy)
      if (len > 0) {
        perpX = -dy / len
        perpY = dx / len
      } else {
        perpX = 0; perpY = 0
      }
    } else {
      const prev = points[prevIdx]
      const dx = curr.x - prev.x
      const dy = curr.y - prev.y
      const len = Math.sqrt(dx * dx + dy * dy)
      if (len > 0) {
        perpX = -dy / len
        perpY = dx / len
      } else {
        perpX = 0; perpY = 0
      }
    }

    if (!isNaN(perpX) && !isNaN(perpY)) {
      leftSide.push({ x: curr.x + perpX * halfThickness, y: curr.y + perpY * halfThickness })
      rightSide.push({ x: curr.x - perpX * halfThickness, y: curr.y - perpY * halfThickness })
    } else {
      leftSide.push({ ...curr })
      rightSide.push({ ...curr })
    }
  }

  if (closed) {
    // Strategy: Split the ring into two solid parts to support hollow centers in physics engines.
    // Part A: The main "C-shaped" ribbon from point 0 to n-1
    const mainBody = [...leftSide, ...([...rightSide].reverse())]
    
    // Part B: The "Bridge" filler that closes the gap between the last point and the first point
    // Use deep copy to avoid double-normalization bug (where points are subtracted twice)
    const n = leftSide.length
    const filler = [
      { ...leftSide[n - 1] },
      { ...leftSide[0] },
      { ...rightSide[0] },
      { ...rightSide[n - 1] }
    ]
    
    return [mainBody, filler]
  } else {
    // For open lines, combine sides into one single wrapping polygon
    return [[...leftSide, ...([...rightSide].reverse())]]
  }
}

// Simplify all lines using RDP algorithm
const simplifyLines = (lines: Point[][], epsilon: number): SimplifiedLine[] => {
  return lines.map(line => {
    const simplifiedPoints = rdpSimplify(line, epsilon)
    const closed = isLineClosed(line)
    return {
      points: simplifiedPoints,
      closed,
      polygons: generatePolygons(simplifiedPoints, 2, closed) // 2px thickness to match mesh
    }
  })
}

// Check if a line is closed (first and last points are adjacent)
const isLineClosed = (points: Point[]): boolean => {
  if (points.length < 3) return false
  const first = points[0]
  const last = points[points.length - 1]
  const dx = Math.abs(first.x - last.x)
  const dy = Math.abs(first.y - last.y)
  // Adjacent if distance <= sqrt(2) (diagonal neighbor)
  return dx <= 1 && dy <= 1
}

// Expand a polyline to a mesh with thickness
const expandLineToMesh = (points: Point[], thickness: number, closed: boolean): LineMesh => {
  const vertices: number[] = []
  const uvs: number[] = []
  const indices: number[] = []

  if (points.length < 2) {
    return { vertices, uvs, indices, closed }
  }

  const halfThickness = thickness / 2
  const n = points.length

  // Calculate total line length for UV mapping
  let totalLength = 0
  for (let i = 1; i < n; i++) {
    const dx = points[i].x - points[i - 1].x
    const dy = points[i].y - points[i - 1].y
    totalLength += Math.sqrt(dx * dx + dy * dy)
  }
  // Add closing segment length for closed curves
  if (closed) {
    const dx = points[0].x - points[n - 1].x
    const dy = points[0].y - points[n - 1].y
    totalLength += Math.sqrt(dx * dx + dy * dy)
  }

  let currentLength = 0

  for (let i = 0; i < n; i++) {
    const curr = points[i]
    let perpX: number, perpY: number

    // Determine if we have prev/next neighbors
    const hasPrev = closed || i > 0
    const hasNext = closed || i < n - 1
    const prevIdx = closed ? (i - 1 + n) % n : i - 1
    const nextIdx = closed ? (i + 1) % n : i + 1

    if (hasPrev && hasNext) {
      // Middle point (or any point in closed curve): use miter join
      const prev = points[prevIdx]
      const next = points[nextIdx]

      const dx1 = curr.x - prev.x
      const dy1 = curr.y - prev.y
      const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1) || 1

      const dx2 = next.x - curr.x
      const dy2 = next.y - curr.y
      const len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2) || 1

      const n1x = -dy1 / len1
      const n1y = dx1 / len1
      const n2x = -dy2 / len2
      const n2y = dx2 / len2

      perpX = (n1x + n2x) / 2
      perpY = (n1y + n2y) / 2

      const perpLen = Math.sqrt(perpX * perpX + perpY * perpY) || 1
      perpX /= perpLen
      perpY /= perpLen

      const dot = n1x * perpX + n1y * perpY
      if (Math.abs(dot) > 0.1) {
        perpX /= dot
        perpY /= dot
      }
    } else if (hasNext) {
      // First point of open curve
      const next = points[nextIdx]
      const dx = next.x - curr.x
      const dy = next.y - curr.y
      const len = Math.sqrt(dx * dx + dy * dy)
      if (len > 0) {
        perpX = -dy / len
        perpY = dx / len
      } else {
        perpX = 0; perpY = 0
      }
    } else {
      // Last point of open curve
      const prev = points[prevIdx]
      const dx = curr.x - prev.x
      const dy = curr.y - prev.y
      const len = Math.sqrt(dx * dx + dy * dy)
      if (len > 0) {
        perpX = -dy / len
        perpY = dx / len
      } else {
        perpX = 0; perpY = 0
      }
    }

    // Add two vertices (left and right of the line)
    const leftX = isNaN(perpX) ? curr.x : curr.x + perpX * halfThickness
    const leftY = isNaN(perpY) ? curr.y : curr.y + perpY * halfThickness
    const rightX = isNaN(perpX) ? curr.x : curr.x - perpX * halfThickness
    const rightY = isNaN(perpY) ? curr.y : curr.y - perpY * halfThickness

    vertices.push(leftX, leftY, rightX, rightY)

    // UV coordinates: u along the line, v across (0 = left, 1 = right)
    const u = totalLength > 0 ? currentLength / totalLength : 0
    uvs.push(u, 0, u, 1)

    // Update current length for next point
    if (i < n - 1) {
      const dx = points[i + 1].x - curr.x
      const dy = points[i + 1].y - curr.y
      currentLength += Math.sqrt(dx * dx + dy * dy)
    }
  }

  // Generate triangle indices
  // For closed curves: n segments (including the closing segment)
  // For open curves: n - 1 segments
  const numSegments = closed ? n : n - 1
  for (let i = 0; i < numSegments; i++) {
    const baseIdx = i * 2
    const nextIdx = ((i + 1) % n) * 2
    // Triangle 1: left[i], right[i], left[i+1]
    indices.push(baseIdx, baseIdx + 1, nextIdx)
    // Triangle 2: right[i], right[i+1], left[i+1]
    indices.push(baseIdx + 1, nextIdx + 1, nextIdx)
  }

  return { vertices, uvs, indices, closed }
}

// Generate meshes for all simplified lines
const generateMeshes = (lines: Point[][], thickness: number): LineMesh[] => {
  return lines.map(line => {
    const closed = isLineClosed(line)
    return expandLineToMesh(line, thickness, closed)
  })
}

// WebGL shader sources
const VERTEX_SHADER_SOURCE = `
  attribute vec2 a_position;
  attribute vec2 a_texCoord;
  uniform vec2 u_resolution;
  uniform vec2 u_translation;
  uniform float u_scale;
  varying vec2 v_texCoord;
  varying vec2 v_worldPos;

  void main() {
    // Apply scale and translation
    vec2 scaledPos = (a_position - u_translation) * u_scale + u_resolution * 0.5;
    // Convert from pixels to clip space (-1 to 1)
    vec2 clipSpace = (scaledPos / u_resolution) * 2.0 - 1.0;
    // Flip Y axis (canvas Y is down, WebGL Y is up)
    gl_Position = vec4(clipSpace.x, -clipSpace.y, 0, 1);
    v_texCoord = a_texCoord;
    v_worldPos = a_position; // Pass world position for noise
  }
`

const FRAGMENT_SHADER_SOURCE = `
  precision mediump float;
  varying vec2 v_texCoord;
  varying vec2 v_worldPos;
  uniform sampler2D u_texture;
  uniform bool u_useTexture;
  uniform vec4 u_color;

  // Hash function for noise
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  // Random value at integer coordinates
  float random(vec2 st) {
    return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
  }

  void main() {
    if (u_useTexture) {
      // Use world position for noise to get consistent pixel-like noise
      vec2 noiseCoord = floor(v_worldPos * 0.5); // Scale to control noise grain size

      // Generate vibrant random colors for each "pixel"
      float r = random(noiseCoord);
      float g = random(noiseCoord + vec2(1.0, 0.0));
      float b = random(noiseCoord + vec2(0.0, 1.0));

      // Boost saturation and brightness
      vec3 baseColor = vec3(r, g, b);

      // Increase contrast and brightness
      baseColor = baseColor * 0.7 + 0.3; // Range: 0.3 - 1.0 (brighter)

      // Boost saturation by pushing colors away from gray
      vec3 gray = vec3(dot(baseColor, vec3(0.299, 0.587, 0.114)));
      baseColor = mix(gray, baseColor, 1.5); // 1.5 = more saturated
      baseColor = clamp(baseColor, 0.0, 1.0);

      // Edge darkening based on v coordinate (0 and 1 are edges)
      float edgeDist = abs(v_texCoord.y - 0.5) * 2.0;
      float edgeFactor = 1.0 - edgeDist * edgeDist * 0.2;

      gl_FragColor = vec4(baseColor * edgeFactor, 1.0);
    } else {
      gl_FragColor = u_color;
    }
  }
`

// Create and compile a shader
const createShader = (gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null => {
  const shader = gl.createShader(type)
  if (!shader) return null

  gl.shaderSource(shader, source)
  gl.compileShader(shader)

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error('Shader compile error:', gl.getShaderInfoLog(shader))
    gl.deleteShader(shader)
    return null
  }

  return shader
}

// Create a WebGL program
const createProgram = (gl: WebGLRenderingContext, vertexShader: WebGLShader, fragmentShader: WebGLShader): WebGLProgram | null => {
  const program = gl.createProgram()
  if (!program) return null

  gl.attachShader(program, vertexShader)
  gl.attachShader(program, fragmentShader)
  gl.linkProgram(program)

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('Program link error:', gl.getProgramInfoLog(program))
    gl.deleteProgram(program)
    return null
  }

  return program
}

// Create a noise texture for line rendering
const createLineTexture = (gl: WebGLRenderingContext): WebGLTexture | null => {
  const texture = gl.createTexture()
  if (!texture) return null

  gl.bindTexture(gl.TEXTURE_2D, texture)

  // Create a 64x64 noise texture
  const size = 64
  const pixels = new Uint8Array(size * size * 4)

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4

      // Edge darkening effect (based on v coordinate simulation)
      const vCoord = y / size
      const edgeFactor = 1 - Math.pow(Math.abs(vCoord - 0.5) * 2, 2) // Brighter in center

      // Random noise
      const noise = (Math.random() * 0.3 + 0.7) // 0.7-1.0 range

      // Combine: base gray + edge darkening + noise
      const baseValue = 60 + edgeFactor * 40 // 60-100 range
      const finalValue = Math.floor(baseValue * noise)

      pixels[idx] = finalValue       // R
      pixels[idx + 1] = finalValue   // G
      pixels[idx + 2] = finalValue   // B
      pixels[idx + 3] = 255          // A
    }
  }

  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)

  return texture
}

// Draw a circle using WebGL
const drawCircle = (
  gl: WebGLRenderingContext,
  positionBuffer: WebGLBuffer | null,
  indexBuffer: WebGLBuffer | null,
  positionLocation: number,
  cx: number,
  cy: number,
  radius: number
) => {
  const segments = 16
  const vertices: number[] = [cx, cy] // Center point

  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * Math.PI * 2
    vertices.push(cx + Math.cos(angle) * radius)
    vertices.push(cy + Math.sin(angle) * radius)
  }

  const indices: number[] = []
  for (let i = 1; i <= segments; i++) {
    indices.push(0, i, i + 1)
  }

  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW)
  gl.enableVertexAttribArray(positionLocation)
  gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0)

  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer)
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW)

  gl.drawElements(gl.TRIANGLES, indices.length, gl.UNSIGNED_SHORT, 0)
}

// Trace continuous lines from wall points using DFS
const traceLines = (wallSet: Set<string>, width: number, height: number): Point[][] => {
  const visited = new Set<string>()
  const lines: Point[][] = []

  const getNeighbors = (x: number, y: number): Point[] => {
    const neighbors: Point[] = []
    // 8-directional neighbors
    const dirs = [
      [-1, -1], [-1, 0], [-1, 1],
      [0, -1], [0, 1],
      [1, -1], [1, 0], [1, 1]
    ]
    for (const [dx, dy] of dirs) {
      const nx = x + dx
      const ny = y + dy
      if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
        const key = `${nx},${ny}`
        if (wallSet.has(key) && !visited.has(key)) {
          neighbors.push({ x: nx, y: ny })
        }
      }
    }
    return neighbors
  }

  // Find all connected components
  const findConnectedComponent = (startX: number, startY: number): Point[] => {
    const component: Point[] = []
    const stack: Point[] = [{ x: startX, y: startY }]
    visited.add(`${startX},${startY}`)

    while (stack.length > 0) {
      const current = stack.pop()!
      component.push(current)

      const neighbors = getNeighbors(current.x, current.y)
      for (const neighbor of neighbors) {
        visited.add(`${neighbor.x},${neighbor.y}`)
        stack.push(neighbor)
      }
    }

    return component
  }

  // Order points along a line using direction-aware traversal
  const orderLinePoints = (component: Point[]): Point[] => {
    if (component.length <= 2) return component

    const pointSet = new Set(component.map(p => `${p.x},${p.y}`))

    // Build adjacency list
    const adjacency = new Map<string, Point[]>()
    for (const p of component) {
      const key = `${p.x},${p.y}`
      adjacency.set(key, [])
      const dirs = [
        [-1, -1], [-1, 0], [-1, 1],
        [0, -1], [0, 1],
        [1, -1], [1, 0], [1, 1]
      ]
      for (const [dx, dy] of dirs) {
        const nkey = `${p.x + dx},${p.y + dy}`
        if (pointSet.has(nkey)) {
          adjacency.get(key)!.push({ x: p.x + dx, y: p.y + dy })
        }
      }
    }

    // Find endpoint: prioritize points with minimum neighbors
    let lineStart = component[0]
    let minNeighbors = 9
    for (const p of component) {
      const count = adjacency.get(`${p.x},${p.y}`)!.length
      if (count < minNeighbors) {
        minNeighbors = count
        lineStart = p
        if (count === 1) break // True endpoint found
      }
    }

    // Trace from start point
    const ordered: Point[] = [lineStart]
    const visitedOrder = new Set<string>([`${lineStart.x},${lineStart.y}`])
    let lastDir: number | null = null

    const angleDiff = (a1: number, a2: number): number => {
      let diff = a2 - a1
      while (diff > Math.PI) diff -= 2 * Math.PI
      while (diff < -Math.PI) diff += 2 * Math.PI
      return Math.abs(diff)
    }

    while (ordered.length < component.length) {
      const current = ordered[ordered.length - 1]
      const neighbors = adjacency.get(`${current.x},${current.y}`) || []
      const unvisited = neighbors.filter(n => !visitedOrder.has(`${n.x},${n.y}`))

      if (unvisited.length === 0) break

      let bestNeighbor: Point | null = null

      if (lastDir === null || unvisited.length === 1) {
        bestNeighbor = unvisited[0]
      } else {
        // Choose neighbor that continues in most similar direction
        let minDiff = Infinity
        for (const n of unvisited) {
          const newDir = Math.atan2(n.y - current.y, n.x - current.x)
          const diff = angleDiff(lastDir, newDir)
          if (diff < minDiff) {
            minDiff = diff
            bestNeighbor = n
          }
        }
      }

      if (bestNeighbor) {
        lastDir = Math.atan2(bestNeighbor.y - current.y, bestNeighbor.x - current.x)
        ordered.push(bestNeighbor)
        visitedOrder.add(`${bestNeighbor.x},${bestNeighbor.y}`)
      } else {
        break
      }
    }

    return ordered
  }

  // Process all wall points
  for (const key of wallSet) {
    if (!visited.has(key)) {
      const [x, y] = key.split(',').map(Number)
      const component = findConnectedComponent(x, y)
      if (component.length > 0) {
        const orderedLine = orderLinePoints(component)
        lines.push(orderedLine)
      }
    }
  }

  return lines
}

function App() {
  const [imageSrc, setImageSrc] = useState<string | null>(null)
  const [mapData, setMapData] = useState<MapData | null>(null)
  
  // Map configuration states
  const [mapNameZh, setMapNameZh] = useState('')
  const [mapNameEn, setMapNameEn] = useState('')
  const [mapDescZh, setMapDescZh] = useState('')
  const [mapDescEn, setMapDescEn] = useState('')
  const [star1Time, setStar1Time] = useState<number | ''>('')
  const [star2Time, setStar2Time] = useState<number | ''>('')
  const [star3Time, setStar3Time] = useState<number | ''>('')

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const collisionCanvasRef = useRef<HTMLCanvasElement>(null)
  const hiddenCanvasRef = useRef<HTMLCanvasElement>(null)
  const webglCanvasRef = useRef<HTMLCanvasElement>(null)
  const glRef = useRef<WebGLRenderingContext | null>(null)
  const programRef = useRef<WebGLProgram | null>(null)
  const textureRef = useRef<WebGLTexture | null>(null)

  // Zoom and pan state
  const [scale, setScale] = useState(1)
  const [translation, setTranslation] = useState({ x: 512, y: 512 })
  const [isDragging, setIsDragging] = useState(false)
  const lastMousePos = useRef({ x: 0, y: 0 })

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      const reader = new FileReader()
      reader.onload = (event) => {
        setImageSrc(event.target?.result as string)
      }
      reader.readAsDataURL(file)
    }
  }

  const analyzeImage = useCallback((imgSrc: string) => {
    const img = new Image()
    img.onload = () => {
      const canvas = hiddenCanvasRef.current
      if (!canvas) return

      canvas.width = img.width
      canvas.height = img.height
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      ctx.drawImage(img, 0, 0)
      const imageData = ctx.getImageData(0, 0, img.width, img.height)
      const data = imageData.data

      // For 2048x1024 images, the map is the left half (1024x1024)
      // and items are on the right half (1024x1024)
      const mapWidth = img.width > 1024 ? Math.floor(img.width / 2) : img.width;

      const wallPoints: Point[] = []
      let startPoint: Point | null = null
      let endPoint: Point | null = null
      const wallSet = new Set<string>()
      const items: ItemPoint[] = []

      // Analyze each pixel for map (left side) and items (right side)
      for (let y = 0; y < img.height; y++) {
        for (let x = 0; x < img.width; x++) {
          const idx = (y * img.width + x) * 4
          const r = data[idx]
          const g = data[idx + 1]
          const b = data[idx + 2]
          const a = data[idx + 3]

          if (x < mapWidth) {
            // Map analysis (Left side)
            // Black wall: #000
            if (r === 0 && g === 0 && b === 0) {
              wallPoints.push({ x, y })
              wallSet.add(`${x},${y}`)
            }
            // Green start: #0f0
            else if (r === 0 && g === 255 && b === 0) {
              startPoint = { x, y }
            }
            // Red end: #f00
            else if (r === 255 && g === 0 && b === 0) {
              endPoint = { x, y }
            }
          } else {
            // Items analysis (Right side)
            // Not pure white or transparent
            if (a > 0 && !(r === 255 && g === 255 && b === 255)) {
              // Convert to map coordinate system
              items.push({
                x: x - mapWidth,
                y: y,
                color: `rgb(${r}, ${g}, ${b})`
              })
            }
          }
        }
      }

      // Trace continuous lines from wall points
      const lines = traceLines(wallSet, mapWidth, img.height)

      // Apply RDP simplification (epsilon = 1.0 for pixel-level precision)
      const epsilon = 1.0
      const simplifiedLines = simplifyLines(lines, epsilon)

      // Calculate point counts
      const originalPointCount = lines.reduce((sum, line) => sum + line.length, 0)
      const simplifiedPointCount = simplifiedLines.reduce((sum, line) => sum + line.points.length, 0)

      // Generate mesh data for each line (2px thickness)
      const meshes = generateMeshes(simplifiedLines.map(sl => sl.points), 1)

      // Normalize all points to top-left corner (remove extra whitespace)
      const allPoints: Point[] = [...wallPoints]
      if (startPoint) allPoints.push(startPoint)
      if (endPoint) allPoints.push(endPoint)

      if (allPoints.length > 0) {
        const minX = Math.min(...allPoints.map(p => p.x))
        const minY = Math.min(...allPoints.map(p => p.y))

        // Offset all points
        for (const p of wallPoints) {
          p.x -= minX
          p.y -= minY
        }
        if (startPoint) {
          startPoint.x -= minX
          startPoint.y -= minY
        }
        if (endPoint) {
          endPoint.x -= minX
          endPoint.y -= minY
        }
        // Offset items
        for (const item of items) {
          item.x -= minX
          item.y -= minY
        }
        for (const line of lines) {
          for (const p of line) {
            p.x -= minX
            p.y -= minY
          }
        }
        for (const sl of simplifiedLines) {
          for (const p of sl.points) {
            p.x -= minX
            p.y -= minY
          }
          for (const poly of sl.polygons) {
            for (const p of poly) {
              p.x -= minX
              p.y -= minY
            }
          }
        }
        // Also offset mesh vertices
        for (const mesh of meshes) {
          for (let i = 0; i < mesh.vertices.length; i += 2) {
            mesh.vertices[i] -= minX
            mesh.vertices[i + 1] -= minY
          }
        }
      }

      // Count closed lines from meshes
      const closedLineCount = meshes.filter(m => m.closed).length

      const result: MapData = {
        wallPoints,
        startPoint,
        endPoint,
        lines,
        lineCount: lines.length,
        closedLineCount,
        simplifiedLines,
        originalPointCount,
        simplifiedPointCount,
        meshes,
        items
      }

      setMapData(result)
      console.log('Map Analysis Result:', JSON.stringify(result, null, 2))
    }
    img.src = imgSrc
  }, [])

  // Draw on canvas when mapData changes
  useEffect(() => {
    if (!mapData || !canvasRef.current) return

    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Clear canvas with white background
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, 1024, 1024)

    // Draw lines using simplified data (black, 1px)
    ctx.strokeStyle = '#000000'
    ctx.lineWidth = 1
    for (const sl of mapData.simplifiedLines) {
      const points = sl.points
      if (points.length > 0) {
        ctx.beginPath()
        ctx.moveTo(points[0].x, points[0].y)
        for (let i = 1; i < points.length; i++) {
          ctx.lineTo(points[i].x, points[i].y)
        }
        if (sl.closed) {
          ctx.closePath()
        }
        ctx.stroke()
      }
    }

    // Draw start point (green circle, 3px)
    if (mapData.startPoint) {
      ctx.fillStyle = '#00ff00'
      ctx.beginPath()
      ctx.arc(mapData.startPoint.x, mapData.startPoint.y, 3, 0, Math.PI * 2)
      ctx.fill()
    }

    // Draw end point (red circle, 3px)
    if (mapData.endPoint) {
      ctx.fillStyle = '#ff0000'
      ctx.beginPath()
      ctx.arc(mapData.endPoint.x, mapData.endPoint.y, 3, 0, Math.PI * 2)
      ctx.fill()
    }

    // Draw items (colored circles, 2px)
    if (mapData.items && mapData.items.length > 0) {
      for (const item of mapData.items) {
        ctx.fillStyle = item.color
        ctx.beginPath()
        ctx.arc(item.x, item.y, 2, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }, [mapData])

  // Draw collision polygons on a separate canvas
  useEffect(() => {
    if (!mapData || !collisionCanvasRef.current) return

    const canvas = collisionCanvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Clear canvas with white background
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    ctx.save()
    // Apply zoom and pan
    ctx.translate(canvas.width / 2, canvas.height / 2)
    ctx.scale(scale, scale)
    ctx.translate(-translation.x, -translation.y)

    // Draw polygons using alternating red and green colors (1px)
    let polyIdx = 0
    ctx.lineWidth = 1 / scale // Keep line width constant regardless of zoom
    for (const sl of mapData.simplifiedLines) {
      for (const poly of sl.polygons) {
        ctx.strokeStyle = polyIdx % 2 === 0 ? '#ff0000' : '#00ff00'
        if (poly.length > 0) {
          ctx.beginPath()
          ctx.moveTo(poly[0].x, poly[0].y)
          for (let i = 1; i < poly.length; i++) {
            ctx.lineTo(poly[i].x, poly[i].y)
          }
          ctx.closePath()
          ctx.stroke()
        }
        polyIdx++
      }
    }
    ctx.restore()
  }, [mapData, scale, translation])

  // WebGL rendering when mapData changes
  useEffect(() => {
    if (!mapData || !webglCanvasRef.current) return

    const canvas = webglCanvasRef.current
    let gl = glRef.current

    // Initialize WebGL context if not already done
    if (!gl) {
      gl = canvas.getContext('webgl')
      if (!gl) {
        console.error('WebGL not supported')
        return
      }
      glRef.current = gl

      // Create shaders and program
      const vertexShader = createShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER_SOURCE)
      const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER_SOURCE)
      if (!vertexShader || !fragmentShader) return

      const program = createProgram(gl, vertexShader, fragmentShader)
      if (!program) return
      programRef.current = program

      // Create texture
      textureRef.current = createLineTexture(gl)
    }

    const program = programRef.current
    if (!program) return

    gl.useProgram(program)

    // Clear canvas with white background
    gl.viewport(0, 0, canvas.width, canvas.height)
    gl.clearColor(1.0, 1.0, 1.0, 1.0)
    gl.clear(gl.COLOR_BUFFER_BIT)

    // Get attribute and uniform locations
    const positionLocation = gl.getAttribLocation(program, 'a_position')
    const texCoordLocation = gl.getAttribLocation(program, 'a_texCoord')
    const resolutionLocation = gl.getUniformLocation(program, 'u_resolution')
    const translationLocation = gl.getUniformLocation(program, 'u_translation')
    const scaleLocation = gl.getUniformLocation(program, 'u_scale')
    const textureLocation = gl.getUniformLocation(program, 'u_texture')
    const useTextureLocation = gl.getUniformLocation(program, 'u_useTexture')
    const colorLocation = gl.getUniformLocation(program, 'u_color')

    // Set resolution and transform
    gl.uniform2f(resolutionLocation, canvas.width, canvas.height)
    gl.uniform2f(translationLocation, translation.x, translation.y)
    gl.uniform1f(scaleLocation, scale)

    // Bind texture
    if (textureRef.current) {
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, textureRef.current)
      gl.uniform1i(textureLocation, 0)
      gl.uniform1i(useTextureLocation, 1)
    } else {
      gl.uniform1i(useTextureLocation, 0)
      gl.uniform4f(colorLocation, 0, 0, 0, 1) // Black color
    }

    // Create buffers
    const positionBuffer = gl.createBuffer()
    const texCoordBuffer = gl.createBuffer()
    const indexBuffer = gl.createBuffer()

    // Draw each mesh
    for (const mesh of mapData.meshes) {
      if (mesh.vertices.length === 0) continue

      // Upload vertex positions
      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer)
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(mesh.vertices), gl.STATIC_DRAW)
      gl.enableVertexAttribArray(positionLocation)
      gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0)

      // Upload UV coordinates
      gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer)
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(mesh.uvs), gl.STATIC_DRAW)
      gl.enableVertexAttribArray(texCoordLocation)
      gl.vertexAttribPointer(texCoordLocation, 2, gl.FLOAT, false, 0, 0)

      // Upload indices
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer)
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(mesh.indices), gl.STATIC_DRAW)

      // Draw triangles
      gl.drawElements(gl.TRIANGLES, mesh.indices.length, gl.UNSIGNED_SHORT, 0)
    }

    // Draw start point (green)
    // Disable texCoord attribute before drawing circles to avoid buffer size mismatch
    gl.disableVertexAttribArray(texCoordLocation)
    if (mapData.startPoint) {
      gl.uniform1i(useTextureLocation, 0)
      gl.uniform4f(colorLocation, 0, 1, 0, 1)
      drawCircle(gl, positionBuffer, indexBuffer, positionLocation, mapData.startPoint.x, mapData.startPoint.y, 5 / scale)
    }

    // Draw end point (red)
    if (mapData.endPoint) {
      gl.uniform1i(useTextureLocation, 0)
      gl.uniform4f(colorLocation, 1, 0, 0, 1)
      drawCircle(gl, positionBuffer, indexBuffer, positionLocation, mapData.endPoint.x, mapData.endPoint.y, 5 / scale)
    }

    // Draw items
    if (mapData.items && mapData.items.length > 0) {
      gl.uniform1i(useTextureLocation, 0)
      for (const item of mapData.items) {
        // Parse rgb string "rgb(r, g, b)"
        const match = item.color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/)
        if (match) {
          const r = parseInt(match[1]) / 255
          const g = parseInt(match[2]) / 255
          const b = parseInt(match[3]) / 255
          gl.uniform4f(colorLocation, r, g, b, 1)
          drawCircle(gl, positionBuffer, indexBuffer, positionLocation, item.x, item.y, 3 / scale)
        }
      }
    }

    // Cleanup buffers
    gl.deleteBuffer(positionBuffer)
    gl.deleteBuffer(texCoordBuffer)
    gl.deleteBuffer(indexBuffer)
  }, [mapData, scale, translation])

  // Analyze image when it's loaded
  useEffect(() => {
    if (imageSrc) {
      analyzeImage(imageSrc)
    }
  }, [imageSrc, analyzeImage])

  // Mouse event handlers for zoom and pan
  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const delta = e.deltaY > 0 ? 0.9 : 1.1
    const newScale = Math.min(Math.max(scale * delta, 0.1), 50)

    // Zoom towards mouse position
    const canvas = webglCanvasRef.current
    if (canvas) {
      const rect = canvas.getBoundingClientRect()
      const mouseX = e.clientX - rect.left
      const mouseY = e.clientY - rect.top

      // Convert mouse position to world coordinates before zoom
      const worldX = translation.x + (mouseX - canvas.width / 2) / scale
      const worldY = translation.y + (mouseY - canvas.height / 2) / scale

      // After zoom, keep the same world point under the mouse
      const newTransX = worldX - (mouseX - canvas.width / 2) / newScale
      const newTransY = worldY - (mouseY - canvas.height / 2) / newScale

      setTranslation({ x: newTransX, y: newTransY })
    }

    setScale(newScale)
  }, [scale, translation])

  // Add wheel event listener with { passive: false } to prevent page scroll
  useEffect(() => {
    const canvas = webglCanvasRef.current
    const collisionCanvas = collisionCanvasRef.current
    if (!canvas) return

    canvas.addEventListener('wheel', handleWheel, { passive: false })
    if (collisionCanvas) {
      collisionCanvas.addEventListener('wheel', handleWheel, { passive: false })
    }
    
    return () => {
      canvas.removeEventListener('wheel', handleWheel)
      if (collisionCanvas) {
        collisionCanvas.removeEventListener('wheel', handleWheel)
      }
    }
  }, [handleWheel])

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    setIsDragging(true)
    lastMousePos.current = { x: e.clientX, y: e.clientY }
  }, [])

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDragging) return

    const dx = e.clientX - lastMousePos.current.x
    const dy = e.clientY - lastMousePos.current.y
    lastMousePos.current = { x: e.clientX, y: e.clientY }

    setTranslation(prev => ({
      x: prev.x - dx / scale,
      y: prev.y - dy / scale
    }))
  }, [isDragging, scale])

  const handleMouseUp = useCallback(() => {
    setIsDragging(false)
  }, [])

  const handleMouseLeave = useCallback(() => {
    setIsDragging(false)
  }, [])

  const resetView = useCallback(() => {
    setScale(1)
    setTranslation({ x: 512, y: 512 })
  }, [])

  // Download JSON data
  const handleDownloadJson = () => {
    if (!mapData) return

    const exportData = {
      mapNameZh,
      mapNameEn,
      mapDescZh,
      mapDescEn,
      star1Time: Number(star1Time) || 0,
      star2Time: Number(star2Time) || 0,
      star3Time: Number(star3Time) || 0,
      lineCount: mapData.lineCount,
      closedLineCount: mapData.closedLineCount,
      simplifiedPointCount: mapData.simplifiedPointCount,
      startPoint: mapData.startPoint,
      endPoint: mapData.endPoint,
      simplifiedLines: mapData.simplifiedLines,
      meshes: mapData.meshes,
      items: mapData.items
    }

    const jsonStr = JSON.stringify(exportData)
    const blob = new Blob([jsonStr], { type: 'application/json' })
    const url = URL.createObjectURL(blob)

    const a = document.createElement('a')
    a.href = url
    a.download = 'map-data.json'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <div className="app">
      <div className="upload-section">
        <input
          type="file"
          accept="image/*"
          onChange={handleImageSelect}
          id="image-input"
          style={{ display: 'none' }}
        />
        <label htmlFor="image-input" className="upload-button">
          选择地图图片
        </label>
      </div>

      {imageSrc && (
        <div className="image-section">
          <h3>原始图片</h3>
          <div className="image-container">
            <img src={imageSrc} alt="Map" />
          </div>
        </div>
      )}

      {mapData && (
        <div className="form-section">
          <h3>地图配置</h3>
          <div className="form-grid">
            <div className="form-group">
              <label>地图名称 (中):</label>
              <input type="text" value={mapNameZh} onChange={e => setMapNameZh(e.target.value)} placeholder="输入中文名称" />
            </div>
            <div className="form-group">
              <label>地图名称 (英):</label>
              <input type="text" value={mapNameEn} onChange={e => setMapNameEn(e.target.value)} placeholder="Input English name" />
            </div>
            <div className="form-group">
              <label>地图介绍 (中):</label>
              <textarea value={mapDescZh} onChange={e => setMapDescZh(e.target.value)} placeholder="输入中文介绍" />
            </div>
            <div className="form-group">
              <label>地图介绍 (英):</label>
              <textarea value={mapDescEn} onChange={e => setMapDescEn(e.target.value)} placeholder="Input English description" />
            </div>
            <div className="form-group">
              <label>一星通关秒数:</label>
              <input type="number" value={star1Time} onChange={e => setStar1Time(e.target.value ? Number(e.target.value) : '')} placeholder="例如: 60" min="0" />
            </div>
            <div className="form-group">
              <label>二星通关秒数:</label>
              <input type="number" value={star2Time} onChange={e => setStar2Time(e.target.value ? Number(e.target.value) : '')} placeholder="例如: 45" min="0" />
            </div>
            <div className="form-group">
              <label>三星通关秒数:</label>
              <input type="number" value={star3Time} onChange={e => setStar3Time(e.target.value ? Number(e.target.value) : '')} placeholder="例如: 30" min="0" />
            </div>
          </div>
        </div>
      )}

      {mapData && (
        <div className="canvas-section">
          <h3>分析结果</h3>
          <p>墙壁点数量: {mapData.wallPoints.length}</p>
          <p>线条数量: {mapData.lineCount} (闭合: {mapData.closedLineCount}, 开放: {mapData.lineCount - mapData.closedLineCount})</p>
          <p>原始线条点数: {mapData.originalPointCount}</p>
          <p>RDP简化后点数: {mapData.simplifiedPointCount} (减少 {((1 - mapData.simplifiedPointCount / mapData.originalPointCount) * 100).toFixed(1)}%)</p>
          <p>起点: {mapData.startPoint ? `(${mapData.startPoint.x}, ${mapData.startPoint.y})` : '未找到'}</p>
          <p>终点: {mapData.endPoint ? `(${mapData.endPoint.x}, ${mapData.endPoint.y})` : '未找到'}</p>
          <p>道具数量: {mapData.items ? mapData.items.length : 0}</p>
          <button className="download-button" onClick={handleDownloadJson}>
            下载 JSON 数据
          </button>
          <canvas
            ref={canvasRef}
            width={1024}
            height={1024}
            className="result-canvas"
          />
        </div>
      )}

      {mapData && (
        <div className="canvas-section">
          <h3>WebGL Mesh 渲染 (1px 线宽)</h3>
          <p>Mesh 数量: {mapData.meshes.length} (闭合: {mapData.closedLineCount}, 开放: {mapData.lineCount - mapData.closedLineCount})</p>
          <p>总顶点数: {mapData.meshes.reduce((sum, m) => sum + m.vertices.length / 2, 0)}</p>
          <p>总三角形数: {mapData.meshes.reduce((sum, m) => sum + m.indices.length / 3, 0)}</p>
          <p>缩放: {scale.toFixed(2)}x | 滚轮缩放，拖拽平移</p>
          <button className="download-button" onClick={resetView} style={{ marginBottom: '10px' }}>
            重置视图
          </button>
          <canvas
            ref={webglCanvasRef}
            width={1024}
            height={1024}
            className="result-canvas"
            style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseLeave}
          />
        </div>
      )}

      {mapData && (
        <div className="canvas-section">
          <h3>物理碰撞多边形 (Red/Green 1px)</h3>
          <p>多边形数量: {mapData.simplifiedLines.reduce((sum, sl) => sum + sl.polygons.length, 0)}</p>
          <p>用于物理引擎的碰撞边界验证 | 同步缩放平移</p>
          <canvas
            ref={collisionCanvasRef}
            width={1024}
            height={1024}
            className="result-canvas"
            style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseLeave}
          />
        </div>
      )}

      {/* Hidden canvas for image analysis */}
      <canvas ref={hiddenCanvasRef} style={{ display: 'none' }} />
    </div>
  )
}

export default App
