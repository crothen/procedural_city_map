import type { Point, Node, Edge, Block, GenerationParams } from "./types";
import {
  calculatePolygonArea,
  calculateCentroid,
  shrinkPolygon,
  pointInPolygon,
  getBoundingBox,
  getOBB,
  validatePolygon,
} from "./geometry";
import { WaterGenerator } from "./WaterGenerator";

export interface Plot extends Block {
  roadIds: string[]; // IDs of roads defining the frontage
  type: "URBAN_CORE" | "SUBURBAN_STRIP";
  halfEdges: string[]; // "u->v" keys
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

    // 4. Fill Gaps
    this.fillGaps();
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

    // Raycast to Water
    if (this.waterGenerator.isPointInWater(calculateCentroid(points))) return;

    // Filter "Outer World" (usually huge) and tiny noise
    // Check absolute area to be safe against winding
    if (Math.abs(area) > mapArea * 0.8 || Math.abs(area) < 50) return;

    // The loop is typically CW (Right-hand rule). shrinkPolygon assumes CCW?
    // If shrinkPolygon expects CCW, CW input makes it GROW.
    // Let's reverse to CCW before shrinking.
    const ccwPoints = [...points].reverse();
    if (this.waterGenerator.isPointInWater(calculateCentroid(ccwPoints))) return;

    // Shrink by 2.0m.
    // This creates the "Downtown" sidewalk.
    const shrunk = shrinkPolygon(ccwPoints, 2.0);
    if (shrunk.length < 3) return;

    // Check area AFTER shrink to ensure it didn't invert or vanish
    // (Also use Abs area just in case)
    const finalArea = Math.abs(calculatePolygonArea(shrunk));
    if (finalArea < 50) return; // Too small after shrink

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
      area: finalArea,
      roadIds: edgeIds,
      type: "URBAN_CORE",
      halfEdges: keys,
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

    // Strategy: Try the Full Chain. If it fails, try just the Current Segment (u->v).
    // This ensures that one bad intersection doesn't kill the whole street.
    if (this.generateAndAddPlot(chain.nodeIds, chain.edgeIds, depth, visitedStrokes)) {
      return;
    }

    // Fallback: Try just this single segment
    // We construct a mini-chain of just [u, v]
    const singleSegmentNodeIds = [u, v];
    const segmentEdge = this.getEdgeBetween(u, v);
    const singleSegmentEdgeIds = segmentEdge ? [segmentEdge.id] : [];

    this.generateAndAddPlot(singleSegmentNodeIds, singleSegmentEdgeIds, depth, visitedStrokes);
  }

  private generateAndAddPlot(
    nodeIds: string[],
    edgeIds: string[],
    depth: number,
    visitedStrokes: Set<string>
  ): boolean {
    const shrinkSteps = [1.0, 0.75, 0.5];

    // GAP STRATEGY:
    // This leaves a 1.0m "Safety Gap" between them.
    const gap = 3.0;

    for (const scale of shrinkSteps) {
      const currentDepth = depth * scale;

      let poly = this.extrudeChain(nodeIds, gap, currentDepth);
      poly = this.simplifyPolygon(poly, 1.0);

      // Fix winding (CW -> CCW) so isValidPlot shrink works correctly
      poly.reverse();

      // Check dimensions before expensive validation
      // Prevent "Narrow but Deep" slivers
      const obb = getOBB(poly);
      // Min width 8m (approx 25ft) to be useful
      if (obb.width < 8.0) continue;

      if (this.isValidPlot(poly)) {
        this.plots.push({
          id: `plot_strip_${this.plotIdCounter++}`,
          points: poly,
          isEnclosed: false,
          area: Math.abs(calculatePolygonArea(poly)),
          roadIds: edgeIds,
          type: "SUBURBAN_STRIP",
          halfEdges: this.generateChainKeys(nodeIds),
        });

        // Mark half-edges as occupied AND Visited
        for (let i = 0; i < nodeIds.length - 1; i++) {
          const key = `${nodeIds[i]}->${nodeIds[i + 1]}`;
          this.occupiedHalfEdges.add(key);
          visitedStrokes.add(key);
        }
        return true; // Success
      }
    }
    return false;
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

    if (calculatePolygonArea(poly) < 50) return false;

    // Strict overlap check (shrink by 0.5m).
    // Previously 1.5m was too loose, allowing corners to overlap.
    const testPoly = shrinkPolygon(poly, 0.5);
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
  clearLots() {
    // lots array was removed by user, so this is no-op or should be removed.
  }

  // ==================== CLEANUP LOGIC ====================

  private generateChainKeys(nodeIds: string[]): string[] {
    const keys: string[] = [];
    for (let i = 0; i < nodeIds.length - 1; i++) {
      keys.push(`${nodeIds[i]}->${nodeIds[i + 1]}`);
    }
    return keys;
  }

  rebuildOccupancy() {
    this.occupiedHalfEdges.clear();
    for (const plot of this.plots) {
      if (plot.halfEdges) {
        plot.halfEdges.forEach(k => this.occupiedHalfEdges.add(k));
      }
    }
  }

  cleanupPlots(customValidator?: (plot: Plot) => boolean): boolean {
    const initialCount = this.plots.length;

    this.plots = this.plots.filter(plot => {
      // Common checks for all plots
      if (plot.area < this.params.minBuildingArea) return false;

      // OBB Width Check (Sliver detection)
      const obb = getOBB(plot.points);
      if (obb.width < this.params.minEdgeLength) return false;

      // Enclosed plots (Downtown) check
      if (plot.isEnclosed) {
        // Angle check
        const res = validatePolygon(plot.points, this.params.minBuildingArea, 999999, 1, this.params.minAngle);
        if (!res.valid) return false;
      }
      // Strip plots are already filtered by Area/Width above

      // Custom Validator (e.g. Building Viability)
      if (customValidator && !customValidator(plot)) return false;

      return true;
    });

    const removed = initialCount > this.plots.length;
    if (removed) {
      this.rebuildOccupancy();
    }
    return removed;
  }

  findEmptyRoadLoops(): string[] {
    const nodeAngles = this.buildNodeAngleMap();
    const visited = new Set<string>();
    const edgesToRemove: string[] = [];

    // Check all potentially empty regions
    for (const edge of this.edges) {
      if (this.bridgeEdgeIds.has(edge.id)) continue;

      for (const [u, v] of [[edge.startNodeId, edge.endNodeId], [edge.endNodeId, edge.startNodeId]]) {
        const key = `${u}->${v}`;
        if (visited.has(key)) continue;

        // If this half-edge is part of a VALID plot, it's not starting an empty loop.
        // HOWEVER, the loop *might* be on the other side? 
        // Logic: We want to find a Face where NONE of its bounding half-edges are occupied.

        // Trace the face
        const result = this.traceFace(u, v, nodeAngles, visited);

        if (result && result.nodes.length > 2) {
          result.keys.forEach(k => visited.add(k)); // Mark all as visited so we don't check this loop again

          // Check if ANY edge in this loop is occupied
          const isOccupied = result.keys.some(k => this.occupiedHalfEdges.has(k));

          if (!isOccupied) {
            // EMPTY LOOP FOUND!
            // Find the longest edge to break the loop
            let longestEdgeId = "";
            let maxLen = -1;

            for (const eid of result.edges) {
              const e = this.edges.find(ed => ed.id === eid);
              if (e) {
                const n1 = this.nodes.get(e.startNodeId);
                const n2 = this.nodes.get(e.endNodeId);
                if (n1 && n2) {
                  const len = Math.hypot(n1.x - n2.x, n1.y - n2.y);
                  if (len > maxLen) {
                    maxLen = len;
                    longestEdgeId = eid;
                  }
                }
              }
            }

            if (longestEdgeId) {
              edgesToRemove.push(longestEdgeId);
            }
          }
        }
      }
    }
    return edgesToRemove;
  }

  private fillGaps() {
    const visitedStrokes = new Set<string>();

    for (const edge of this.edges) {
      if (this.bridgeEdgeIds.has(edge.id)) continue;

      const u = edge.startNodeId;
      const v = edge.endNodeId;

      const fwd = `${u}->${v}`;
      const bwd = `${v}->${u}`;

      const fwdOcc = this.occupiedHalfEdges.has(fwd);
      const bwdOcc = this.occupiedHalfEdges.has(bwd);

      // Check if nodes are "Active" (connected to an occupied road)
      // This ensures we continue streets even if there's a gap
      const uActive = this.isNodeActive(u, v);
      const vActive = this.isNodeActive(v, u);

      // Forward Gap?
      if (!fwdOcc) {
        // Condition: Opposite is occupied, OR we are connected to an existing street
        if (bwdOcc || uActive || vActive) {
          this.attemptStroke(
            u,
            v,
            30, // Shallower depth for infill
            visitedStrokes
          );
        }
      }

      // Backward Gap?
      if (!bwdOcc) {
        if (fwdOcc || uActive || vActive) {
          this.attemptStroke(
            v,
            u,
            30, // Shallower depth for infill
            visitedStrokes
          );
        }
      }
    }
  }

  private isNodeActive(nodeId: string, excludeNodeId: string): boolean {
    const node = this.nodes.get(nodeId);
    if (!node) return false;

    for (const neighborId of node.connections) {
      if (neighborId === excludeNodeId) continue;

      // Check if the road connecting to neighbor is occupied on EITHER side
      if (
        this.occupiedHalfEdges.has(`${nodeId}->${neighborId}`) ||
        this.occupiedHalfEdges.has(`${neighborId}->${nodeId}`)
      ) {
        return true;
      }
    }
    return false;
  }
}
