# UV功能解析详文档

## 目录
1. [项目概述](#项目概述)
2. [UV坐标基础概念](#uv坐标基础概念)
3. [UV生成核心逻辑](#uv生成核心逻辑)
4. [Mesh数据结构](#mesh数据结构)
5. [Mesh使用方式](#mesh使用方式)
6. [代码实现详解](#代码实现详解)
7. [最佳实践](#最佳实践)

---

## 项目概述

**项目名称**: Pixel Map Maker（像素地图生成器）

**核心功能**:
- 分析2D像素地图图像
- 自动识别墙体、路径、起点、终点、道具等元素
- 生成带有UV坐标的3D网格（Mesh）供游戏引擎渲染
- 支持WebGL和Cocos MeshRenderer等游戏引擎

**技术栈**:
- React 19.2 + TypeScript
- WebGL（GPU渲染）
- Canvas 2D API（分析可视化）
- Vite（构建工具）

---

## UV坐标基础概念

### 什么是UV？

在计算机图形学中，**UV坐标是2D纹理贴图上的坐标系统**：
- **U轴**: 水平方向（相当于2D的X轴）
- **V轴**: 垂直方向（相当于2D的Y轴）

### UV的作用

UV的核心作用是**建立3D模型表面与2D纹理贴图之间的映射关系**：
- 告诉渲染引擎，3D模型表面的每个点应该显示纹理贴图上哪个像素的颜色
- 使得平面的2D图片能正确地"贴"到复杂的3D模型表面上
- 无UV坐标，纹理无法正确应用，模型就是灰白色无质感的

### 坐标范围

标准UV坐标范围为 `[0, 1]`：
- `u = 0`: 左边界或起点
- `u = 1`: 右边界或终点
- `v = 0`: 下边界或一侧
- `v = 1`: 上边界或另一侧

---

## UV生成核心逻辑

### 项目中的UV生成方式：样条线展开（Spline Unwrapping）

本项目采用的是典型的**样条线展开**逻辑，将一条由多个点组成的路径（Polyline）转换为具有一定宽度的网格，并为每个顶点动态计算UV坐标。

### U坐标的生成逻辑（沿线条方向）

#### 核心思想
**沿着线条的前进方向均匀铺设纹理**，确保无论线条的点密度如何变化，纹理的拉伸都是均匀的。

#### 生成步骤

**第一步：计算总长度**
```
遍历所有点，累加相邻点之间的距离
totalLength = Σ sqrt((x[i+1]-x[i])² + (y[i+1]-y[i])²)

对于闭合线条，还需加上最后一个点回到第一个点的距离
```

**第二步：计算当前进度**
```
对每个顶点，记录从起点到该点的累计距离
currentLength = Σ sqrt((x[j+1]-x[j])² + (y[j+1]-y[j])²)  (j从0到i-1)
```

**第三步：映射到[0,1]范围**
```
u = currentLength / totalLength

示例：
- 线条起点: u = 0/totalLength = 0
- 线条中点: u = totalLength/2 / totalLength = 0.5
- 线条终点: u = totalLength / totalLength = 1
```

#### 为什么这样做？

这种方式保证了**等距离在纹理上显示**：
- 如果线条某处的点密集，多个密集的点仍然占据相同的纹理空间（因为它们的距离相近）
- 纹理不会在点密集处被压缩，在点稀疏处被拉伸
- 无论多么复杂的曲线，纹理都能均匀地沿路径铺设

### V坐标的生成逻辑（垂直于线条）

#### 核心思想
**直接映射线条的左右两侧**，使纹理能够横跨整个线条宽度。

#### 生成步骤

**第一步：计算法线方向**
```
对于每个点，计算其法线（垂直于线条方向的向量）

对于中间点（有前驱和后继）：使用Miter Join
  n1 = 前一段的法线
  n2 = 后一段的法线
  法线 = 归一化(n1 + n2)

对于端点：
  法线 = 该点到相邻点方向的垂直向量
```

**第二步：展开顶点**
```
原始点 P 根据法线展开成两个顶点：
  leftVertex = P + normal * (thickness/2)
  rightVertex = P - normal * (thickness/2)
```

**第三步：固定V坐标**
```
leftVertex 的 UV: (u, v=0)
rightVertex 的 UV: (u, v=1)

这样左侧始终为0，右侧始终为1
```

#### 为什么这样做？

- **左右一致性**: 所有左侧顶点的V值都是0，右侧都是1，确保纹理方向一致
- **宽度覆盖**: 纹理能够完整地从左侧（v=0）横跨到右侧（v=1）
- **简单高效**: 无需复杂计算，直接映射确保高性能

### 法线计算的细节：Miter Join

对于线条的中间点，法线的计算涉及一个图形学概念：**Miter Join（斜角接合）**。

```
输入：前一段和后一段的方向向量
过程：
  1. 计算前一段的法线 n1
  2. 计算后一段的法线 n2
  3. 取平均：(n1 + n2) / 2
  4. 归一化这个平均向量
  5. 根据点积调整大小，避免角度太锐利时法线过大

输出：平滑的法线，确保线条在转角处不会有锯齿或缝隙
```

---

## Mesh数据结构

### LineMesh接口定义

```typescript
export interface LineMesh {
  /** 顶点位置：[x, y, x, y, ...] 以像素为单位 */
  vertices: number[]

  /** UV坐标：[u, v, u, v, ...]
   *  u: 沿线条方向，0-1
   *  v: 垂直于线条，0=左侧，1=右侧
   */
  uvs: number[]

  /** 三角形索引：指向vertices数组中的顶点 */
  indices: number[]
}
```

### 数据布局示例

假设一条线条有3个点，生成的Mesh数据如下：

```
原始点：P0, P1, P2

展开后的顶点（每个点变成两个）：
  P0_left, P0_right, P1_left, P1_right, P2_left, P2_right

Vertices数组：
  [
    P0_left.x, P0_left.y,      // 顶点0
    P0_right.x, P0_right.y,    // 顶点1
    P1_left.x, P1_left.y,      // 顶点2
    P1_right.x, P1_right.y,    // 顶点3
    P2_left.x, P2_left.y,      // 顶点4
    P2_right.x, P2_right.y,    // 顶点5
  ]

UVs数组（与顶点一一对应）：
  [
    u0, 0,    // 顶点0的UV
    u0, 1,    // 顶点1的UV
    u1, 0,    // 顶点2的UV
    u1, 1,    // 顶点3的UV
    u2, 0,    // 顶点4的UV
    u2, 1,    // 顶点5的UV
  ]

Indices数组（定义三角形）：
  [
    0, 1, 2,   // 第一个三角形：左0，右0，左1
    1, 3, 2,   // 第二个三角形：右0，右1，左1
    2, 3, 4,   // 第三个三角形：左1，右1，左2
    3, 5, 4,   // 第四个三角形：右1，右2，左2
  ]

总体形成一个四边形网格
```

### 数据结构的特点

| 特点 | 说明 |
|------|------|
| **Vertices** | 每个点占2个浮点数（x, y） |
| **UVs** | 与Vertices一一对应，每个点占2个浮点数（u, v） |
| **Indices** | 使用三角形索引，便于WebGL渲染 |
| **内存效率** | 使用索引避免重复存储顶点数据 |

---

## Mesh使用方式

### 1. WebGL渲染使用

#### 在Cocos引擎中使用

```typescript
// 1. 将Mesh数据转换为Cocos可识别的格式
const meshData = {
  vertices: mesh.vertices,        // Float32Array
  uvs: mesh.uvs,                  // Float32Array
  indices: mesh.indices,          // Uint16Array或Uint32Array
};

// 2. 创建MeshRenderer
const meshRenderer = node.addComponent(cc.MeshRenderer);

// 3. 创建自定义Mesh
const customMesh = new cc.Mesh();
customMesh.vertices = meshData.vertices;
customMesh.uv = meshData.uvs;
customMesh.indices = meshData.indices;

// 4. 设置材质
const material = new cc.Material();
material.setProperty('mainTexture', textureAsset);
meshRenderer.setSharedMaterial(material, 0);
meshRenderer.mesh = customMesh;
```

#### 在原生WebGL中使用

```typescript
// 1. 创建顶点缓冲对象
const positionBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(mesh.vertices), gl.STATIC_DRAW);

// 2. 创建UV缓冲对象
const uvBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(mesh.uvs), gl.STATIC_DRAW);

// 3. 创建索引缓冲对象
const indexBuffer = gl.createBuffer();
gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(mesh.indices), gl.STATIC_DRAW);

// 4. 绑定到着色器程序
const positionLocation = gl.getAttribLocation(program, 'a_position');
const uvLocation = gl.getAttribLocation(program, 'a_texCoord');

gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
gl.enableVertexAttribArray(positionLocation);

gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer);
gl.vertexAttribPointer(uvLocation, 2, gl.FLOAT, false, 0, 0);
gl.enableVertexAttribArray(uvLocation);

// 5. 渲染
gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
gl.drawElements(gl.TRIANGLES, mesh.indices.length, gl.UNSIGNED_SHORT, 0);
```

### 2. 物理碰撞使用

Mesh主要用于**视觉渲染**。对于**物理碰撞检测**，项目另外生成了碰撞多边形：

```typescript
// SimplifiedLine包含碰撞多边形
interface SimplifiedLine {
  points: Point[]         // 简化后的点
  closed: boolean         // 是否闭合
  polygons: Point[][]     // 碰撞多边形数组
}

// 使用方式：
// 1. 对于开放线条：包含一个多边形（线条两侧展开）
// 2. 对于闭合线条：包含两个多边形（外边界和内边界）

// 传递给物理引擎
physicsWorld.addBody(
  createBodyFromPolygon(simplifiedLine.polygons[0])
);
```

### 3. 纹理应用

#### 配置UV采样

由于本项目的UV坐标已经是标准的 `[0, 1]` 范围，可以直接应用纹理：

```typescript
// 片元着色器示例
uniform sampler2D u_texture;
varying vec2 v_texCoord;

void main() {
  // v_texCoord 直接来自mesh的UV坐标
  vec4 texColor = texture2D(u_texture, v_texCoord);
  gl_FragColor = texColor;
}
```

#### UV缠绕模式设置

```typescript
// WebGL中的UV重复设置
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);  // U方向重复
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);  // V方向重复

// 或者使用夹持（CLAMP）避免纹理溢出
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
```

### 4. 导出和存储

Mesh数据可以直接序列化为JSON格式存储：

```typescript
// 导出格式
const mapData = {
  mapNameZh: "关卡名称",
  mapNameEn: "Level Name",
  meshes: [
    {
      vertices: [x1, y1, x2, y2, ...],
      uvs: [u1, v1, u2, v2, ...],
      indices: [0, 1, 2, 1, 3, 2, ...]
    },
    // ... 更多mesh
  ],
  items: [
    { x: 100, y: 200, color: "#FF0000" },
    // ... 更多道具
  ]
};

// 存储为JSON
const jsonString = JSON.stringify(mapData);
// 可以保存到文件或发送到服务器
```

---

## 代码实现详解

### expandLineToMesh函数分析

这是项目中**最核心的UV生成函数**，位于 `src/App.tsx:221-349`。

#### 函数签名

```typescript
const expandLineToMesh = (
  points: Point[],      // 输入：路径上的点
  thickness: number,    // 输入：线条宽度
  closed: boolean       // 输入：是否闭合
): LineMesh             // 输出：包含顶点、UV、索引的网格
```

#### 执行流程

**第一阶段：初始化与长度计算**

```typescript
const halfThickness = thickness / 2
const n = points.length

// 计算总长度
let totalLength = 0
for (let i = 1; i < n; i++) {
  const dx = points[i].x - points[i - 1].x
  const dy = points[i].y - points[i - 1].y
  totalLength += Math.sqrt(dx * dx + dy * dy)
}

// 闭合线条需要加上回到起点的距离
if (closed) {
  const dx = points[0].x - points[n - 1].x
  const dy = points[0].y - points[n - 1].y
  totalLength += Math.sqrt(dx * dx + dy * dy)
}
```

**第二阶段：逐点展开与UV计算**

```typescript
let currentLength = 0

for (let i = 0; i < n; i++) {
  const curr = points[i]

  // 1. 确定前驱和后继
  const hasPrev = closed || i > 0
  const hasNext = closed || i < n - 1

  // 2. 计算法线方向
  let perpX, perpY
  if (hasPrev && hasNext) {
    // 中间点：使用Miter Join计算法线
    // ... 详细计算逻辑
  } else if (hasNext) {
    // 首点：使用下一段方向的垂直向量
    // ... 计算逻辑
  } else {
    // 末点：使用前一段方向的垂直向量
    // ... 计算逻辑
  }

  // 3. 展开左右顶点
  const leftX = curr.x + perpX * halfThickness
  const leftY = curr.y + perpY * halfThickness
  const rightX = curr.x - perpX * halfThickness
  const rightY = curr.y - perpY * halfThickness

  // 4. 添加顶点到数组
  vertices.push(leftX, leftY, rightX, rightY)

  // 5. 计算并添加UV坐标（核心！）
  const u = totalLength > 0 ? currentLength / totalLength : 0
  uvs.push(u, 0, u, 1)

  // 6. 更新当前长度计数器
  if (i < n - 1) {
    const dx = points[i + 1].x - curr.x
    const dy = points[i + 1].y - curr.y
    currentLength += Math.sqrt(dx * dx + dy * dy)
  }
}
```

**第三阶段：三角形索引生成**

```typescript
const numSegments = closed ? n : n - 1

for (let i = 0; i < numSegments; i++) {
  const baseIdx = i * 2           // 左顶点索引
  const nextIdx = ((i + 1) % n) * 2  // 下一个点的左顶点索引

  // 每个线段产生两个三角形
  // 三角形1：左[i], 右[i], 左[i+1]
  indices.push(baseIdx, baseIdx + 1, nextIdx)

  // 三角形2：右[i], 右[i+1], 左[i+1]
  indices.push(baseIdx + 1, nextIdx + 1, nextIdx)
}
```

#### 关键公式详解

**法线计算（Miter Join）**

```typescript
// 前一段方向和法线
const dx1 = curr.x - prev.x
const dy1 = curr.y - prev.y
const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1)
const n1x = -dy1 / len1  // 垂直向量，逆时针旋转90度
const n1y = dx1 / len1

// 后一段方向和法线
const dx2 = next.x - curr.x
const dy2 = next.y - curr.y
const len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2)
const n2x = -dy2 / len2
const n2y = dx2 / len2

// 平均法线
perpX = (n1x + n2x) / 2
perpY = (n1y + n2y) / 2

// 归一化
const perpLen = Math.sqrt(perpX * perpX + perpY * perpY)
perpX /= perpLen
perpY /= perpLen

// 角度过锐时调整（避免过大的法线）
const dot = n1x * perpX + n1y * perpY
if (Math.abs(dot) > 0.1) {
  perpX /= dot
  perpY /= dot
}
```

**UV坐标计算**

```typescript
// 这是最关键的一行！
const u = totalLength > 0 ? currentLength / totalLength : 0
uvs.push(u, 0, u, 1)

// 左顶点：(u, v=0)
// 右顶点：(u, v=1)
```

---

## 最佳实践

### 1. 纹理准备

**建议的纹理大小**
- **宽度**: 128-512像素（沿线条方向）
- **高度**: 16-128像素（垂直于线条）
- **格式**: PNG/WebP（支持透明度）

**纹理设计原则**
- 纹理应该是可平铺的（左右边界能无缝连接）
- 避免过于复杂的图案，否则高度不够时会显示混乱
- 考虑线条宽度与纹理细节的比例

### 2. 参数调整

**线条厚度设置**

```typescript
// 当前代码中使用固定厚度 = 2像素
const thickness = 2

// 可根据需求调整
// - 较细的线条（如路径）: 2-4像素
// - 中等宽度（如道路）: 4-8像素
// - 宽线条（如河流）: 8-16像素
```

**简化精度设置**

```typescript
// RDP算法的epsilon值，越小越精细
const epsilon = 1.0  // 当前值：1像素精度

// 调整建议
// - epsilon = 0.5: 保留更多细节，点数增加
// - epsilon = 1.0: 当前设置，良好平衡
// - epsilon = 2.0: 更激进的简化，性能更好
```

### 3. 性能优化建议

**顶点数量控制**

```typescript
// 原始点数过多会导致性能问题
// 确保RDP简化有效
const simplifiedPoints = rdpSimplify(rawPoints, 1.0)

// 监控生成的网格大小
console.log(`
  原始点数: ${rawPoints.length}
  简化后点数: ${simplifiedPoints.length}
  压缩率: ${(1 - simplifiedPoints.length/rawPoints.length)*100}%
  网格顶点数: ${simplifiedPoints.length * 2}
  网格索引数: ${(simplifiedPoints.length - 1) * 6}
`)
```

**GPU上传优化**

```typescript
// 使用TypedArray避免性能损耗
const vertices = new Float32Array(mesh.vertices)
const uvs = new Float32Array(mesh.uvs)
const indices = new Uint16Array(mesh.indices)

// 如果顶点数超过65535，使用Uint32Array
if (mesh.vertices.length / 2 > 65535) {
  const indices32 = new Uint32Array(mesh.indices)
  // 使用Uint32Array上传
}
```

### 4. 调试技巧

**可视化UV坐标**

```glsl
// 片元着色器
varying vec2 v_texCoord;

void main() {
  // 直接显示UV坐标作为颜色（调试用）
  gl_FragColor = vec4(v_texCoord, 0.0, 1.0);
  // 红色梯度表示U方向（左到右）
  // 绿色梯度表示V方向（下到上）
}
```

**检查Mesh完整性**

```typescript
function validateMesh(mesh: LineMesh) {
  const pointCount = mesh.vertices.length / 2
  const uvCount = mesh.uvs.length / 2
  const expectedIndices = (pointCount - 1) * 6  // 开放线条

  console.assert(
    pointCount === uvCount,
    '顶点数和UV数不匹配'
  )
  console.assert(
    mesh.indices.length === expectedIndices || mesh.indices.length === pointCount * 6,
    '索引数量不正确'
  )
  console.assert(
    mesh.uvs.every(v => v >= 0 && v <= 1),
    'UV坐标超出[0,1]范围'
  )
}
```

### 5. 导出注意事项

**JSON序列化**

```typescript
// 保存为可读的JSON
const jsonData = {
  meshes: mapData.meshes.map(mesh => ({
    vertexCount: mesh.vertices.length / 2,
    triangleCount: mesh.indices.length / 3,
    data: {
      vertices: mesh.vertices,
      uvs: mesh.uvs,
      indices: mesh.indices
    }
  }))
}

// 保存为二进制以减小文件大小
const arrayBuffer = new ArrayBuffer(
  mesh.vertices.length * 4 +  // Float32
  mesh.uvs.length * 4 +       // Float32
  mesh.indices.length * 2      // Uint16
)
// ... 复制数据到buffer
```

---

## 总结

### UV生成的要点

| 方面 | 说明 |
|------|------|
| **算法类型** | 样条线展开（Spline Unwrapping） |
| **U坐标** | 沿线条方向，基于累计距离 |
| **V坐标** | 垂直于线条，固定0（左）和1（右） |
| **法线计算** | 使用Miter Join平滑处理转角 |
| **性能** | O(n)时间复杂度，n为路径点数 |
| **精度** | 像素级（RDP epsilon=1.0） |

### Mesh使用的关键点

1. **渲染**: 直接与WebGL和Cocos集成
2. **纹理**: 使用标准[0,1]范围的UV坐标
3. **碰撞**: 使用SimplifiedLine中的polygons
4. **导出**: JSON格式便于跨平台使用
5. **优化**: 注意顶点数量和GPU内存使用

---

## 参考代码位置

| 功能 | 文件位置 |
|------|---------|
| UV生成核心 | `src/App.tsx:221-349` |
| Mesh生成 | `src/App.tsx:352-357` |
| 类型定义 | `src/types/map-data.d.ts` |
| RDP简化 | `src/App.tsx:47-98` |
| 线条追踪 | `src/App.tsx:544-686` |
| WebGL着色器 | `src/App.tsx:360-450` |

