import type { Point, Node, Edge, Block, GenerationParams } from "./types";
import {
  calculatePolygonArea,
  calculateCentroid,
  shrinkPolygon,
  pointInPolygon,
  getBoundingBox,
} from "./geometry";
import { WaterGenerator } from "./WaterGenerator";

// Rename Block to Plot for clarity, but keep compatibility
export interface Plot extends Block {
  roadIds: string[]; // IDs of roads defining the frontage
  type: "URBAN_CORE" | "SUBURBAN_STRIP";
}

export class PlotGenerator {
  plots: Plot[] = [];
  showPlots: boolean = true; // Renamed from showBlocks

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

  /**
   * Main Generation Function
   */
  generate() {
    this.reset();
    if (this.nodes.size < 2 || this.edges.length < 1) return;

    // 1. Detect Enclosed Plots (Downtown)
    // Finds closed loops and makes the entire inside ONE plot.
    this.detectEnclosedPlots();

    // 2. Generate Strip Plots (Suburbs)
    // Finds continuous road chains and extrudes strips on BOTH sides.
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

  // Getter for compatibility
  get blocks() {
    return this.plots;
  }

  // ==================================================================================
  // 1. ENCLOSED PLOTS (Downtown Loops)
  // ==================================================================================

  private detectEnclosedPlots() {
    const nodeAngles = this.buildNodeAngleMap();
    const visited = new Set<string>();

    // Check every edge in both directions
    for (const edge of this.edges) {
      if (this.bridgeEdgeIds.has(edge.id)) continue;

      // Check Left side of u->v AND Left side of v->u
      for (const [u, v] of [
        [edge.startNodeId, edge.endNodeId],
        [edge.endNodeId, edge.startNodeId],
      ]) {
        const key = `${u}->${v}`;
        if (visited.has(key)) continue;

        // Trace the face on the Left
        const result = this.traceFace(u, v, nodeAngles, visited);

        if (result && result.nodes.length > 2) {
          this.createEnclosedPlot(result.nodes, result.edges);
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
    const pathKeys: string[] = []; // Track "u->v" keys to mark as visited later

    let curr = secondNode;
    let prev = startNode;

    const firstE = this.getEdgeBetween(prev, curr);
    if (firstE) pathEdges.push(firstE.id);

    let steps = 0;
    while (curr !== startNode && steps < 1000) {
      pathNodes.push(curr);
      pathKeys.push(`${prev}->${curr}`);

      // Stop if we hit a visited edge (dead end or internal loop)
      if (visited.has(`${prev}->${curr}`)) return null;

      const neighbors = nodeAngles.get(curr);
      if (!neighbors || neighbors.length === 0) return null;

      // Calculate angle coming IN
      const pNode = this.nodes.get(prev)!;
      const cNode = this.nodes.get(curr)!;
      const angleIn = Math.atan2(pNode.y - cNode.y, pNode.x - cNode.x);

      // Find neighbor with smallest angle > angleIn (Left Turn)
      let nextIdx = neighbors.findIndex((n: any) => n.angle > angleIn + 1e-4);
      if (nextIdx === -1) nextIdx = 0;

      const nextId = neighbors[nextIdx].id;

      // Bridges/Dead ends break cycles
      const e = this.getEdgeBetween(curr, nextId);
      if (!e || this.bridgeEdgeIds.has(e.id)) return null;
      if (nextId === prev) return null; // U-turn

      pathEdges.push(e.id);
      prev = curr;
      curr = nextId;
      steps++;
    }

    if (curr === startNode) {
      // Valid Loop Closed
      pathKeys.push(`${prev}->${curr}`);
      // Mark all these half-edges as visited/occupied
      pathKeys.forEach((k) => {
        visited.add(k);
        this.occupiedHalfEdges.add(k);
      });
      return { nodes: pathNodes, edges: pathEdges };
    }
    return null;
  }

  private createEnclosedPlot(nodeIds: string[], edgeIds: string[]) {
    const points = nodeIds.map((id) => this.nodes.get(id)!);
    const area = calculatePolygonArea(points);

    // Filter "Outer World" (usually huge) and tiny noise
    const mapArea = this.params.width * this.params.height;
    if (area > mapArea * 0.8 || area < 50) return;

    if (this.waterGenerator.isPointInWater(calculateCentroid(points))) return;

    // Shrink slightly for sidewalk
    const shrunk = shrinkPolygon(points, 2);
    if (shrunk.length < 3) return;

    this.plots.push({
      id: `plot_core_${this.plotIdCounter++}`,
      points: shrunk,
      isEnclosed: true, // "Courtyard" candidates
      area: calculatePolygonArea(shrunk),
      roadIds: edgeIds,
      type: "URBAN_CORE",
    });
  }

  // ==================================================================================
  // 2. FILAMENT PLOTS (Continuous Strips)
  // ==================================================================================

  private generateFilamentPlots() {
    const depth =
      this.params.fixedBuildingDepth > 0
        ? this.params.fixedBuildingDepth + 15
        : 50;
    const gap = 2;

    const processed = new Set<string>();

    // Iterate all roads to find open sides
    for (const edge of this.edges) {
      if (this.bridgeEdgeIds.has(edge.id)) continue;

      const u = edge.startNodeId;
      const v = edge.endNodeId;

      // Try Left Side
      this.tryTraceStrip(u, v, gap, depth, processed);
      // Try Right Side (which is Left of Reverse)
      this.tryTraceStrip(v, u, gap, depth, processed);
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

    // Skip if this side is Downtown or already processed
    if (this.occupiedHalfEdges.has(key) || processed.has(key)) return;

    // 1. Trace continuous chain of road segments
    const chain = this.buildFilamentChain(startU, startV, processed);
    if (chain.nodeIds.length < 2) return;

    // 2. Extrude to create "One Big Block"
    const poly = this.extrudeChain(chain.nodeIds, gap, depth);
    if (!poly || poly.length < 3) return;

    // 3. Validate & Add
    if (this.isValidPlot(poly)) {
      this.plots.push({
        id: `plot_strip_${this.plotIdCounter++}`,
        points: poly,
        isEnclosed: false, // "Row House" candidates
        area: calculatePolygonArea(poly),
        roadIds: chain.edgeIds,
        type: "SUBURBAN_STRIP",
      });
    }
  }

  private buildFilamentChain(u: string, v: string, processed: Set<string>) {
    const nodeIds = [u, v];
    const edgeIds: string[] = [];
    const firstE = this.getEdgeBetween(u, v);
    if (firstE) edgeIds.push(firstE.id);

    processed.add(`${u}->${v}`);

    let curr = v;
    let prev = u;

    // Walk Forward until Intersection or Dead End or Occupied
    while (true) {
      const next = this.findBestContinuation(prev, curr, processed);
      if (!next) break;

      const e = this.getEdgeBetween(curr, next);
      if (e) edgeIds.push(e.id);

      nodeIds.push(next);
      processed.add(`${curr}->${next}`);
      prev = curr;
      curr = next;
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

    // CRITICAL: Stop at Intersections (Degree > 2).
    // This ensures clean corners and prevents self-intersecting snake polygons.
    if (currNode.connections.length > 2) return null;

    const angleIn = Math.atan2(
      currNode.y - prevNode.y,
      currNode.x - prevNode.x
    );

    for (const nextId of currNode.connections) {
      if (nextId === prev) continue;

      // If this side is Downtown, the chain stops here
      if (this.occupiedHalfEdges.has(`${curr}->${nextId}`)) continue;
      if (visited.has(`${curr}->${nextId}`)) continue;

      // Bridges break chains
      const e = this.getEdgeBetween(curr, nextId);
      if (!e || this.bridgeEdgeIds.has(e.id)) continue;

      const nextNode = this.nodes.get(nextId)!;
      const angleOut = Math.atan2(
        nextNode.y - currNode.y,
        nextNode.x - currNode.x
      );

      // Only continue if reasonably straight (< 60 deg turn)
      let diff = Math.abs(this.normalizeAngle(angleOut - angleIn));
      if (diff < Math.PI / 3) return nextId;
    }
    return null;
  }

  private extrudeChain(nodeIds: string[], gap: number, depth: number): Point[] {
    const front: Point[] = [];
    const back: Point[] = [];

    for (let i = 0; i < nodeIds.length - 1; i++) {
      const p1 = this.nodes.get(nodeIds[i])!;
      const p2 = this.nodes.get(nodeIds[i + 1])!;

      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const len = Math.hypot(dx, dy) || 1;

      // Normal Left
      const nx = -dy / len;
      const ny = dx / len;

      // We add BOTH start and end points for every segment.
      // This creates a safe "joined" polygon even if the road curves.
      front.push({ x: p1.x + nx * gap, y: p1.y + ny * gap });
      front.push({ x: p2.x + nx * gap, y: p2.y + ny * gap });

      back.push({ x: p1.x + nx * (gap + depth), y: p1.y + ny * (gap + depth) });
      back.push({ x: p2.x + nx * (gap + depth), y: p2.y + ny * (gap + depth) });
    }

    return [...front, ...back.reverse()];
  }

  // ==================================================================================
  // 3. UTILS
  // ==================================================================================

  private isValidPlot(poly: Point[]): boolean {
    if (poly.length < 3) return false;
    if (calculatePolygonArea(poly) < 100) return false;
    const c = calculateCentroid(poly);
    if (this.waterGenerator.isPointInWater(c)) return false;

    // Overlap check against Downtown plots
    const bb = getBoundingBox(poly);
    for (const other of this.plots) {
      if (!other.isEnclosed) continue;
      const obb = getBoundingBox(other.points);
      if (
        bb.maxX < obb.minX ||
        bb.minX > obb.maxX ||
        bb.maxY < obb.minY ||
        bb.minY > obb.maxY
      )
        continue;

      if (pointInPolygon(c, other.points)) return false;
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
