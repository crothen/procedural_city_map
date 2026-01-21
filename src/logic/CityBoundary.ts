import type { Point, GenerationParams } from './types';
import { pointInPolygon, catmullRom, pointToSegmentDistance } from './geometry';
import { WaterGenerator } from './WaterGenerator';

export class CityBoundary {
    cityCenter: Point = { x: 0, y: 0 };
    cityRadius: number = 0;
    cityBoundary: Point[] = [];

    private params: GenerationParams;
    private waterGenerator: WaterGenerator;

    constructor(params: GenerationParams, waterGenerator: WaterGenerator) {
        this.params = params;
        this.waterGenerator = waterGenerator;
    }

    updateParams(params: GenerationParams) {
        this.params = params;
    }

    reset() {
        this.cityBoundary = [];
    }

    /**
     * Initialize city center and boundary.
     */
    initialize() {
        const startPoint = this.findValidStartPoint();
        this.cityCenter = { x: startPoint.x, y: startPoint.y };

        const maxPossibleRadius = Math.min(this.params.width, this.params.height) / 2;
        this.cityRadius = maxPossibleRadius * this.params.citySize;

        this.generate();
    }

    /**
     * Check if a point is inside the city boundary.
     */
    isPointInsideCity(point: Point): boolean {
        if (this.cityBoundary.length < 3) {
            // Fallback to circular check if boundary not generated
            const dist = Math.sqrt(
                (point.x - this.cityCenter.x) ** 2 +
                (point.y - this.cityCenter.y) ** 2
            );
            return dist <= this.cityRadius;
        }
        return pointInPolygon(point, this.cityBoundary);
    }

    /**
     * Calculate distance from point to nearest city boundary point.
     */
    distanceToNearestBoundaryPoint(point: Point): number {
        if (this.cityBoundary.length < 3) return 0;

        let minDist = Infinity;
        for (let i = 0; i < this.cityBoundary.length; i++) {
            const p1 = this.cityBoundary[i];
            const p2 = this.cityBoundary[(i + 1) % this.cityBoundary.length];
            const dist = pointToSegmentDistance(point, p1, p2);
            minDist = Math.min(minDist, dist);
        }
        return minDist;
    }

    /**
     * Generate an organic, non-circular city boundary with possible suburban protrusions.
     */
    generate() {
        const { width, height } = this.params;
        const numPoints = 24;
        const points: Point[] = [];

        // Pre-generate suburban protrusions (Vorstädte)
        const numSuburbs = Math.floor(Math.random() * 4);
        const suburbs: { angle: number; size: number; width: number }[] = [];
        for (let i = 0; i < numSuburbs; i++) {
            suburbs.push({
                angle: Math.random() * Math.PI * 2,
                size: 0.3 + Math.random() * 0.5,
                width: 0.15 + Math.random() * 0.2
            });
        }

        // Pre-generate indentations (bays/concave areas)
        const numIndentations = Math.floor(Math.random() * 3);
        const indentations: { angle: number; depth: number; width: number }[] = [];
        for (let i = 0; i < numIndentations; i++) {
            indentations.push({
                angle: Math.random() * Math.PI * 2,
                depth: 0.15 + Math.random() * 0.25,
                width: 0.1 + Math.random() * 0.15
            });
        }

        let radiusOffset = 0;
        let radiusVelocity = 0;

        for (let i = 0; i < numPoints; i++) {
            const angle = (Math.PI * 2 / numPoints) * i;

            radiusVelocity += (Math.random() - 0.5) * 0.15;
            radiusVelocity *= 0.75;
            radiusOffset += radiusVelocity;
            radiusOffset = Math.max(-0.25, Math.min(0.25, radiusOffset));

            let suburbEffect = 0;
            for (const suburb of suburbs) {
                const angleDiff = Math.abs(this.normalizeAngle(angle - suburb.angle));
                const angularWidth = suburb.width * Math.PI;
                if (angleDiff < angularWidth) {
                    const strength = Math.cos((angleDiff / angularWidth) * Math.PI / 2);
                    suburbEffect += strength * suburb.size;
                }
            }

            let indentEffect = 0;
            for (const indent of indentations) {
                const angleDiff = Math.abs(this.normalizeAngle(angle - indent.angle));
                const angularWidth = indent.width * Math.PI;
                if (angleDiff < angularWidth) {
                    const strength = Math.cos((angleDiff / angularWidth) * Math.PI / 2);
                    indentEffect -= strength * indent.depth;
                }
            }

            const baseVariation = 0.85 + radiusOffset + Math.random() * 0.1;
            const totalMultiplier = baseVariation + suburbEffect + indentEffect;
            let radius = this.cityRadius * Math.max(0.4, totalMultiplier);

            let x = this.cityCenter.x + Math.cos(angle) * radius;
            let y = this.cityCenter.y + Math.sin(angle) * radius;

            const margin = 20;
            x = Math.max(margin, Math.min(width - margin, x));
            y = Math.max(margin, Math.min(height - margin, y));

            points.push({ x, y });
        }

        this.cityBoundary = this.smoothBoundary(points);
    }

    private normalizeAngle(angle: number): number {
        while (angle > Math.PI) angle -= Math.PI * 2;
        while (angle < -Math.PI) angle += Math.PI * 2;
        return angle;
    }

    private smoothBoundary(controlPoints: Point[]): Point[] {
        const result: Point[] = [];
        const segmentsPerSpan = 4;
        const n = controlPoints.length;

        for (let i = 0; i < n; i++) {
            const p0 = controlPoints[(i - 1 + n) % n];
            const p1 = controlPoints[i];
            const p2 = controlPoints[(i + 1) % n];
            const p3 = controlPoints[(i + 2) % n];

            for (let j = 0; j < segmentsPerSpan; j++) {
                const t = j / segmentsPerSpan;
                result.push(catmullRom(p0, p1, p2, p3, t));
            }
        }

        return result;
    }

    /**
     * Find a strategic starting point - near water for defense/trade but not in it.
     */
    findValidStartPoint(): Point {
        const { width, height } = this.params;
        const center = { x: width / 2, y: height / 2 };

        if (this.waterGenerator.waterBodies.length === 0) {
            return center;
        }

        const strategicPoint = this.findStrategicPointNearWater();
        if (strategicPoint) {
            return strategicPoint;
        }

        for (let i = 0; i < 100; i++) {
            const point = {
                x: width * 0.2 + Math.random() * width * 0.6,
                y: height * 0.2 + Math.random() * height * 0.6
            };
            if (!this.waterGenerator.isPointInWater(point)) {
                return point;
            }
        }

        return { x: center.x + 100, y: center.y + 100 };
    }

    private findStrategicPointNearWater(): Point | null {
        const { width, height, segmentLength } = this.params;
        const idealDistance = segmentLength * 2;
        const maxDistance = segmentLength * 5;

        let bestPoint: Point | null = null;
        let bestScore = -1;

        for (let i = 0; i < 200; i++) {
            const point = {
                x: width * 0.15 + Math.random() * width * 0.7,
                y: height * 0.15 + Math.random() * height * 0.7
            };

            if (this.waterGenerator.isPointInWater(point)) continue;

            const waterDist = this.waterGenerator.distanceToWater(point);

            if (waterDist > maxDistance) continue;

            let score = 0;

            if (waterDist < idealDistance) {
                score += 10 * (waterDist / idealDistance);
            } else {
                score += 10 * (1 - (waterDist - idealDistance) / (maxDistance - idealDistance));
            }

            const waterDirections = this.countWaterDirections(point, 8);
            score += waterDirections * 5;

            if (waterDirections >= 2 && waterDirections <= 4) {
                score += 15;
            }

            if (score > bestScore) {
                bestScore = score;
                bestPoint = point;
            }
        }

        return bestPoint;
    }

    private countWaterDirections(point: Point, numDirections: number): number {
        const checkDistance = this.params.segmentLength * 4;
        let count = 0;

        for (let i = 0; i < numDirections; i++) {
            const angle = (Math.PI * 2 / numDirections) * i;
            const checkPoint = {
                x: point.x + Math.cos(angle) * checkDistance,
                y: point.y + Math.sin(angle) * checkDistance
            };

            if (this.waterGenerator.isPointInWater(checkPoint)) {
                count++;
            }
        }

        return count;
    }
}
