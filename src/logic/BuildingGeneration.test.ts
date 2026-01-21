import { describe, it, expect } from 'vitest';

/**
 * Test that building generation creates NON-RECTANGULAR buildings.
 * Uses the offset polygon algorithm - buildings span between outer and inner boundaries.
 */

interface Point {
    x: number;
    y: number;
}

// Helper: calculate distance between two points
function distance(p1: Point, p2: Point): number {
    return Math.hypot(p2.x - p1.x, p2.y - p1.y);
}

// Helper: check if a quadrilateral is a rectangle
function isRectangle(corners: Point[], tolerance: number = 0.02): boolean {
    if (corners.length !== 4) return false;

    const [p0, p1, p2, p3] = corners;

    // In a rectangle, diagonals are equal
    const diag1 = distance(p0, p2);
    const diag2 = distance(p1, p3);

    // And opposite sides are equal
    const side01 = distance(p0, p1);
    const side23 = distance(p2, p3);
    const side12 = distance(p1, p2);
    const side30 = distance(p3, p0);

    const diagonalsEqual = Math.abs(diag1 - diag2) < tolerance * Math.max(diag1, diag2);
    const oppositeSidesEqual =
        Math.abs(side01 - side23) < tolerance * Math.max(side01, side23) &&
        Math.abs(side12 - side30) < tolerance * Math.max(side12, side30);

    return diagonalsEqual && oppositeSidesEqual;
}

// Offset polygon inward
function getOffsetPolygon(points: Point[], depth: number): Point[] {
    if (depth <= 0) return points.map(p => ({ ...p }));

    const newPoints: Point[] = [];
    const len = points.length;

    for (let i = 0; i < len; i++) {
        const prev = points[(i - 1 + len) % len];
        const curr = points[i];
        const next = points[(i + 1) % len];

        const v1 = { x: curr.x - prev.x, y: curr.y - prev.y };
        const v2 = { x: next.x - curr.x, y: next.y - curr.y };

        const l1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y);
        const l2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y);

        if (l1 < 0.001 || l2 < 0.001) continue;

        const n1 = { x: -v1.y / l1, y: v1.x / l1 };
        const n2 = { x: -v2.y / l2, y: v2.x / l2 };

        const p1_shifted = { x: prev.x + n1.x * depth, y: prev.y + n1.y * depth };
        const p2_shifted = { x: curr.x + n2.x * depth, y: curr.y + n2.y * depth };

        const det = v1.x * v2.y - v1.y * v2.x;

        if (Math.abs(det) < 0.0001) {
            newPoints.push({ x: curr.x + n1.x * depth, y: curr.y + n1.y * depth });
        } else {
            const dx = p2_shifted.x - p1_shifted.x;
            const dy = p2_shifted.y - p1_shifted.y;
            const t = (dx * v2.y - dy * v2.x) / det;

            newPoints.push({
                x: p1_shifted.x + t * v1.x,
                y: p1_shifted.y + t * v1.y
            });
        }
    }
    return newPoints;
}

// Generate buildings between outer and inner polygon
function generateBuildingsFromPolygons(outerPoly: Point[], innerPoly: Point[], buildingWidth: number): Point[][] {
    const buildings: Point[][] = [];
    if (outerPoly.length !== innerPoly.length) return [];

    const len = outerPoly.length;

    for (let i = 0; i < len; i++) {
        const p1_out = outerPoly[i];
        const p2_out = outerPoly[(i + 1) % len];
        const p1_in = innerPoly[i];
        const p2_in = innerPoly[(i + 1) % len];

        const dx = p2_out.x - p1_out.x;
        const dy = p2_out.y - p1_out.y;
        const edgeLen = Math.sqrt(dx * dx + dy * dy);

        if (edgeLen < buildingWidth * 0.5) continue;

        const count = Math.max(1, Math.floor(edgeLen / buildingWidth));

        for (let j = 0; j < count; j++) {
            const t1 = j / count;
            const t2 = (j + 1) / count;

            // Outer edge points
            const out1 = { x: p1_out.x + dx * t1, y: p1_out.y + dy * t1 };
            const out2 = { x: p1_out.x + dx * t2, y: p1_out.y + dy * t2 };

            // Inner edge points (at DIFFERENT positions due to polygon offset)
            const dx_in = p2_in.x - p1_in.x;
            const dy_in = p2_in.y - p1_in.y;
            const in1 = { x: p1_in.x + dx_in * t1, y: p1_in.y + dy_in * t1 };
            const in2 = { x: p1_in.x + dx_in * t2, y: p1_in.y + dy_in * t2 };

            buildings.push([out1, out2, in2, in1]);
        }
    }
    return buildings;
}

// Generate random polygon
function generateRandomPolygon(numSides: number, centerX: number, centerY: number, radius: number): Point[] {
    const points: Point[] = [];
    for (let i = 0; i < numSides; i++) {
        const angle = (i / numSides) * Math.PI * 2;
        const r = radius * (0.7 + Math.random() * 0.6);
        points.push({
            x: centerX + Math.cos(angle) * r,
            y: centerY + Math.sin(angle) * r
        });
    }
    return points;
}

describe('Building Generation (Offset Polygon Algorithm)', () => {
    it('should create non-rectangular buildings due to polygon offset geometry', () => {
        // The offset polygon algorithm naturally creates non-rectangular buildings
        // because the inner polygon vertices move toward corners, changing edge lengths

        const testCases = [
            generateRandomPolygon(4, 100, 100, 50),
            generateRandomPolygon(5, 200, 100, 60),
            generateRandomPolygon(6, 100, 200, 55),
            generateRandomPolygon(7, 200, 200, 65),
        ];

        let totalBuildings = 0;
        let nonRectangularBuildings = 0;

        for (const outerPoly of testCases) {
            const depth = 30;
            const innerPoly = getOffsetPolygon(outerPoly, depth);

            if (innerPoly.length !== outerPoly.length) continue;

            const buildings = generateBuildingsFromPolygons(outerPoly, innerPoly, 20);

            for (const building of buildings) {
                totalBuildings++;
                if (!isRectangle(building, 0.05)) {
                    nonRectangularBuildings++;
                }
            }
        }

        console.log(`Total buildings: ${totalBuildings}`);
        console.log(`Non-rectangular: ${nonRectangularBuildings} (${(nonRectangularBuildings/totalBuildings*100).toFixed(1)}%)`);

        expect(totalBuildings).toBeGreaterThan(0);
        // Most buildings should be non-rectangular due to offset geometry
        expect(nonRectangularBuildings / totalBuildings).toBeGreaterThan(0.5);
    });

    it('should create buildings with varying side lengths (not parallelograms)', () => {
        const outerPoly = generateRandomPolygon(5, 100, 100, 60);
        const innerPoly = getOffsetPolygon(outerPoly, 25);
        const buildings = generateBuildingsFromPolygons(outerPoly, innerPoly, 15);

        expect(buildings.length).toBeGreaterThan(0);

        // Check that buildings have varying geometry
        const sideLengthVariations: number[] = [];

        for (const building of buildings) {
            const [out1, out2, in2, in1] = building;

            const outerLen = distance(out1, out2);
            const innerLen = distance(in1, in2);

            // The ratio between outer and inner edge lengths shows non-parallelogram shape
            const ratio = innerLen / outerLen;
            sideLengthVariations.push(Math.abs(1 - ratio));
        }

        // Average variation from 1:1 ratio
        const avgVariation = sideLengthVariations.reduce((a, b) => a + b, 0) / sideLengthVariations.length;
        console.log(`Average inner/outer ratio deviation: ${avgVariation.toFixed(3)}`);

        // There should be meaningful variation (not all 1:1 ratios)
        expect(avgVariation).toBeGreaterThan(0.01);
    });

    it('should fill a block with multiple buildings', () => {
        const square: Point[] = [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            { x: 100, y: 100 },
            { x: 0, y: 100 }
        ];

        const innerPoly = getOffsetPolygon(square, 30);
        const buildings = generateBuildingsFromPolygons(square, innerPoly, 20);

        console.log(`Buildings in 100x100 square: ${buildings.length}`);

        // Should have buildings on all 4 edges
        expect(buildings.length).toBeGreaterThanOrEqual(4);
    });

    it('should handle irregular polygons without crashing', () => {
        // Create a very irregular polygon
        const irregular: Point[] = [
            { x: 0, y: 0 },
            { x: 80, y: 10 },
            { x: 120, y: 50 },
            { x: 100, y: 100 },
            { x: 30, y: 90 },
            { x: -10, y: 40 }
        ];

        const innerPoly = getOffsetPolygon(irregular, 20);
        const buildings = generateBuildingsFromPolygons(irregular, innerPoly, 15);

        console.log(`Buildings in irregular hexagon: ${buildings.length}`);

        // Should produce some buildings without error
        expect(buildings.length).toBeGreaterThan(0);
    });
});
