/**
 * 2D point coordinate
 */
export interface Point {
  x: number
  y: number
}

/**
 * Item point coordinate and color
 */
export interface ItemPoint {
  x: number
  y: number
  color: string
}

/**
 * Mesh data for a single line, compatible with Cocos MeshRenderer
 */
export interface LineMesh {
  /** Vertex positions: [x, y, x, y, ...] in pixels */
  vertices: number[]
  /** UV coordinates: [u, v, u, v, ...] where u is along line (0-1), v is across (0=left, 1=right) */
  uvs: number[]
  /** Triangle indices for rendering */
  indices: number[]
}

/**
 * Simplified line data
 */
export interface SimplifiedLine {
  /** Points in the line */
  points: Point[]
  /** Whether the line is a closed loop */
  closed: boolean
  /** Polygons for collision: [points[], points[]...]. 
   * For open lines, contains one polygon wrapping the line.
   * For closed lines, contains two polygons (outer and inner boundaries).
   */
  polygons: Point[][]
}

/**
 * Complete map analysis result
 */
export interface MapData {
  /** All wall pixel coordinates (raw, before simplification) */
  wallPoints: Point[]
  /** Start point coordinate (green pixel #00ff00), null if not found */
  startPoint: Point | null
  /** End point coordinate (red pixel #ff0000), null if not found */
  endPoint: Point | null
  /** Original traced lines before RDP simplification */
  lines: Point[][]
  /** Number of separate line segments */
  lineCount: number
  /** Number of closed loops */
  closedLineCount: number
  /** Lines after RDP (Douglas-Peucker) simplification */
  simplifiedLines: SimplifiedLine[]
  /** Total point count before simplification */
  originalPointCount: number
  /** Total point count after simplification */
  simplifiedPointCount: number
  /** Mesh data for each simplified line (for WebGL/Cocos rendering) */
  meshes: LineMesh[]
  /** Items found on the right half of the map */
  items: ItemPoint[]
}
