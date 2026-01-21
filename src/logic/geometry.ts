import type { Point } from './types';

/**
 * Ray-casting algorithm to check if point is inside polygon.
 */
export function pointInPolygon(point: Point, polygon: Point[]): boolean {
    let inside = false;
    const n = polygon.length;

    for (let i = 0, j = n - 1; i < n; j = i++) {
        const xi = polygon[i].x, yi = polygon[i].y;
        const xj = polygon[j].x, yj = polygon[j].y;

        if (((yi > point.y) !== (yj > point.y)) &&
            (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi)) {
            inside = !inside;
        }
    }

    return inside;
}

/**
 * Calculate distance from point to line segment.
 */
export function pointToSegmentDistance(point: Point, p1: Point, p2: Point): number {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const lengthSq = dx * dx + dy * dy;

    if (lengthSq === 0) {
        // Segment is a point
        return Math.sqrt((point.x - p1.x) ** 2 + (point.y - p1.y) ** 2);
    }

    // Project point onto line, clamped to segment
    let t = ((point.x - p1.x) * dx + (point.y - p1.y) * dy) / lengthSq;
    t = Math.max(0, Math.min(1, t));

    const projX = p1.x + t * dx;
    const projY = p1.y + t * dy;

    return Math.sqrt((point.x - projX) ** 2 + (point.y - projY) ** 2);
}

/**
 * Calculate polygon area using shoelace formula.
 */
export function calculatePolygonArea(polygon: Point[]): number {
    if (polygon.length < 3) return 0;

    let area = 0;
    const n = polygon.length;
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        area += polygon[i].x * polygon[j].y;
        area -= polygon[j].x * polygon[i].y;
    }
    return Math.abs(area / 2);
}

/**
 * Calculate centroid of a polygon.
 */
export function calculateCentroid(polygon: Point[]): Point {
    if (polygon.length === 0) return { x: 0, y: 0 };

    let cx = 0, cy = 0;
    for (const p of polygon) {
        cx += p.x;
        cy += p.y;
    }
    return { x: cx / polygon.length, y: cy / polygon.length };
}

/**
 * Catmull-Rom spline interpolation.
 */
export function catmullRom(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
    const t2 = t * t;
    const t3 = t2 * t;

    const x = 0.5 * (
        (2 * p1.x) +
        (-p0.x + p2.x) * t +
        (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
        (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3
    );

    const y = 0.5 * (
        (2 * p1.y) +
        (-p0.y + p2.y) * t +
        (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
        (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3
    );

    return { x, y };
}

/**
 * Find intersection of two lines (not segments - extends infinitely).
 */
export function lineLineIntersection(p1: Point, p2: Point, p3: Point, p4: Point): Point | null {
    const d1x = p2.x - p1.x;
    const d1y = p2.y - p1.y;
    const d2x = p4.x - p3.x;
    const d2y = p4.y - p3.y;

    const cross = d1x * d2y - d1y * d2x;
    if (Math.abs(cross) < 0.0001) return null; // Parallel

    const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / cross;

    return {
        x: p1.x + t * d1x,
        y: p1.y + t * d1y
    };
}

/**
 * Shrink a polygon inward by a given distance.
 * Simple offset algorithm - moves each edge inward.
 */
export function shrinkPolygon(polygon: Point[], distance: number): Point[] {
    if (polygon.length < 3) return [];

    const n = polygon.length;

    // Determine polygon orientation using signed area
    // Positive = counter-clockwise, Negative = clockwise
    let signedArea = 0;
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        signedArea += polygon[i].x * polygon[j].y;
        signedArea -= polygon[j].x * polygon[i].y;
    }
    // If counter-clockwise, flip the normal direction
    const normalSign = signedArea > 0 ? -1 : 1;

    const offsetEdges: { p1: Point; p2: Point }[] = [];

    // Calculate offset edges
    for (let i = 0; i < n; i++) {
        const p1 = polygon[i];
        const p2 = polygon[(i + 1) % n];

        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len < 0.001) continue;

        // Normal pointing inward (adjusted for polygon orientation)
        const nx = (dy / len) * normalSign;
        const ny = (-dx / len) * normalSign;

        offsetEdges.push({
            p1: { x: p1.x + nx * distance, y: p1.y + ny * distance },
            p2: { x: p2.x + nx * distance, y: p2.y + ny * distance }
        });
    }

    if (offsetEdges.length < 3) return [];

    // Find intersections of consecutive offset edges
    const result: Point[] = [];
    const maxOffsetDistance = distance * 5; // Limit how far points can move

    for (let i = 0; i < offsetEdges.length; i++) {
        const e1 = offsetEdges[i];
        const e2 = offsetEdges[(i + 1) % offsetEdges.length];
        const originalCorner = polygon[(i + 1) % n];

        const intersection = lineLineIntersection(e1.p1, e1.p2, e2.p1, e2.p2);
        if (intersection) {
            // Check if intersection is too far from original corner (spike prevention)
            const distFromOriginal = Math.hypot(
                intersection.x - originalCorner.x,
                intersection.y - originalCorner.y
            );
            if (distFromOriginal > maxOffsetDistance) {
                // Spike detected - use a clamped position instead
                const dx = intersection.x - originalCorner.x;
                const dy = intersection.y - originalCorner.y;
                const scale = maxOffsetDistance / distFromOriginal;
                result.push({
                    x: originalCorner.x + dx * scale,
                    y: originalCorner.y + dy * scale
                });
            } else {
                result.push(intersection);
            }
        }
    }

    // Validate result - check for self-intersection or collapsed polygon
    if (result.length < 3) return [];
    const resultArea = calculatePolygonArea(result);
    if (resultArea < 50) return []; // Too small

    return result;
}

/**
 * Split a polygon into two using a plane (defined by point and normal).
 */
export function splitPolygon(poly: Point[], planePt: Point, planeNorm: Point): [Point[], Point[]] {
    const front: Point[] = [];
    const back: Point[] = [];

    for (let i = 0; i < poly.length; i++) {
        const curr = poly[i];
        const next = poly[(i + 1) % poly.length];

        // Dot product determines which side of the line
        const d1 = (curr.x - planePt.x) * planeNorm.x + (curr.y - planePt.y) * planeNorm.y;
        const d2 = (next.x - planePt.x) * planeNorm.x + (next.y - planePt.y) * planeNorm.y;

        if (d1 >= 0) front.push(curr);
        if (d1 < 0) back.push(curr);

        // If signs differ, calculate intersection point
        if ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) {
            const t = d1 / (d1 - d2);
            const intersect = {
                x: curr.x + t * (next.x - curr.x),
                y: curr.y + t * (next.y - curr.y)
            };
            front.push(intersect);
            back.push(intersect);
        }
    }

    return [front, back];
}

/**
 * Get bounding box of a polygon.
 */
export function getBoundingBox(points: Point[]): { minX: number; minY: number; maxX: number; maxY: number } {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of points) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
    }
    return { minX, minY, maxX, maxY };
}

/**
 * Calculate Oriented Bounding Box by finding longest edge alignment.
 */
export function getOBB(poly: Point[]): { length: number; width: number; axis: Point; center: Point } {
    let longestDist = 0;
    let axis = { x: 1, y: 0 };

    // Find longest edge to use as alignment axis
    for (let i = 0; i < poly.length; i++) {
        const p1 = poly[i];
        const p2 = poly[(i + 1) % poly.length];
        const d = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        if (d > longestDist) {
            longestDist = d;
            axis = { x: (p2.x - p1.x) / d, y: (p2.y - p1.y) / d };
        }
    }

    // Project all points onto axis (length) and perpendicular (width)
    const perp = { x: -axis.y, y: axis.x };
    let minLen = Infinity, maxLen = -Infinity;
    let minWid = Infinity, maxWid = -Infinity;

    for (const p of poly) {
        const projLen = p.x * axis.x + p.y * axis.y;
        const projWid = p.x * perp.x + p.y * perp.y;
        minLen = Math.min(minLen, projLen);
        maxLen = Math.max(maxLen, projLen);
        minWid = Math.min(minWid, projWid);
        maxWid = Math.max(maxWid, projWid);
    }

    return {
        length: maxLen - minLen,
        width: maxWid - minWid,
        axis: axis,
        center: {
            x: axis.x * ((minLen + maxLen) / 2) + perp.x * ((minWid + maxWid) / 2),
            y: axis.y * ((minLen + maxLen) / 2) + perp.y * ((minWid + maxWid) / 2)
        }
    };
}

/**
 * Douglas-Peucker line simplification algorithm.
 */
export function douglasPeucker(points: Point[], tolerance: number): Point[] {
    if (points.length <= 2) return points;

    // Find the point with maximum distance from line between first and last
    let maxDist = 0;
    let maxIndex = 0;
    const first = points[0];
    const last = points[points.length - 1];

    for (let i = 1; i < points.length - 1; i++) {
        const dist = perpendicularDistance(points[i], first, last);
        if (dist > maxDist) {
            maxDist = dist;
            maxIndex = i;
        }
    }

    // If max distance is greater than tolerance, recursively simplify
    if (maxDist > tolerance) {
        const left = douglasPeucker(points.slice(0, maxIndex + 1), tolerance);
        const right = douglasPeucker(points.slice(maxIndex), tolerance);

        // Combine results (remove duplicate point at junction)
        return [...left.slice(0, -1), ...right];
    } else {
        // All points between first and last can be removed
        return [first, last];
    }
}

/**
 * Calculate perpendicular distance from point to line.
 */
export function perpendicularDistance(point: Point, lineStart: Point, lineEnd: Point): number {
    const dx = lineEnd.x - lineStart.x;
    const dy = lineEnd.y - lineStart.y;
    const lineLengthSq = dx * dx + dy * dy;

    if (lineLengthSq === 0) {
        return Math.hypot(point.x - lineStart.x, point.y - lineStart.y);
    }

    const t = Math.max(0, Math.min(1,
        ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) / lineLengthSq
    ));

    const projX = lineStart.x + t * dx;
    const projY = lineStart.y + t * dy;

    return Math.hypot(point.x - projX, point.y - projY);
}

/**
 * Get the minimum edge length of a polygon.
 */
export function getMinEdgeLength(poly: Point[]): number {
    if (poly.length < 2) return 0;
    let minLen = Infinity;
    for (let i = 0; i < poly.length; i++) {
        const p1 = poly[i];
        const p2 = poly[(i + 1) % poly.length];
        const len = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        if (len < minLen) minLen = len;
    }
    return minLen;
}

/**
 * Get the minimum interior angle of a polygon in degrees.
 */
export function getMinInteriorAngle(poly: Point[]): number {
    if (poly.length < 3) return 0;
    let minAngle = 180;

    for (let i = 0; i < poly.length; i++) {
        const prev = poly[(i - 1 + poly.length) % poly.length];
        const curr = poly[i];
        const next = poly[(i + 1) % poly.length];

        // Vectors from current point to neighbors
        const v1x = prev.x - curr.x;
        const v1y = prev.y - curr.y;
        const v2x = next.x - curr.x;
        const v2y = next.y - curr.y;

        const len1 = Math.hypot(v1x, v1y);
        const len2 = Math.hypot(v2x, v2y);

        if (len1 < 0.001 || len2 < 0.001) continue;

        // Dot product gives cosine of angle
        const dot = (v1x * v2x + v1y * v2y) / (len1 * len2);
        const angle = Math.acos(Math.max(-1, Math.min(1, dot))) * (180 / Math.PI);

        if (angle < minAngle) minAngle = angle;
    }

    return minAngle;
}

/**
 * Validate a polygon against constraints.
 */
export function validatePolygon(
    poly: Point[],
    minArea: number,
    maxArea: number,
    minEdgeLength: number,
    minAngle: number
): { valid: boolean; area: number; minEdge: number; minAngleFound: number } {
    if (!poly || poly.length < 3) {
        return { valid: false, area: 0, minEdge: 0, minAngleFound: 0 };
    }

    const area = calculatePolygonArea(poly);
    const minEdge = getMinEdgeLength(poly);
    const minAngleFound = getMinInteriorAngle(poly);

    const valid =
        area >= minArea &&
        area <= maxArea &&
        minEdge >= minEdgeLength &&
        minAngleFound >= minAngle;

    return { valid, area, minEdge, minAngleFound };
}
