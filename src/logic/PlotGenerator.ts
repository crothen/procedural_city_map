import type { Point, Node, Edge, Block, GenerationParams } from "./types";
import {
  calculatePolygonArea,
  calculateCentroid,
  shrinkPolygon,
  pointInPolygon,
  getBoundingBox,
} from "./geometry";
import { WaterGenerator } from "./WaterGenerator";

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

    // 2. Generate Strip Plots (Suburbs / Open Roads)
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

      // Check Left side of u->v AND Left side of v->u independently
      for (const [u, v] of [
        [edge.startNodeId, edge.endNodeId],
        [edge.endNodeId, edge.startNodeId],
      ]) {
        const key = `${u}->${v}`;
        if (visited.has(key)) continue;
        if (this.occupiedHalfEdges.has(key)) continue;

        const result = this.traceFace(u, v, nodeAngles, visited);

        if (result && result.nodes.length > 2) {
          // Mark visited so we don't re-scan this specific loop
          result.keys.forEach((k) => visited.add(k));
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

      // Find next edge in CCW order (Left Turn)
      let nextIdx = neighbors.findIndex((n: any) => n.angle > angleIn + 1e-4);
      if (nextIdx === -1) nextIdx = 0;

      const nextId = neighbors[nextIdx].id;
      const e = this.getEdgeBetween(curr, nextId);

      if (!e || this.bridgeEdgeIds.has(e.id)) return null;
      if (nextId === prev) return null; // Dead end

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

    // Shrink by 2.0m.
    // This creates the "Downtown" sidewalk.
    const shrunk = shrinkPolygon(points, 2.0);
    if (shrunk.length < 3) return;

    // Simplify slightly (1.0m) to clean up edges without bulging into the road
    const simple = this.simplifyPolygon(shrunk, 1.0);

    // Register strictly the INSIDE half-edges as occupied.
    // The opposite half-edges (facing away from the block) remain FREE for strips.
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
  // 2. FILAMENT PLOTS (Strips / Open Roads)
  // ==================================================================================

  private generateFilamentPlots() {
    const baseDepth =
      this.params.fixedBuildingDepth > 0
        ? this.params.fixedBuildingDepth + 15
        : 50;

    const sortedEdges = [...this.edges].sort((a, b) => {
      const nA = this.nodes.get(a.startNodeId)!;
      const nB = this.nodes.get(b.startNodeId)!;
      const dA = Math.hypot(nA.x - this.cityCenter.x, nA.y - this.cityCenter.y);
      const dB = Math.hypot(nB.x - this.cityCenter.x, nB.y - this.cityCenter.y);
      return dA - dB;
    });

    // Track visited strokes to prevent generating the same strip twice
    const visitedStrokes = new Set<string>();

    for (const edge of sortedEdges) {
      if (this.bridgeEdgeIds.has(edge.id)) continue;

      // Try BOTH sides independently.
      // This ensures that even if one side is Downtown, the other side generates.
      this.attemptStroke(
        edge.startNodeId,
        edge.endNodeId,
        baseDepth,
        visitedStrokes
      );
      this.attemptStroke(
        edge.endNodeId,
        edge.startNodeId,
        baseDepth,
        visitedStrokes
      );
    }
  }

  private attemptStroke(
    u: string,
    v: string,
    depth: number,
    visitedStrokes: Set<string>
  ) {
    const key = `${u}->${v}`;

    // 1. If this specific side is occupied by Downtown, we can't build here.
    if (this.occupiedHalfEdges.has(key)) return;

    // 2. If we already generated a strip here, skip.
    if (visitedStrokes.has(key)) return;

    // 3. REWIND: Find the true start of this road chain.
    // This prevents fragmented plots by always starting from an intersection.
    const { start, end } = this.getStrokeStart(u, v);

    // 4. Trace the full continuous chain forward
    const chain = this.traceRoadStroke(start, end);

    // Mark segments as visited immediately so we don't restart here later
    for (let i = 0; i < chain.nodeIds.length - 1; i++) {
      visitedStrokes.add(`${chain.nodeIds[i]}->${chain.nodeIds[i + 1]}`);
    }

    // 5. GENERATE
    const shrinkSteps = [1.0, 0.75, 0.5];

    // GAP STRATEGY:
    // Downtown is at 2.0m. Strip starts at 3.0m.
    // This leaves a 1.0m "Safety Gap" between them, preventing overlap errors.
    const gap = 3.0;

    for (const scale of shrinkSteps) {
      const currentDepth = depth * scale;

      let poly = this.extrudeChain(chain.nodeIds, gap, currentDepth);
      poly = this.simplifyPolygon(poly, 1.0);

      if (this.isValidPlot(poly)) {
        this.plots.push({
          id: `plot_strip_${this.plotIdCounter++}`,
          points: poly,
          isEnclosed: false,
          area: calculatePolygonArea(poly),
          roadIds: chain.edgeIds,
          type: "SUBURBAN_STRIP",
        });

        // Mark half-edges as occupied
        for (let i = 0; i < chain.nodeIds.length - 1; i++) {
          this.occupiedHalfEdges.add(
            `${chain.nodeIds[i]}->${chain.nodeIds[i + 1]}`
          );
        }
        break; // Success
      }
    }
  }

  private getStrokeStart(u: string, v: string): { start: string; end: string } {
    let curr = u;
    let next = v;
    let steps = 0;

    // Backtrack to find intersection or dead end
    while (steps < 50) {
      const prev = this.findBestPredecessor(curr, next);
      if (!prev) break;

      // If the predecessor segment is occupied by Downtown on THIS side, stop rewinding.
      // We start the strip exactly where the downtown block ends.
      if (this.occupiedHalfEdges.has(`${prev}->${curr}`)) break;

      next = curr;
      curr = prev;
      steps++;
    }
    return { start: curr, end: next };
  }

  private traceRoadStroke(u: string, v: string) {
    const nodeIds = [u, v];
    const edgeIds: string[] = [];

    const firstE = this.getEdgeBetween(u, v);
    if (firstE) edgeIds.push(firstE.id);

    let prev = u;
    let curr = v;

    for (let i = 0; i < 40; i++) {
      const next = this.findBestContinuation(prev, curr);
      if (!next) break;

      // Stop if the NEXT segment is occupied
      if (this.occupiedHalfEdges.has(`${curr}->${next}`)) break;

      const e = this.getEdgeBetween(curr, next);
      if (e) edgeIds.push(e.id);

      nodeIds.push(next);
      prev = curr;
      curr = next;
    }
    return { nodeIds, edgeIds };
  }

  private findBestPredecessor(curr: string, next: string): string | null {
    return this.findBestAlignment(next, curr);
  }

  private findBestContinuation(prev: string, curr: string): string | null {
    return this.findBestAlignment(prev, curr);
  }

  private findBestAlignment(p1: string, p2: string): string | null {
    const n1 = this.nodes.get(p1);
    const n2 = this.nodes.get(p2);
    if (!n1 || !n2) return null;

    // Break at intersections (Degree > 2)
    if (n2.connections.length > 2) return null;

    const angleBase = Math.atan2(n2.y - n1.y, n2.x - n1.x);
    let bestNext: string | null = null;
    let minDiff = 1000;

    for (const candId of n2.connections) {
      if (candId === p1) continue;

      const nCand = this.nodes.get(candId)!;
      const angleCand = Math.atan2(nCand.y - n2.y, nCand.x - n2.x);
      const diff = Math.abs(this.normalizeAngle(angleCand - angleBase));

      // 45 degree tolerance allows curves but stops at sharp turns
      if (diff < (45 * Math.PI) / 180) {
        if (diff < minDiff) {
          minDiff = diff;
          bestNext = candId;
        }
      }
    }
    return bestNext;
  }

  // ==================================================================================
  // 3. EXTRUSION & GEOMETRY (Miters)
  // ==================================================================================

  private extrudeChain(nodeIds: string[], gap: number, depth: number): Point[] {
    if (nodeIds.length < 2) return [];

    const points = nodeIds.map((id) => this.nodes.get(id)!);
    const front: Point[] = [];
    const back: Point[] = [];

    for (let i = 0; i < points.length; i++) {
      const curr = points[i];
      const prev = i > 0 ? points[i - 1] : null;
      const next = i < points.length - 1 ? points[i + 1] : null;

      let vIn = { x: 0, y: 0 };
      let vOut = { x: 0, y: 0 };

      if (prev) {
        const dx = curr.x - prev.x;
        const dy = curr.y - prev.y;
        const l = Math.hypot(dx, dy) || 1;
        vIn = { x: dx / l, y: dy / l };
      }
      if (next) {
        const dx = next.x - curr.x;
        const dy = next.y - curr.y;
        const l = Math.hypot(dx, dy) || 1;
        vOut = { x: dx / l, y: dy / l };
      }

      // Miter Calculation (Angle Bisector)
      let miter = { x: 0, y: 0 };
      let scale = 1.0;

      if (!prev) {
        miter = { x: -vOut.y, y: vOut.x };
      } else if (!next) {
        miter = { x: -vIn.y, y: vIn.x };
      } else {
        const sumX = vIn.x + vOut.x;
        const sumY = vIn.y + vOut.y;
        const l = Math.hypot(sumX, sumY);

        if (l < 1e-5) {
          miter = { x: -vIn.y, y: vIn.x };
        } else {
          miter = { x: -sumY / l, y: sumX / l };
          // Ensure orientation is Left
          if (miter.x * -vIn.y + miter.y * vIn.x < 0) {
            miter.x = -miter.x;
            miter.y = -miter.y;
          }
          // Fix corner width
          const dot = miter.x * -vIn.y + miter.y * vIn.x;
          if (dot < 0.2) scale = 2.5;
          else scale = 1.0 / dot;
        }
      }
      scale = Math.min(scale, 2.5); // Cap spikes

      // Jitter
      const seed = Math.sin(curr.x * 12.9898 + curr.y * 78.233) * 43758.5453;
      const jitter = (seed - Math.floor(seed)) * (depth * 0.15);
      const actualDepth = depth + jitter;

      const f = {
        x: curr.x + miter.x * gap * scale,
        y: curr.y + miter.y * gap * scale,
      };
      let b = {
        x: curr.x + miter.x * (gap + actualDepth) * scale,
        y: curr.y + miter.y * (gap + actualDepth) * scale,
      };

      // Raycast to Water
      b = this.adjustToWater(f, b);

      front.push(f);
      back.push(b);
    }

    return [...front, ...back.reverse()];
  }

  private adjustToWater(start: Point, end: Point): Point {
    if (!this.waterGenerator.isPointInWater(end)) return end;
    if (this.waterGenerator.isPointInWater(start)) return start;

    let safe = start;
    let unsafe = end;
    let boundary = start;

    // Binary search for coast
    for (let i = 0; i < 4; i++) {
      const mid = {
        x: (safe.x + unsafe.x) * 0.5,
        y: (safe.y + unsafe.y) * 0.5,
      };
      if (this.waterGenerator.isPointInWater(mid)) {
        unsafe = mid;
      } else {
        safe = mid;
        boundary = mid;
      }
    }
    return boundary;
  }

  // ==================================================================================
  // 4. VALIDATION
  // ==================================================================================

  private isValidPlot(poly: Point[]): boolean {
    if (poly.length < 3) return false;
    if (calculatePolygonArea(poly) < 50) return false;

    // Permissive overlap check (shrink by 1.5m).
    // Strip is at 3.0m. Test poly becomes 4.5m.
    // Downtown is at 2.0m.
    // Gap = 2.5m. Safe.
    const testPoly = shrinkPolygon(poly, 1.5);
    if (testPoly.length < 3) return true;

    const bb = getBoundingBox(testPoly);

    for (const other of this.plots) {
      const obb = getBoundingBox(other.points);

      if (
        bb.maxX < obb.minX ||
        bb.minX > obb.maxX ||
        bb.maxY < obb.minY ||
        bb.minY > obb.maxY
      )
        continue;

      if (this.polygonsIntersect(testPoly, other.points)) return false;
      if (pointInPolygon(testPoly[0], other.points)) return false;
      if (pointInPolygon(other.points[0], testPoly)) return false;
    }
    return true;
  }

  private polygonsIntersect(polyA: Point[], polyB: Point[]): boolean {
    for (let i = 0; i < polyA.length; i++) {
      const a1 = polyA[i];
      const a2 = polyA[(i + 1) % polyA.length];
      for (let j = 0; j < polyB.length; j++) {
        const b1 = polyB[j];
        const b2 = polyB[(j + 1) % polyB.length];
        if (this.segmentsIntersect(a1, a2, b1, b2)) return true;
      }
    }
    return false;
  }

  private segmentsIntersect(
    p1: Point,
    p2: Point,
    p3: Point,
    p4: Point
  ): boolean {
    const ccw = (a: Point, b: Point, c: Point) =>
      (c.y - a.y) * (b.x - a.x) > (b.y - a.y) * (c.x - a.x);
    return (
      ccw(p1, p3, p4) !== ccw(p2, p3, p4) && ccw(p1, p2, p3) !== ccw(p1, p2, p4)
    );
  }

  // ==================================================================================
  // UTILS
  // ==================================================================================

  private simplifyPolygon(points: Point[], epsilon: number): Point[] {
    if (points.length < 3) return points;
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
    const projX = v.x + t * (w.x - v.x);
    const projY = v.y + t * (w.y - v.y);
    return Math.hypot(p.x - projX, p.y - projY);
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
