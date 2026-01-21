import type { Point, Node, Edge, Block, GenerationParams } from "./types";
import {
  calculatePolygonArea,
  calculateCentroid,
  shrinkPolygon,
  pointInPolygon,
  getBoundingBox,
  getOBB,
} from "./geometry";
import { WaterGenerator } from "./WaterGenerator";

// Rename Block to Plot for clarity, but keep compatibility
export interface Plot extends Block {
  roadIds: string[]; // IDs of roads defining the frontage
  type: "URBAN_CORE" | "SUBURBAN_STRIP";
}

export class PlotGenerator {
  plots: Plot[] = [];
  showPlots: boolean = true;

  private plotIdCounter = 0;

  // Tracks which "sides" of roads are occupied.
  // Key format: "u->v" means the Left side of the road from u to v is occupied.
  private occupiedHalfEdges: Set<string> = new Set();

  private params: GenerationParams;
  private waterGenerator: WaterGenerator;
  private nodes: Map<string, Node>;
  private edges: Edge[];
  private bridgeEdgeIds: Set<string>;
  private cityCenter: Point;

  constructor(
    params: GenerationParams,
    waterGenerator: WaterGenerator,
    nodes: Map<string, Node>,
    edges: Edge[],
    bridgeEdgeIds: Set<string>,
    cityCenter: Point
  ) {
    this.params = params;
    this.waterGenerator = waterGenerator;
    this.nodes = nodes;
    this.edges = edges;
    this.bridgeEdgeIds = bridgeEdgeIds;
    this.cityCenter = cityCenter;
  }

  updateRefs(
    nodes: Map<string, Node>,
    edges: Edge[],
    bridgeEdgeIds: Set<string>,
    cityCenter: Point
  ) {
    this.nodes = nodes;
    this.edges = edges;
    this.bridgeEdgeIds = bridgeEdgeIds;
    this.cityCenter = cityCenter;
  }

  updateParams(params: GenerationParams) {
    this.params = params;
  }

  reset() {
    this.plots = [];
    this.plotIdCounter = 0;
    this.occupiedHalfEdges.clear();
  }

  generate() {
    this.reset();
    if (this.nodes.size < 2 || this.edges.length < 1) return;

    // 1. Detect Enclosed Plots (Downtown / Urban Core)
    this.detectEnclosedPlots();

    // 2. Generate Strip Plots (Suburbs)
    this.generateFilamentPlots();

    // 3. Sort (Center Outward)
    this.plots.sort((a, b) => {
      const cA = calculateCentroid(a.points);
      const cB = calculateCentroid(b.points);
      const dA = Math.hypot(cA.x - this.cityCenter.x, cA.y - this.cityCenter.y);
      const dB = Math.hypot(cB.x - this.cityCenter.x, cB.y - this.cityCenter.y);
      return dA - dB;
    });
  }

  get blocks() {
    return this.plots;
  }

  // ==================================================================================
  // 1. ENCLOSED PLOTS (Downtown Loops)
  // ==================================================================================

  private detectEnclosedPlots() {
    const nodeAngles = this.buildNodeAngleMap();
    const visited = new Set<string>();

    for (const edge of this.edges) {
      if (this.bridgeEdgeIds.has(edge.id)) continue;

      // Check Left side of u->v AND Left side of v->u
      for (const [u, v] of [
        [edge.startNodeId, edge.endNodeId],
        [edge.endNodeId, edge.startNodeId],
      ]) {
        const key = `${u}->${v}`;
        if (visited.has(key)) continue;

        const result = this.traceFace(u, v, nodeAngles, visited);

        if (result && result.nodes.length > 2) {
          this.createEnclosedPlot(result.nodes, result.edges, result.keys);
        }
      }
    }
  }

  private traceFace(
    startNode: string,
    secondNode: string,
    nodeAngles: Map<string, any[]>,
    visited: Set<string>
  ) {
    const pathNodes = [startNode];
    const pathEdges: string[] = [];
    const pathKeys: string[] = [];

    let curr = secondNode;
    let prev = startNode;

    const firstE = this.getEdgeBetween(prev, curr);
    if (firstE) pathEdges.push(firstE.id);

    let steps = 0;
    while (curr !== startNode && steps < 1000) {
      pathNodes.push(curr);
      const key = `${prev}->${curr}`;
      pathKeys.push(key);

      if (visited.has(key)) return null;

      const neighbors = nodeAngles.get(curr);
      if (!neighbors || neighbors.length === 0) return null;

      const pNode = this.nodes.get(prev)!;
      const cNode = this.nodes.get(curr)!;
      const angleIn = Math.atan2(pNode.y - cNode.y, pNode.x - cNode.x);

      let nextIdx = neighbors.findIndex((n: any) => n.angle > angleIn + 1e-4);
      if (nextIdx === -1) nextIdx = 0;

      const nextId = neighbors[nextIdx].id;
      const e = this.getEdgeBetween(curr, nextId);

      if (!e || this.bridgeEdgeIds.has(e.id)) return null;
      if (nextId === prev) return null;

      pathEdges.push(e.id);
      prev = curr;
      curr = nextId;
      steps++;
    }

    if (curr === startNode) {
      pathKeys.push(`${prev}->${curr}`);
      return { nodes: pathNodes, edges: pathEdges, keys: pathKeys };
    }
    return null;
  }

  private createEnclosedPlot(
    nodeIds: string[],
    edgeIds: string[],
    keys: string[]
  ) {
    let points = nodeIds.map((id) => this.nodes.get(id)!);
    const area = calculatePolygonArea(points);
    const mapArea = this.params.width * this.params.height;

    // Filter "Outer World" (usually huge) and tiny noise
    if (area > mapArea * 0.8 || area < 50) return;
    if (this.waterGenerator.isPointInWater(calculateCentroid(points))) return;

    // Shrink slightly for sidewalk
    const shrunk = shrinkPolygon(points, 2);
    if (shrunk.length < 3) return;

    // Simplify shape (User Request: Simpler shapes, less edges)
    const simple = this.simplifyPolygon(shrunk, 3.0);

    // Register as occupied ONLY if valid
    keys.forEach((k) => {
      this.occupiedHalfEdges.add(k);
    });

    this.plots.push({
      id: `plot_core_${this.plotIdCounter++}`,
      points: simple,
      isEnclosed: true,
      area: calculatePolygonArea(simple),
      roadIds: edgeIds,
      type: "URBAN_CORE",
    });
  }

  // ==================================================================================
  // 2. FILAMENT PLOTS (Continuous Strips)
  // ==================================================================================

  private generateFilamentPlots() {
    const baseDepth =
      this.params.fixedBuildingDepth > 0
        ? this.params.fixedBuildingDepth + 15
        : 50;
    const gap = 2;
    const processed = new Set<string>();

    // Sort edges by distance to center to build inner city outwards
    const sortedEdges = [...this.edges].sort((a, b) => {
      const nA = this.nodes.get(a.startNodeId)!;
      const nB = this.nodes.get(b.startNodeId)!;
      const dA = Math.hypot(nA.x - this.cityCenter.x, nA.y - this.cityCenter.y);
      const dB = Math.hypot(nB.x - this.cityCenter.x, nB.y - this.cityCenter.y);
      return dA - dB;
    });

    for (const edge of sortedEdges) {
      if (this.bridgeEdgeIds.has(edge.id)) continue;
      const u = edge.startNodeId;
      const v = edge.endNodeId;

      // Try Left Side
      this.tryTraceStrip(u, v, gap, baseDepth, processed);
      // Try Right Side (Left of reverse)
      this.tryTraceStrip(v, u, gap, baseDepth, processed);
    }
  }

  private tryTraceStrip(
    startU: string,
    startV: string,
    gap: number,
    depth: number,
    processed: Set<string>
  ) {
    const key = `${startU}->${startV}`;

    // Check global occupancy (set by Enclosed plots) and local processing
    if (this.occupiedHalfEdges.has(key) || processed.has(key)) return;

    // 1. Trace Chain
    const chain = this.buildFilamentChain(startU, startV, processed);
    if (chain.nodeIds.length < 2) return;

    // 2. Extrude (Simplifies linear sections automatically)
    let poly = this.extrudeChain(chain.nodeIds, gap, depth);
    if (!poly || poly.length < 3) return;

    // 3. Collision Handling & Shrinking
    // If full depth hits something, try shrinking depth (70%, then 40%)
    // This allows plots to fit in V-shapes or parallel roads without overlapping
    let validPoly = null;
    const shrinkSteps = [1.0, 0.7, 0.4];

    for (const scale of shrinkSteps) {
      const testPoly =
        scale === 1.0
          ? poly
          : this.extrudeChain(chain.nodeIds, gap, depth * scale);
      // Simplify BEFORE collision check to ensure clean boundaries
      const simplePoly = this.simplifyPolygon(testPoly, 2.0);

      if (this.isValidPlot(simplePoly)) {
        validPoly = simplePoly;
        break;
      }
    }

    if (validPoly) {
      this.plots.push({
        id: `plot_strip_${this.plotIdCounter++}`,
        points: validPoly,
        isEnclosed: false,
        area: calculatePolygonArea(validPoly),
        roadIds: chain.edgeIds,
        type: "SUBURBAN_STRIP",
      });
    }
  }

  private buildFilamentChain(u: string, v: string, processed: Set<string>) {
    const nodeIds = [u, v];
    const edgeIds: string[] = [];

    // Mark initial edge as processed locally
    processed.add(`${u}->${v}`);
    const firstE = this.getEdgeBetween(u, v);
    if (firstE) edgeIds.push(firstE.id);

    let curr = v;
    let prev = u;

    // Look ahead limit
    let steps = 0;
    while (steps < 50) {
      const next = this.findBestContinuation(prev, curr, processed);
      if (!next) break;

      const e = this.getEdgeBetween(curr, next);
      if (e) edgeIds.push(e.id);

      nodeIds.push(next);
      processed.add(`${curr}->${next}`);
      prev = curr;
      curr = next;
      steps++;
    }

    return { nodeIds, edgeIds };
  }

  private findBestContinuation(
    prev: string,
    curr: string,
    visited: Set<string>
  ): string | null {
    const currNode = this.nodes.get(curr);
    const prevNode = this.nodes.get(prev);
    if (!currNode || !prevNode) return null;

    // Strict intersection break: Degree > 2 stops the strip.
    // This prevents strips from wrapping around corners, creating "L" shapes that fail extrusion.
    // It creates cleaner, separate linear plots.
    if (currNode.connections.length > 2) return null;

    const angleIn = Math.atan2(
      currNode.y - prevNode.y,
      currNode.x - prevNode.x
    );

    for (const nextId of currNode.connections) {
      if (nextId === prev) continue;

      // If blocked by Downtown, stop.
      if (this.occupiedHalfEdges.has(`${curr}->${nextId}`)) continue;
      if (visited.has(`${curr}->${nextId}`)) continue;

      const e = this.getEdgeBetween(curr, nextId);
      if (!e || this.bridgeEdgeIds.has(e.id)) continue;

      const nextNode = this.nodes.get(nextId)!;
      const angleOut = Math.atan2(
        nextNode.y - currNode.y,
        nextNode.x - currNode.x
      );

      // Angle check: Must be relatively straight (within ~45 degrees)
      let diff = Math.abs(this.normalizeAngle(angleOut - angleIn));
      if (diff < Math.PI / 4) return nextId;
    }
    return null;
  }

  /**
   * Extrudes a line string into a polygon.
   * Optimizes by merging collinear segments (simpler shapes).
   */
  private extrudeChain(nodeIds: string[], gap: number, depth: number): Point[] {
    const front: Point[] = [];
    const back: Point[] = [];

    if (nodeIds.length < 2) return [];

    for (let i = 0; i < nodeIds.length - 1; i++) {
      const p1 = this.nodes.get(nodeIds[i])!;
      const p2 = this.nodes.get(nodeIds[i + 1])!;

      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;

      // Current Segment Points
      const f1 = { x: p1.x + nx * gap, y: p1.y + ny * gap };
      const f2 = { x: p2.x + nx * gap, y: p2.y + ny * gap };
      const b1 = { x: p1.x + nx * (gap + depth), y: p1.y + ny * (gap + depth) };
      const b2 = { x: p2.x + nx * (gap + depth), y: p2.y + ny * (gap + depth) };

      // Optimization: If this segment is collinear with the previous one,
      // update the last point instead of adding a new one.
      // This reduces vertices on straight roads.
      if (i > 0) {
        front[front.length - 1] = f2;
        back[back.length - 1] = b2;
      } else {
        front.push(f1, f2);
        back.push(b1, b2);
      }
    }

    return [...front, ...back.reverse()];
  }

  // ==================================================================================
  // 3. UTILS & GEOMETRY
  // ==================================================================================

  /**
   * Ramer-Douglas-Peucker simplification.
   * Removes vertices that are within 'epsilon' distance of the line segment connecting their neighbors.
   */
  private simplifyPolygon(points: Point[], epsilon: number): Point[] {
    if (points.length < 3) return points;

    // Find point with max distance from line between start and end
    let maxDist = 0;
    let index = 0;
    const start = points[0];
    const end = points[points.length - 1];

    for (let i = 1; i < points.length - 1; i++) {
      const d = this.perpendicularDistance(points[i], start, end);
      if (d > maxDist) {
        index = i;
        maxDist = d;
      }
    }

    // If max dist > epsilon, recursively simplify
    if (maxDist > epsilon) {
      const left = this.simplifyPolygon(points.slice(0, index + 1), epsilon);
      const right = this.simplifyPolygon(points.slice(index), epsilon);
      return [...left.slice(0, left.length - 1), ...right];
    } else {
      return [start, end];
    }
  }

  private perpendicularDistance(p: Point, v: Point, w: Point) {
    const l2 = (v.x - w.x) ** 2 + (v.y - w.y) ** 2;
    if (l2 === 0) return Math.hypot(p.x - v.x, p.y - v.y);
    const t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
    // Projection falls on infinite line
    const projX = v.x + t * (w.x - v.x);
    const projY = v.y + t * (w.y - v.y);
    return Math.hypot(p.x - projX, p.y - projY);
  }

  private isValidPlot(poly: Point[]): boolean {
    if (poly.length < 3) return false;
    if (calculatePolygonArea(poly) < 100) return false; // Minimum viable plot size
    const c = calculateCentroid(poly);
    if (this.waterGenerator.isPointInWater(c)) return false;

    // Strict Overlap Check against ALL existing plots
    const bb = getBoundingBox(poly);
    for (const other of this.plots) {
      const obb = getBoundingBox(other.points);

      // Fast AABB rejection
      if (
        bb.maxX < obb.minX ||
        bb.minX > obb.maxX ||
        bb.maxY < obb.minY ||
        bb.minY > obb.maxY
      )
        continue;

      // Detailed Polygon Intersection Check
      // We check if any point of the new poly is inside the old one
      for (const p of poly) {
        if (pointInPolygon(p, other.points)) return false;
      }
      // And vice versa (to catch if new poly totally encloses old one)
      for (const p of other.points) {
        if (pointInPolygon(p, poly)) return false;
      }
    }
    return true;
  }

  private buildNodeAngleMap() {
    const map = new Map<string, any[]>();
    for (const [id, node] of this.nodes) {
      const list = node.connections
        .map((nid) => {
          const n = this.nodes.get(nid)!;
          return { id: nid, angle: Math.atan2(n.y - node.y, n.x - node.x) };
        })
        .sort((a, b) => a.angle - b.angle);
      map.set(id, list);
    }
    return map;
  }

  private getEdgeBetween(u: string, v: string) {
    return this.edges.find(
      (e) =>
        (e.startNodeId === u && e.endNodeId === v) ||
        (e.startNodeId === v && e.endNodeId === u)
    );
  }

  private normalizeAngle(a: number) {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  }

  togglePlots() {
    this.showPlots = !this.showPlots;
  }
  clearPlots() {
    this.reset();
  }
}
