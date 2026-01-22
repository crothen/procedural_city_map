import type { Point, WaterBody, GenerationParams } from "./types";
import { pointInPolygon, catmullRom } from "./geometry";

class SimpleNoise {
  private perm: number[] = [];
  constructor(seed: number = Math.random()) {
    for (let i = 0; i < 256; i++) this.perm[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor((seed * (i + 1) * 374.2) % (i + 1));
      [this.perm[i], this.perm[j]] = [this.perm[j], this.perm[i]];
    }
    this.perm = [...this.perm, ...this.perm];
  }
  get(x: number): number {
    const X = Math.floor(x) & 255;
    const xf = x - Math.floor(x);
    const u = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
    const lerp = (t: number, a: number, b: number) => a + t * (b - a);
    const grad = (h: number, x: number) => ((h & 1) === 0 ? x : -x);
    return lerp(u(xf), grad(this.perm[X], xf), grad(this.perm[X + 1], xf - 1));
  }
  fbm(x: number, octaves: number): number {
    let t = 0,
      a = 1,
      f = 1,
      max = 0;
    for (let i = 0; i < octaves; i++) {
      t += this.get(x * f) * a;
      max += a;
      a *= 0.5;
      f *= 2.0;
    }
    return t / max;
  }
}

export class WaterGenerator {
  waterBodies: WaterBody[] = [];
  private params: GenerationParams;
  private noise: SimpleNoise;
  private mainRiverSpine: Point[] = []; // Store for collision checks

  constructor(params: GenerationParams) {
    this.params = params;
    this.noise = new SimpleNoise();
  }

  updateParams(params: GenerationParams) {
    this.params = params;
    this.noise = new SimpleNoise(Math.random());
  }

  reset() {
    this.waterBodies = [];
    this.mainRiverSpine = [];
    this.noise = new SimpleNoise(Math.random());
  }

  isPointInWater(point: Point): boolean {
    for (const water of this.waterBodies) {
      if (pointInPolygon(point, water.points)) return true;
    }
    return false;
  }

  generate() {
    const { waterFeature } = this.params;
    if (waterFeature === "NONE") return;

    this.noise = new SimpleNoise(Math.random());

    if (waterFeature === "RIVER") {
      this.generateRiver();
    } else if (waterFeature === "COAST") {
      this.generateCoast();
      if (Math.random() < 0.5) this.generateRiverIntoWater();
    } else if (waterFeature === "LAKE") {
      this.generateLake();
      if (Math.random() < 0.6) this.generateRiverIntoWater();
    }
  }

  // ========================================================================
  // ROBUST RIVER GENERATION
  // ========================================================================

  private generateRiver() {
    const { width, height, riverWidth } = this.params;
    const mainWidth = riverWidth * (0.8 + Math.random() * 0.4);

    const horizontal = Math.random() > 0.5;
    let start: Point, end: Point;
    // Padding: -150 ensures the start/end is well off-screen
    const pad = -150;

    if (horizontal) {
      const startY = height * (0.2 + Math.random() * 0.6);
      const endY = height * (0.2 + Math.random() * 0.6);
      if (Math.random() > 0.5) {
        start = { x: pad, y: startY };
        end = { x: width - pad, y: endY };
      } else {
        start = { x: width - pad, y: startY };
        end = { x: pad, y: endY };
      }
    } else {
      const startX = width * (0.2 + Math.random() * 0.6);
      const endX = width * (0.2 + Math.random() * 0.6);
      if (Math.random() > 0.5) {
        start = { x: startX, y: pad };
        end = { x: endX, y: height - pad };
      } else {
        start = { x: startX, y: height - pad };
        end = { x: endX, y: pad };
      }
    }

    // Generate Main Spine
    let spine = this.generateNaturalPath(start, end, 15);
    spine = this.resamplePolyline(spine, 10); // 10px spacing for efficiency
    spine = this.smoothPoints(spine, 4);
    this.mainRiverSpine = spine;

    // Generate Geometry
    this.createBraidedRiver(spine, mainWidth);

    // Tributaries
    const numTribs = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < numTribs; i++) {
      this.addNaturalTributary(spine, mainWidth);
    }
  }

  private generateRiverIntoWater() {
    const { width, height, riverWidth } = this.params;
    if (this.waterBodies.length === 0) return;

    const targetWater = this.waterBodies[0];
    const targetIdx = Math.floor(Math.random() * targetWater.points.length);
    const endPoint = targetWater.points[targetIdx];
    const center = this.getPolygonCentroid(targetWater.points);

    const startPoint = this.getFurthestMapEdge(endPoint, width, height);

    const dx = center.x - endPoint.x;
    const dy = center.y - endPoint.y;
    const len = Math.hypot(dx, dy) || 1;
    const adjustedEnd = {
      x: endPoint.x + (dx / len) * 100, // Push deep into water
      y: endPoint.y + (dy / len) * 100,
    };

    let spine = this.generateNaturalPath(startPoint, adjustedEnd, 15);
    spine = this.resamplePolyline(spine, 10);
    spine = this.smoothPoints(spine, 3);
    this.mainRiverSpine = spine;

    this.createBraidedRiver(spine, riverWidth);
  }

  private createBraidedRiver(spine: Point[], baseWidth: number) {
    const n = spine.length;
    const splitChance = n > 50 ? 0.4 : 0;

    if (Math.random() > splitChance) {
      this.waterBodies.push({
        type: "RIVER",
        points: this.extrudePolyline(spine, baseWidth),
      });
      return;
    }

    const margin = Math.floor(n * 0.2);
    const duration = Math.floor(n * 0.3);
    const startIdx =
      margin + Math.floor(Math.random() * (n - margin * 2 - duration));
    const endIdx = startIdx + duration;

    const leftBranchSpine: Point[] = [];
    const rightBranchSpine: Point[] = [];

    for (let i = 0; i < n; i++) {
      const p = spine[i];
      if (i >= startIdx && i <= endIdx) {
        const t = (i - startIdx) / duration;
        const swell = Math.sin(t * Math.PI) * (baseWidth * 1.5);

        const next = spine[Math.min(n - 1, i + 1)];
        const prev = spine[Math.max(0, i - 1)];
        let nx = -(next.y - prev.y);
        let ny = next.x - prev.x;
        const l = Math.hypot(nx, ny) || 1;
        nx /= l;
        ny /= l;

        leftBranchSpine.push({ x: p.x + nx * swell, y: p.y + ny * swell });
        rightBranchSpine.push({ x: p.x - nx * swell, y: p.y - ny * swell });
      } else {
        leftBranchSpine.push(p);
        rightBranchSpine.push(p);
      }
    }

    const widthPerBranch = baseWidth * 0.6;
    this.waterBodies.push({
      type: "RIVER",
      points: this.extrudePolyline(
        this.smoothPoints(leftBranchSpine, 3),
        widthPerBranch
      ),
    });
    this.waterBodies.push({
      type: "RIVER",
      points: this.extrudePolyline(
        this.smoothPoints(rightBranchSpine, 3),
        widthPerBranch
      ),
    });
  }

  private extrudePolyline(line: Point[], baseWidth: number): Point[] {
    const left: Point[] = [];
    const right: Point[] = [];
    const n = line.length;

    // 1. Calculate Widths
    let widths: number[] = [];
    for (let i = 0; i < n; i++) {
      const noise = this.noise.fbm(i * 0.05, 2);
      const w = baseWidth * (1.0 + noise * 0.5);
      widths.push(w);
    }
    widths = this.smoothArray(widths, 4);

    // 2. Extrude
    for (let i = 0; i < n; i++) {
      const p = line[i];

      // Smoothing window for normals
      const w = 2;
      const pPrev = line[Math.max(0, i - w)];
      const pNext = line[Math.min(n - 1, i + w)];

      let dx = pNext.x - pPrev.x;
      let dy = pNext.y - pPrev.y;
      let len = Math.hypot(dx, dy) || 1;

      let nx = -dy / len;
      let ny = dx / len;

      const half = widths[i] / 2;
      left.push({ x: p.x + nx * half, y: p.y + ny * half });
      right.push({ x: p.x - nx * half, y: p.y - ny * half });
    }

    // **CRITICAL FIX**: Do NOT clamp points here. Allow them to go off-screen.
    // This solves the "visible endings" issue.
    return [...left, ...right.reverse()];
  }

  // --- Path Generation ---

  private generateNaturalPath(
    start: Point,
    end: Point,
    segments: number
  ): Point[] {
    const points: Point[] = [];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const dist = Math.hypot(dx, dy);
    const nx = -dy / dist;
    const ny = dx / dist;

    const seed = Math.random() * 1000;
    const amp = dist * 0.2;

    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const bx = start.x + dx * t;
      const by = start.y + dy * t;

      const envelope = Math.sin(t * Math.PI);
      const noise = this.noise.fbm(t * 3 + seed, 2);

      const offset = noise * amp * envelope;
      points.push({ x: bx + nx * offset, y: by + ny * offset });
    }

    return this.interpolateCurve(points, 4);
  }

  private addNaturalTributary(parentSpine: Point[], parentWidth: number) {
    if (parentSpine.length < 20) return;

    // Try up to 3 times to find a valid non-crossing path
    for (let attempt = 0; attempt < 3; attempt++) {
      const idx = Math.floor(parentSpine.length * (0.2 + Math.random() * 0.6));
      const joinPt = parentSpine[idx];

      const prev = parentSpine[Math.max(0, idx - 5)];
      const next = parentSpine[Math.min(parentSpine.length - 1, idx + 5)];
      const ang = Math.atan2(next.y - prev.y, next.x - prev.x);

      const side = Math.random() > 0.5 ? 1 : -1;
      const rayAng = ang + (Math.PI / 2) * side + (Math.random() - 0.5) * 0.6; // +/- 30 deg spread

      const startPt = this.findEdgeIntersection(joinPt, rayAng);
      if (!startPt) continue;

      // Generate path
      let spine = this.generateTributaryPath(startPt, joinPt, 15);

      // **COLLISION CHECK**: Does this new spine cross the main river?
      if (this.spinesIntersect(spine, this.mainRiverSpine)) {
        continue; // Try again
      }

      spine = this.resamplePolyline(spine, 5);
      spine = this.smoothPoints(spine, 3);

      this.waterBodies.push({
        type: "RIVER",
        points: this.extrudePolyline(spine, parentWidth * 0.4),
      });
      break; // Success
    }
  }

  /**
   * Specialized path generator for tributaries.
   * Damps noise to ZERO at the end to force a straight entry.
   */
  private generateTributaryPath(
    start: Point,
    end: Point,
    segments: number
  ): Point[] {
    const points: Point[] = [];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const dist = Math.hypot(dx, dy);
    const nx = -dy / dist;
    const ny = dx / dist;
    const seed = Math.random() * 1000;

    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const bx = start.x + dx * t;
      const by = start.y + dy * t;

      // Envelope: 0 at start, peak in middle, 0 at end
      // PLUS: Force 0 for the last 15% (t > 0.85) to ensure straight entry
      let envelope = Math.sin(t * Math.PI);
      if (t > 0.85) envelope = 0;
      else if (t > 0.7) envelope *= (0.85 - t) / 0.15; // Fade out quickly

      const noise = this.noise.fbm(t * 4 + seed, 2);
      const offset = noise * (dist * 0.15) * envelope;

      points.push({ x: bx + nx * offset, y: by + ny * offset });
    }
    return points;
  }

  // --- Helpers ---

  private spinesIntersect(spineA: Point[], spineB: Point[]): boolean {
    // Simple bounding box check first could be added here for perf
    // Detailed check:
    // Skip last few segments of A because they are DESIGNED to touch B
    const limitA = spineA.length - 5;

    for (let i = 0; i < limitA; i++) {
      for (let j = 0; j < spineB.length - 1; j++) {
        if (
          this.getLineIntersection(
            spineA[i],
            spineA[i + 1],
            spineB[j],
            spineB[j + 1]
          )
        )
          return true;
      }
    }
    return false;
  }

  private getLineIntersection(
    p0: Point,
    p1: Point,
    p2: Point,
    p3: Point
  ): boolean {
    const s1_x = p1.x - p0.x;
    const s1_y = p1.y - p0.y;
    const s2_x = p3.x - p2.x;
    const s2_y = p3.y - p2.y;
    const d = -s2_x * s1_y + s1_x * s2_y;
    if (Math.abs(d) < 0.001) return false;
    const s = (-s1_y * (p0.x - p2.x) + s1_x * (p0.y - p2.y)) / d;
    const t = (s2_x * (p0.y - p2.y) - s2_y * (p0.x - p2.x)) / d;
    return s >= 0 && s <= 1 && t >= 0 && t <= 1;
  }

  private resamplePolyline(points: Point[], segmentLength: number): Point[] {
    if (points.length < 2) return points;
    const newPoints: Point[] = [points[0]];
    let distSoFar = 0;
    for (let i = 1; i < points.length; i++) {
      const p1 = points[i - 1];
      const p2 = points[i];
      const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      let currentDist = distSoFar + dist;
      while (currentDist >= segmentLength) {
        const overflow = currentDist - segmentLength;
        const t = 1 - overflow / dist;
        newPoints.push({
          x: p1.x + (p2.x - p1.x) * t,
          y: p1.y + (p2.y - p1.y) * t,
        });
        currentDist -= segmentLength;
        distSoFar = -overflow;
      }
      distSoFar = currentDist;
    }
    newPoints.push(points[points.length - 1]);
    return newPoints;
  }

  private smoothPoints(points: Point[], passes: number): Point[] {
    let current = points;
    for (let p = 0; p < passes; p++) {
      const next = [current[0]];
      for (let i = 1; i < current.length - 1; i++) {
        next.push({
          x: (current[i - 1].x + current[i].x + current[i + 1].x) / 3,
          y: (current[i - 1].y + current[i].y + current[i + 1].y) / 3,
        });
      }
      next.push(current[current.length - 1]);
      current = next;
    }
    return current;
  }

  private smoothArray(arr: number[], passes: number): number[] {
    let current = [...arr];
    for (let p = 0; p < passes; p++) {
      const next = [current[0]];
      for (let i = 1; i < current.length - 1; i++) {
        next.push((current[i - 1] + current[i] + current[i + 1]) / 3);
      }
      next.push(current[current.length - 1]);
      current = next;
    }
    return current;
  }

  private interpolateCurve(points: Point[], segments: number): Point[] {
    if (points.length < 2) return points;
    const result: Point[] = [points[0]];
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[Math.max(0, i - 1)];
      const p1 = points[i];
      const p2 = points[Math.min(points.length - 1, i + 1)];
      const p3 = points[Math.min(points.length - 1, i + 2)];
      for (let j = 1; j <= segments; j++) {
        result.push(catmullRom(p0, p1, p2, p3, j / segments));
      }
    }
    return result;
  }

  private findEdgeIntersection(origin: Point, angle: number): Point | null {
    const { width, height } = this.params;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) return null;
    let minT = Infinity;
    if (dx > 0) minT = Math.min(minT, (width - origin.x) / dx);
    if (dx < 0) minT = Math.min(minT, (0 - origin.x) / dx);
    if (dy > 0) minT = Math.min(minT, (height - origin.y) / dy);
    if (dy < 0) minT = Math.min(minT, (0 - origin.y) / dy);
    if (minT === Infinity || minT < 0) return null;
    const pad = 150; // Push well outside map
    return { x: origin.x + (minT + pad) * dx, y: origin.y + (minT + pad) * dy };
  }

  private getPolygonCentroid(pts: Point[]): Point {
    let x = 0,
      y = 0;
    pts.forEach((p) => {
      x += p.x;
      y += p.y;
    });
    return { x: x / pts.length, y: y / pts.length };
  }

  private getFurthestMapEdge(target: Point, w: number, h: number): Point {
    const dL = target.x,
      dR = w - target.x,
      dT = target.y,
      dB = h - target.y;
    const max = Math.max(dL, dR, dT, dB);
    const pad = -150;
    if (max === dL) return { x: pad, y: Math.random() * h };
    if (max === dR) return { x: w - pad, y: Math.random() * h };
    if (max === dT) return { x: Math.random() * w, y: pad };
    return { x: Math.random() * w, y: h - pad };
  }

  distanceToWater(point: Point): number {
    let min = Infinity;
    for (const w of this.waterBodies) {
      for (let i = 0; i < w.points.length; i++) {
        const p1 = w.points[i];
        const p2 = w.points[(i + 1) % w.points.length];
        min = Math.min(min, this.pToSeg(point, p1, p2));
      }
    }
    return min;
  }

  private pToSeg(p: Point, a: Point, b: Point): number {
    const dx = b.x - a.x,
      dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    if (l2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
    let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
  }

  private generateCoast() {
    const { width, height } = this.params;
    const side = Math.floor(Math.random() * 4);
    const pts: Point[] = [];
    const num = 25;
    for (let i = 0; i <= num; i++) {
      const t = i / num;
      if (side === 0) pts.push({ x: 0, y: height * t });
      else if (side === 1) pts.push({ x: width, y: height * t });
      else if (side === 2) pts.push({ x: width * t, y: 0 });
      else pts.push({ x: width * t, y: height });
    }
    const displaced: Point[] = [];
    const disp = Math.min(width, height) * 0.2;
    if (side === 0) displaced.push({ x: 0, y: 0 });
    else if (side === 1) displaced.push({ x: width, y: 0 });
    else if (side === 2) displaced.push({ x: 0, y: 0 });
    else displaced.push({ x: 0, y: height });
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const t = i / pts.length;
      const n = this.noise.fbm(t * 6, 3);
      const env = Math.sin(t * Math.PI);
      const d = disp * env * (0.4 + n);
      let nx = 0,
        ny = 0;
      if (side === 0) nx = 1;
      else if (side === 1) nx = -1;
      else if (side === 2) ny = 1;
      else ny = -1;
      displaced.push({ x: p.x + nx * d, y: p.y + ny * d });
    }
    if (side === 0) displaced.push({ x: 0, y: height });
    else if (side === 1) displaced.push({ x: width, y: height });
    else if (side === 2) displaced.push({ x: width, y: 0 });
    else displaced.push({ x: width, y: height });
    this.waterBodies.push({
      type: "COAST",
      points: this.interpolateCurve(displaced, 3),
    });
  }

  private generateLake() {
    const { width, height } = this.params;
    const cx = width * (0.3 + Math.random() * 0.4),
      cy = height * (0.3 + Math.random() * 0.4);
    const rad = Math.min(width, height) * 0.15;
    const pts: Point[] = [];
    const steps = 30;
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const n = this.noise.fbm(Math.cos(a) + Math.sin(a) + Math.random(), 3);
      const r = rad * (0.8 + n * 0.5);
      pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
    }
    pts.push(pts[0]);
    this.waterBodies.push({
      type: "LAKE",
      points: this.interpolateCurve(pts, 3),
    });
  }
}
