import type {
  Point,
  Node,
  Edge,
  Block,
  Building,
  GenerationParams,
} from "./types";
import {
  calculateCentroid,
  splitPolygon,
  getOBB,
  getBoundingBox,
  calculatePolygonArea,
  pointInPolygon,
} from "./geometry";
import type { Plot } from "./PlotGenerator";

export class BuildingGenerator {
  buildings: Building[] = [];
  courtyards: Building[] = [];
  lastStepBuildingIds: Set<string> = new Set();

  private buildingIdCounter = 0;
  private buildingGrid: Map<string, Building[]> = new Map();
  private readonly buildingGridSize = 50;

  private buildingGenState: {
    active: boolean;
    currentBlockIndex: number;
  } | null = null;

  private params: GenerationParams;
  private nodes: Map<string, Node>;
  private edges: Edge[];
  private blocks: Plot[];

  constructor(
    params: GenerationParams,
    nodes: Map<string, Node>,
    edges: Edge[],
    blocks: Block[]
  ) {
    this.params = params;
    this.nodes = nodes;
    this.edges = edges;
    this.blocks = blocks as Plot[];
  }

  updateParams(params: GenerationParams) {
    this.params = params;
  }

  updateRefs(nodes: Map<string, Node>, edges: Edge[], blocks: Block[]) {
    this.nodes = nodes;
    this.edges = edges;
    this.blocks = blocks as Plot[];
  }

  startGeneration() {
    if (this.blocks.length === 0) return;
    this.reset();
    this.buildingGenState = { active: true, currentBlockIndex: 0 };
  }

  reset() {
    this.buildings = [];
    this.courtyards = [];
    this.buildingIdCounter = 0;
    this.lastStepBuildingIds.clear();
    this.buildingGrid.clear();
    this.buildingGenState = null;
  }

  clearBuildings() {
    this.reset();
  }

  isGenerationActive() {
    return this.buildingGenState?.active ?? false;
  }

  stepGeneration(): boolean {
    if (!this.buildingGenState?.active) return false;
    this.lastStepBuildingIds.clear();

    // Process smaller batch to prevent frame drops
    for (let i = 0; i < 3; i++) {
      if (this.buildingGenState.currentBlockIndex >= this.blocks.length) {
        this.buildingGenState.active = false;
        break;
      }
      this.fillBlock(this.blocks[this.buildingGenState.currentBlockIndex++]);
    }
    return this.buildingGenState.active;
  }

  private fillBlock(plot: Plot) {
    if (!plot.points || plot.points.length < 3) return;

    // 1. Identify Road Edges for this specific plot
    // We do this first so subdivision can align to them
    const roadSegments: { p1: Point; p2: Point; id: string }[] = [];
    const roadIds = plot.roadIds || [];

    for (const id of roadIds) {
      const e = this.edges.find((ed) => ed.id === id);
      if (e) {
        const p1 = this.nodes.get(e.startNodeId);
        const p2 = this.nodes.get(e.endNodeId);
        if (p1 && p2) roadSegments.push({ p1, p2, id: e.id });
      }
    }

    // 2. Road-Aligned Subdivision
    const lots: Point[][] = [];
    this.smartSubdivide(plot.points, roadSegments, lots, 0);

    // 3. Process Lots
    for (const lot of lots) {
      if (calculatePolygonArea(lot) < this.params.minBuildingArea / 2) continue;

      const touching = this.getTouchingSegments(lot, roadSegments, 3.0);

      if (touching.length > 0) {
        // Determine logic based on frontage
        // If touching multiple different road IDs, it's a corner or through-lot
        const uniqueRoads = new Set(touching.map((t) => t.id)).size;
        const isCornerOrThrough = uniqueRoads > 1;

        let buildingPoly = lot;
        let scraps: Point[][] = [];

        // Only trim depth if not a through-lot that is relatively shallow
        // This prevents cutting a valid "V" or "L" shape into two landlocked pieces
        const shouldTrim =
          this.params.fixedBuildingDepth > 0 &&
          (!isCornerOrThrough ||
            calculatePolygonArea(lot) > this.params.maxBuildingArea);

        if (shouldTrim) {
          const res = this.trimBuilding(
            lot,
            touching,
            this.params.fixedBuildingDepth
          );
          buildingPoly = res.building;
          scraps = res.scraps;
        }

        // SIMPLIFICATION PASS (User Request 1)
        buildingPoly = this.simplifyShape(buildingPoly, 2.0); // 2px tolerance

        if (calculatePolygonArea(buildingPoly) > this.params.minBuildingArea) {
          this.addBuilding(buildingPoly, true);
        }

        // Handle large scraps (e.g., backyard houses)
        scraps.forEach((s) => {
          const simpleS = this.simplifyShape(s, 2.0);
          if (calculatePolygonArea(simpleS) > this.params.minBuildingArea) {
            // Only add scrap if it has access or we allow back-lots
            this.addBuilding(simpleS, false); // Add as courtyard/open space
          }
        });
      } else {
        // Landlocked / Inner Courtyard
        if (plot.isEnclosed) {
          this.addBuilding(lot, false);
        }
      }
    }
  }

  /**
   * Smart Subdivision: Aligns splits to road normals
   */
  private smartSubdivide(
    poly: Point[],
    roads: { p1: Point; p2: Point }[],
    results: Point[][],
    depth: number
  ) {
    if (depth > 10) {
      results.push(poly);
      return;
    }

    const area = calculatePolygonArea(poly);
    const obb = getOBB(poly);

    // Stop if small enough
    if (area < this.params.maxBuildingArea * 1.5) {
      results.push(poly);
      return;
    }

    // 1. Find dominant adjacent road edge
    // We want to split PERPENDICULAR to the road to create row houses
    let bestEdge = null;
    let minDist = Infinity;
    const polyCenter = obb.center;

    for (const r of roads) {
      const d = this.distToSegment(polyCenter, r.p1, r.p2);
      if (d < minDist) {
        minDist = d;
        bestEdge = r;
      }
    }

    let splitAxis = obb.axis; // Default to OBB logic
    let splitPoint = obb.center;

    // 2. If close to a road, force alignment
    if (bestEdge && minDist < Math.max(obb.width, obb.length)) {
      const dx = bestEdge.p2.x - bestEdge.p1.x;
      const dy = bestEdge.p2.y - bestEdge.p1.y;
      const len = Math.hypot(dx, dy);

      // Road Vector
      const rx = dx / len;
      const ry = dy / len;

      // We want to cut across the road frontage -> Cut Normal = Road Vector
      splitAxis = { x: rx, y: ry };
    } else {
      // If landlocked, split along shortest OBB axis to make it squarer
      if (obb.length > obb.width) {
        // Cut perpendicular to length
        splitAxis = { x: obb.axis.x, y: obb.axis.y };
      } else {
        splitAxis = { x: -obb.axis.y, y: obb.axis.x };
      }
    }

    // Add irregularity
    const irregularity = this.params.buildingIrregularity;
    const offset = (Math.random() - 0.5) * (obb.length * 0.2 * irregularity);

    splitPoint = {
      x: obb.center.x + splitAxis.x * offset,
      y: obb.center.y + splitAxis.y * offset,
    };

    const [p1, p2] = splitPolygon(poly, splitPoint, splitAxis);

    // Recursion
    // Check if children are valid (not too sliver-like)
    if (p1.length > 2 && calculatePolygonArea(p1) > 10)
      this.smartSubdivide(p1, roads, results, depth + 1);
    if (p2.length > 2 && calculatePolygonArea(p2) > 10)
      this.smartSubdivide(p2, roads, results, depth + 1);
  }

  /**
   * Simplifies a polygon shape by removing vertices that don't add much detail,
   * creating "cleaner" buildings with fewer edges.
   */
  private simplifyShape(poly: Point[], tolerance: number): Point[] {
    if (poly.length <= 3) return poly;

    const result: Point[] = [poly[0]];
    let prevIndex = 0;

    for (let i = 1; i < poly.length; i++) {
      const p1 = poly[prevIndex];
      const p2 = poly[i];
      const next = poly[(i + 1) % poly.length];

      // Check distance of p2 from line p1-next
      // If p2 is essentially collinear or very close to the line, skip it
      const d = this.distToLine(p2, p1, next);

      // Also keep corner if angle is sharp (approx 90 deg)
      // But for this use case, distance metric is usually sufficient for "wobble" removal
      if (d > tolerance) {
        result.push(p2);
        prevIndex = i;
      }
    }

    // Ensure polygon is closed and valid
    if (result.length < 3) return poly; // Fallback if we simplified too much
    return result;
  }

  private distToLine(p: Point, v: Point, w: Point) {
    const l2 = (v.x - w.x) ** 2 + (v.y - w.y) ** 2;
    if (l2 == 0) return Math.hypot(p.x - v.x, p.y - v.y);
    // Projection t where p falls on line defined by v,w (infinite line, not segment)
    const t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
    const projX = v.x + t * (w.x - v.x);
    const projY = v.y + t * (w.y - v.y);
    return Math.hypot(p.x - projX, p.y - projY);
  }

  private trimBuilding(
    poly: Point[],
    segments: { p1: Point; p2: Point }[],
    depth: number
  ) {
    let current = poly;
    const scraps: Point[][] = [];

    // Sort segments by proximity to ensure we trim from closest road first
    const center = calculateCentroid(poly);
    segments.sort(
      (a, b) =>
        this.distToSegment(center, a.p1, a.p2) -
        this.distToSegment(center, b.p1, b.p2)
    );

    for (const seg of segments) {
      if (current.length < 3) break;

      // Calculate normal pointing INTO the block
      const dx = seg.p2.x - seg.p1.x;
      const dy = seg.p2.y - seg.p1.y;
      const len = Math.hypot(dx, dy) || 1;
      let nx = -dy / len;
      let ny = dx / len;

      // Ensure normal points towards polygon center
      const mid = {
        x: (seg.p1.x + seg.p2.x) / 2,
        y: (seg.p1.y + seg.p2.y) / 2,
      };
      const polyC = calculateCentroid(current);
      const vecToC = { x: polyC.x - mid.x, y: polyC.y - mid.y };
      if (nx * vecToC.x + ny * vecToC.y < 0) {
        nx = -nx;
        ny = -ny;
      }

      // Define cut line at 'depth' distance
      const cutPt = { x: mid.x + nx * depth, y: mid.y + ny * depth };


      const [front, back] = splitPolygon(current, cutPt, { x: nx, y: ny }); // Split along road normal? No, split parallel to road

      // Actually splitPolygon splits by a Plane defined by Point and Normal.
      // If we want to trim depth, the split Plane normal is the direction we move into the lot (nx, ny)
      // Wait, splitPolygon usually takes (Poly, PointOnPlane, PlaneNormal).
      // If we want a line parallel to the road, the Normal of that cut-line is (nx, ny).

      // Determine which piece is the building.
      // "Back" is usually the one further along the normal.

      // Heuristic: The piece closer to the road is the "Setback" area if we were doing setbacks.
      // But here we are doing "Building Depth". So we want to KEEP the piece closer to road.

      const distF = this.distToSegment(
        calculateCentroid(front),
        seg.p1,
        seg.p2
      );
      const distB = this.distToSegment(calculateCentroid(back), seg.p1, seg.p2);

      // We want the piece closest to road
      if (distF < distB) {
        current = front;
        if (back.length > 2) scraps.push(back);
      } else {
        current = back;
        if (front.length > 2) scraps.push(front);
      }
    }
    return { building: current, scraps };
  }

  private getTouchingSegments(
    lot: Point[],
    segments: { p1: Point; p2: Point; id: string }[],
    tol: number
  ) {
    const bb = getBoundingBox(lot);
    return segments.filter((s) => {
      if (Math.min(s.p1.x, s.p2.x) > bb.maxX + tol) return false;
      if (Math.max(s.p1.x, s.p2.x) < bb.minX - tol) return false;
      if (Math.min(s.p1.y, s.p2.y) > bb.maxY + tol) return false;
      if (Math.max(s.p1.y, s.p2.y) < bb.minY - tol) return false;

      for (const p of lot) {
        if (this.distToSegment(p, s.p1, s.p2) < tol) return true;
      }
      return false;
    });
  }

  private distToSegment(p: Point, v: Point, w: Point) {
    const l2 = (v.x - w.x) ** 2 + (v.y - w.y) ** 2;
    if (l2 == 0) return Math.hypot(p.x - v.x, p.y - v.y);
    const t = Math.max(
      0,
      Math.min(1, ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2)
    );
    return Math.hypot(
      p.x - (v.x + t * (w.x - v.x)),
      p.y - (v.y + t * (w.y - v.y))
    );
  }

  private addBuilding(points: Point[], isBuilding: boolean) {
    // STRICT OVERLAP CHECK
    if (isBuilding && this.checkCollision(points)) return;

    const b: Building = {
      id: (isBuilding ? "b_" : "c_") + this.buildingIdCounter++,
      points: points,
      centroid: calculateCentroid(points),
    };
    if (isBuilding) {
      this.buildings.push(b);
      this.addBuildingToGrid(b);
    } else this.courtyards.push(b);
    this.lastStepBuildingIds.add(b.id);
  }

  // Check if a polygon overlaps with any existing building
  private checkCollision(poly: Point[]): boolean {
    const bb = getBoundingBox(poly);
    const minX = Math.floor(bb.minX / this.buildingGridSize);
    const maxX = Math.floor(bb.maxX / this.buildingGridSize);
    const minY = Math.floor(bb.minY / this.buildingGridSize);
    const maxY = Math.floor(bb.maxY / this.buildingGridSize);

    // Shrink polygon slightly for collision test to allow touching edges
    // Simple approach: verify centroids or point-in-poly
    // Accurate approach: Separating Axis Theorem (SAT) or simple Edge intersection
    // For performance, we'll check if any vertex of the new poly is inside an old one
    // and vice versa.

    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        const key = `${x},${y}`;
        const neighbors = this.buildingGrid.get(key);
        if (!neighbors) continue;

        for (const neighbor of neighbors) {
          // Quick AABB check
          const nbb = getBoundingBox(neighbor.points);
          if (
            bb.minX > nbb.maxX ||
            bb.maxX < nbb.minX ||
            bb.minY > nbb.maxY ||
            bb.maxY < nbb.minY
          )
            continue;

          // Detailed Check: Are any points of poly inside neighbor?
          // (Note: This doesn't catch pure "crossing" shapes like a + sign,
          // but for generated lots, checking vertices is usually enough)
          for (const p of poly) {
            if (pointInPolygon(p, neighbor.points)) return true;
          }
          for (const p of neighbor.points) {
            if (pointInPolygon(p, poly)) return true;
          }
        }
      }
    }
    return false;
  }

  private addBuildingToGrid(b: Building) {
    const bb = getBoundingBox(b.points);
    const minX = Math.floor(bb.minX / this.buildingGridSize),
      maxX = Math.floor(bb.maxX / this.buildingGridSize);
    const minY = Math.floor(bb.minY / this.buildingGridSize),
      maxY = Math.floor(bb.maxY / this.buildingGridSize);
    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        const k = `${x},${y}`;
        if (!this.buildingGrid.has(k)) this.buildingGrid.set(k, []);
        this.buildingGrid.get(k)!.push(b);
      }
    }
  }
}
