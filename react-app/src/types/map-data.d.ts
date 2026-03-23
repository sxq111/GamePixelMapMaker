/**
 * 2D point coordinate
 */
export interface Point {
  x: number
  y: number
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
  /** Lines after RDP (Douglas-Peucker) simplification */
  simplifiedLines: Point[][]
  /** Total point count before simplification */
  originalPointCount: number
  /** Total point count after simplification */
  simplifiedPointCount: number
  /** Mesh data for each simplified line (for WebGL/Cocos rendering) */
  meshes: LineMesh[]
}
