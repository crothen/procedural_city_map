import { describe, it, expect, beforeEach } from 'vitest';
import type { Point, GenerationParams } from './types';
import {
    calculatePolygonArea,
    getMinEdgeLength,
    getMinInteriorAngle,
    validatePolygon,
    shrinkPolygon
} from './geometry';
import { CityGenerator } from './CityGenerator';

// Default test params
const createTestParams = (overrides: Partial<GenerationParams> = {}): GenerationParams => ({
    width: 500,
    height: 500,
    seed: 42,
    growthSpeed: 1,
    branchingFactor: 0.3,
    segmentLength: 10,
    strategy: 'ORGANIC',
    waterFeature: 'NONE',
    citySize: 0.5,
    hardCityLimit: false,
    minBuildingArea: 64,      // 8x8 minimum
    maxBuildingArea: 625,     // 25x25 maximum
    minEdgeLength: 4,
    minAngle: 30,
    buildingIrregularity: 0.2,
    fixedBuildingDepth: 15,
    outerCityFalloff: 0.2,
    outerCityRandomness: 0.5,
    showCityLimitGradient: false,
    riverWidth: 30,
    ...overrides
});

describe('Geometry Utilities', () => {
    describe('calculatePolygonArea', () => {
        it('should calculate area of a simple square', () => {
            const square: Point[] = [
                { x: 0, y: 0 },
                { x: 10, y: 0 },
                { x: 10, y: 10 },
                { x: 0, y: 10 }
            ];
            expect(calculatePolygonArea(square)).toBe(100);
        });

        it('should calculate area of a rectangle', () => {
            const rect: Point[] = [
                { x: 0, y: 0 },
                { x: 20, y: 0 },
                { x: 20, y: 10 },
                { x: 0, y: 10 }
            ];
            expect(calculatePolygonArea(rect)).toBe(200);
        });

        it('should return 0 for invalid polygons', () => {
            expect(calculatePolygonArea([])).toBe(0);
            expect(calculatePolygonArea([{ x: 0, y: 0 }])).toBe(0);
            expect(calculatePolygonArea([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBe(0);
        });
    });

    describe('getMinEdgeLength', () => {
        it('should find minimum edge length', () => {
            const poly: Point[] = [
                { x: 0, y: 0 },
                { x: 10, y: 0 },
                { x: 10, y: 5 },
                { x: 0, y: 5 }
            ];
            expect(getMinEdgeLength(poly)).toBe(5);
        });

        it('should handle triangles', () => {
            const triangle: Point[] = [
                { x: 0, y: 0 },
                { x: 3, y: 0 },
                { x: 1.5, y: 4 }
            ];
            const minLen = getMinEdgeLength(triangle);
            expect(minLen).toBe(3); // bottom edge
        });
    });

    describe('getMinInteriorAngle', () => {
        it('should return 90 for a square', () => {
            const square: Point[] = [
                { x: 0, y: 0 },
                { x: 10, y: 0 },
                { x: 10, y: 10 },
                { x: 0, y: 10 }
            ];
            const angle = getMinInteriorAngle(square);
            expect(angle).toBeCloseTo(90, 1);
        });

        it('should detect acute angles', () => {
            // A shape with a sharp 30 degree angle
            const sharpPoly: Point[] = [
                { x: 0, y: 0 },
                { x: 10, y: 0 },
                { x: 5, y: 2.89 } // creates ~30 degree angle at top
            ];
            const angle = getMinInteriorAngle(sharpPoly);
            expect(angle).toBeLessThan(45);
        });
    });

    describe('validatePolygon', () => {
        it('should validate a good polygon', () => {
            const square: Point[] = [
                { x: 0, y: 0 },
                { x: 10, y: 0 },
                { x: 10, y: 10 },
                { x: 0, y: 10 }
            ];
            const result = validatePolygon(square, 50, 200, 5, 30);
            expect(result.valid).toBe(true);
            expect(result.area).toBe(100);
            expect(result.minEdge).toBe(10);
            expect(result.minAngleFound).toBeCloseTo(90, 1);
        });

        it('should reject polygon below min area', () => {
            const tiny: Point[] = [
                { x: 0, y: 0 },
                { x: 2, y: 0 },
                { x: 2, y: 2 },
                { x: 0, y: 2 }
            ];
            const result = validatePolygon(tiny, 50, 200, 1, 30);
            expect(result.valid).toBe(false);
            expect(result.area).toBe(4);
        });

        it('should reject polygon above max area', () => {
            const large: Point[] = [
                { x: 0, y: 0 },
                { x: 100, y: 0 },
                { x: 100, y: 100 },
                { x: 0, y: 100 }
            ];
            const result = validatePolygon(large, 50, 200, 5, 30);
            expect(result.valid).toBe(false);
            expect(result.area).toBe(10000);
        });

        it('should reject polygon with edge too short', () => {
            const shortEdge: Point[] = [
                { x: 0, y: 0 },
                { x: 10, y: 0 },
                { x: 10, y: 1 }, // Very short edge
                { x: 0, y: 10 }
            ];
            const result = validatePolygon(shortEdge, 10, 200, 5, 30);
            expect(result.valid).toBe(false);
            expect(result.minEdge).toBeLessThan(5);
        });
    });

    describe('shrinkPolygon', () => {
        it('should shrink a square inward', () => {
            const square: Point[] = [
                { x: 0, y: 0 },
                { x: 20, y: 0 },
                { x: 20, y: 20 },
                { x: 0, y: 20 }
            ];
            const shrunk = shrinkPolygon(square, 2);
            expect(shrunk.length).toBe(4);
            const shrunkArea = calculatePolygonArea(shrunk);
            expect(shrunkArea).toBeLessThan(400); // Original area
            expect(shrunkArea).toBeGreaterThan(200); // Should still have significant area
        });

        it('should reduce polygon size when shrinking', () => {
            const poly: Point[] = [
                { x: 0, y: 0 },
                { x: 20, y: 0 },
                { x: 20, y: 20 },
                { x: 0, y: 20 }
            ];
            const originalArea = calculatePolygonArea(poly);
            const shrunk = shrinkPolygon(poly, 3);

            if (shrunk.length > 0) {
                const shrunkArea = calculatePolygonArea(shrunk);
                // Shrunk area should be smaller than original
                expect(shrunkArea).toBeLessThan(originalArea);
            }
        });
    });
});

describe('Block Generation Validation', () => {
    let generator: CityGenerator;
    let params: GenerationParams;

    beforeEach(() => {
        params = createTestParams();
        generator = new CityGenerator(params);
    });

    it('should create generator without errors', () => {
        expect(generator).toBeDefined();
        expect(generator.blocks).toEqual([]);
    });

    describe('after road generation and block detection', () => {
        beforeEach(() => {
            // Generate roads by stepping until done
            generator.resetRoads();
            for (let i = 0; i < 1000 && generator.activeAgents.length > 0; i++) {
                generator.step();
            }
            // Generate blocks
            generator.generateBlocks();
        });

        it('should generate some blocks', () => {
            expect(generator.blocks.length).toBeGreaterThan(0);
        });

        it('all enclosed blocks should meet minimum area requirement', () => {
            const minArea = params.minBuildingArea;
            const enclosedBlocks = generator.blocks.filter(b => b.isEnclosed);

            for (const block of enclosedBlocks) {
                expect(block.area).toBeGreaterThanOrEqual(minArea);
            }
        });

        it('all blocks should have valid polygon data', () => {
            for (const block of generator.blocks) {
                expect(block.points.length).toBeGreaterThanOrEqual(3);
                expect(block.id).toBeDefined();
                expect(block.area).toBeGreaterThan(0);
            }
        });

        it('all blocks should have associated road IDs', () => {
            for (const block of generator.blocks) {
                expect(block.roadIds).toBeDefined();
                expect(Array.isArray(block.roadIds)).toBe(true);
            }
        });
    });
});

describe('Building Generation Validation', () => {
    let generator: CityGenerator;
    let params: GenerationParams;

    beforeEach(() => {
        params = createTestParams({
            width: 800,
            height: 800,
            minBuildingArea: 64,
            maxBuildingArea: 900,
            minEdgeLength: 3,
            minAngle: 25
        });
        generator = new CityGenerator(params);

        // Generate roads
        generator.resetRoads();
        for (let i = 0; i < 1000 && generator.activeAgents.length > 0; i++) {
            generator.step();
        }

        // Generate blocks
        generator.generateBlocks();

        // Generate buildings
        generator.startBuildingGeneration();
        for (let i = 0; i < 1000 && generator.isBuildingGenerationActive(); i++) {
            generator.stepBuildingGeneration();
        }
    });

    it('should generate some buildings', () => {
        expect(generator.buildings.length).toBeGreaterThan(0);
    });

    it('all buildings should meet minimum area requirement', () => {
        for (const building of generator.buildings) {
            const area = calculatePolygonArea(building.points);
            expect(area).toBeGreaterThanOrEqual(params.minBuildingArea);
        }
    });

    it('all buildings should have edges longer than minEdgeLength', () => {
        for (const building of generator.buildings) {
            const minEdge = getMinEdgeLength(building.points);
            expect(minEdge).toBeGreaterThanOrEqual(params.minEdgeLength);
        }
    });

    it('all buildings should have angles greater than minAngle', () => {
        for (const building of generator.buildings) {
            const minAngle = getMinInteriorAngle(building.points);
            expect(minAngle).toBeGreaterThanOrEqual(params.minAngle);
        }
    });

    it('all buildings should have valid centroids', () => {
        for (const building of generator.buildings) {
            expect(building.centroid).toBeDefined();
            expect(typeof building.centroid.x).toBe('number');
            expect(typeof building.centroid.y).toBe('number');
            expect(isFinite(building.centroid.x)).toBe(true);
            expect(isFinite(building.centroid.y)).toBe(true);
        }
    });

    it('all buildings should have at least 3 vertices', () => {
        for (const building of generator.buildings) {
            expect(building.points.length).toBeGreaterThanOrEqual(3);
        }
    });
});

describe('Parameter Sensitivity Tests', () => {
    it('buildings should respect minimum area constraint', () => {
        const params = createTestParams({ minBuildingArea: 100 });
        const generator = new CityGenerator(params);

        generator.resetRoads();
        for (let i = 0; i < 500 && generator.activeAgents.length > 0; i++) {
            generator.step();
        }
        generator.generateBlocks();
        generator.startBuildingGeneration();
        for (let i = 0; i < 500 && generator.isBuildingGenerationActive(); i++) {
            generator.stepBuildingGeneration();
        }

        // All buildings should be at least minBuildingArea
        for (const building of generator.buildings) {
            const area = calculatePolygonArea(building.points);
            expect(area).toBeGreaterThanOrEqual(params.minBuildingArea);
        }
    });

    it('buildings should respect minimum angle constraint', () => {
        const params = createTestParams({ minAngle: 30 });
        const generator = new CityGenerator(params);

        generator.resetRoads();
        for (let i = 0; i < 500 && generator.activeAgents.length > 0; i++) {
            generator.step();
        }
        generator.generateBlocks();
        generator.startBuildingGeneration();
        for (let i = 0; i < 500 && generator.isBuildingGenerationActive(); i++) {
            generator.stepBuildingGeneration();
        }

        // All buildings should have angles >= minAngle
        for (const building of generator.buildings) {
            const minAngle = getMinInteriorAngle(building.points);
            expect(minAngle).toBeGreaterThanOrEqual(params.minAngle);
        }
    });
});

describe('Edge Cases', () => {
    it('should handle very small map without crashing', () => {
        const params = createTestParams({ width: 100, height: 100 });
        const generator = new CityGenerator(params);

        generator.resetRoads();
        for (let i = 0; i < 100 && generator.activeAgents.length > 0; i++) {
            generator.step();
        }
        generator.generateBlocks();
        generator.startBuildingGeneration();
        for (let i = 0; i < 100 && generator.isBuildingGenerationActive(); i++) {
            generator.stepBuildingGeneration();
        }

        // Should not throw, but may have 0 buildings due to small size
        expect(generator).toBeDefined();
    });

    it('should handle extreme minBuildingArea without crashing', () => {
        const params = createTestParams({ minBuildingArea: 10000 });
        const generator = new CityGenerator(params);

        generator.resetRoads();
        for (let i = 0; i < 500 && generator.activeAgents.length > 0; i++) {
            generator.step();
        }
        generator.generateBlocks();
        generator.startBuildingGeneration();
        for (let i = 0; i < 500 && generator.isBuildingGenerationActive(); i++) {
            generator.stepBuildingGeneration();
        }

        // Should not throw, likely 0 buildings due to high threshold
        expect(generator).toBeDefined();
    });

    it('should not create buildings with degenerate geometry', () => {
        const params = createTestParams();
        const generator = new CityGenerator(params);

        generator.resetRoads();
        for (let i = 0; i < 500 && generator.activeAgents.length > 0; i++) {
            generator.step();
        }
        generator.generateBlocks();
        generator.startBuildingGeneration();
        for (let i = 0; i < 500 && generator.isBuildingGenerationActive(); i++) {
            generator.stepBuildingGeneration();
        }

        for (const building of generator.buildings) {
            // No duplicate consecutive points
            for (let i = 0; i < building.points.length; i++) {
                const curr = building.points[i];
                const next = building.points[(i + 1) % building.points.length];
                const dist = Math.hypot(next.x - curr.x, next.y - curr.y);
                expect(dist).toBeGreaterThan(0.001);
            }

            // Area should be positive
            const area = calculatePolygonArea(building.points);
            expect(area).toBeGreaterThan(0);

            // All coordinates should be finite
            for (const point of building.points) {
                expect(isFinite(point.x)).toBe(true);
                expect(isFinite(point.y)).toBe(true);
            }
        }
    });
});
