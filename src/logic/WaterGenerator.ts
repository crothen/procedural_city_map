import type { Point, WaterBody, GenerationParams } from './types';
import { pointInPolygon, catmullRom } from './geometry';

export class WaterGenerator {
    waterBodies: WaterBody[] = [];
    private params: GenerationParams;

    constructor(params: GenerationParams) {
        this.params = params;
    }

    updateParams(params: GenerationParams) {
        this.params = params;
    }

    reset() {
        this.waterBodies = [];
    }

    /**
     * Check if a point is inside any water body.
     */
    isPointInWater(point: Point): boolean {
        for (const water of this.waterBodies) {
            if (pointInPolygon(point, water.points)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Generate water features based on params.
     * Can combine features: rivers can flow into lakes or coasts.
     */
    generate() {
        const { waterFeature } = this.params;

        if (waterFeature === 'NONE') return;

        if (waterFeature === 'RIVER') {
            this.generateRiver();
        } else if (waterFeature === 'COAST') {
            this.generateCoast();
            // 50% chance to also have a river flowing into the sea
            if (Math.random() < 0.5) {
                this.generateRiverIntoWater();
            }
        } else if (waterFeature === 'LAKE') {
            this.generateLake();
            // 60% chance to have a river flowing into or out of the lake
            if (Math.random() < 0.6) {
                this.generateRiverIntoWater();
            }
        }
    }

    /**
     * Generate a river that flows into existing water (lake or coast).
     * River endpoint extends INTO the water body, pointing towards its center.
     */
    private generateRiverIntoWater() {
        const { width, height } = this.params;

        if (this.waterBodies.length === 0) return;

        // Find a point on an existing water body to connect to
        const targetWater = this.waterBodies[0];
        const waterPoints = targetWater.points;

        // Calculate the center of the water body
        let waterCenterX = 0;
        let waterCenterY = 0;
        for (const p of waterPoints) {
            waterCenterX += p.x;
            waterCenterY += p.y;
        }
        waterCenterX /= waterPoints.length;
        waterCenterY /= waterPoints.length;

        // Pick a random point on the water edge
        const targetIdx = Math.floor(Math.random() * waterPoints.length);
        const edgePoint = waterPoints[targetIdx];

        // Calculate direction from edge point towards water center
        const toCenterDx = waterCenterX - edgePoint.x;
        const toCenterDy = waterCenterY - edgePoint.y;
        const toCenterLen = Math.sqrt(toCenterDx * toCenterDx + toCenterDy * toCenterDy) || 1;
        const toCenterNormX = toCenterDx / toCenterLen;
        const toCenterNormY = toCenterDy / toCenterLen;

        // Extend the target point INSIDE the water (30-60 pixels past the edge)
        const extensionIntoWater = 30 + Math.random() * 30;
        const targetPoint = {
            x: edgePoint.x + toCenterNormX * extensionIntoWater,
            y: edgePoint.y + toCenterNormY * extensionIntoWater
        };

        // River flows from a map edge to this water point
        const riverWidth = 30 + Math.random() * 20; // Slightly narrower than main rivers

        // Determine which edge to start from - opposite side from the water
        let startPoint: Point;
        const margin = 50;

        // Start from the edge that's furthest from the water center
        const distToLeft = waterCenterX;
        const distToRight = width - waterCenterX;
        const distToTop = waterCenterY;
        const distToBottom = height - waterCenterY;

        // Pick a starting edge based on which is furthest from water
        const maxDist = Math.max(distToLeft, distToRight, distToTop, distToBottom);

        if (maxDist === distToRight) {
            startPoint = { x: width, y: margin + Math.random() * (height - margin * 2) };
        } else if (maxDist === distToLeft) {
            startPoint = { x: 0, y: margin + Math.random() * (height - margin * 2) };
        } else if (maxDist === distToBottom) {
            startPoint = { x: margin + Math.random() * (width - margin * 2), y: height };
        } else {
            startPoint = { x: margin + Math.random() * (width - margin * 2), y: 0 };
        }

        // Generate control points for the river path using random walk
        const numPoints = 10 + Math.floor(Math.random() * 5);
        const controlPoints: Point[] = [];

        // Calculate flow direction
        const flowDx = targetPoint.x - startPoint.x;
        const flowDy = targetPoint.y - startPoint.y;
        const flowLen = Math.sqrt(flowDx * flowDx + flowDy * flowDy) || 1;
        const perpX = -flowDy / flowLen;
        const perpY = flowDx / flowLen;

        // Use velocity-based random walk for organic meander
        const maxMeander = 50 + Math.random() * 60;
        let perpVelocity = (Math.random() - 0.5) * 20;
        let perpAcceleration = 0;
        let perpOffset = 0;

        for (let i = 0; i < numPoints; i++) {
            const t = i / (numPoints - 1);

            // Base interpolation
            const baseX = startPoint.x + (targetPoint.x - startPoint.x) * t;
            const baseY = startPoint.y + (targetPoint.y - startPoint.y) * t;

            // Random walk meander
            if (Math.random() < 0.3) {
                perpAcceleration = (Math.random() - 0.5) * 15;
            } else {
                perpAcceleration += (Math.random() - 0.5) * 10;
            }

            perpVelocity += perpAcceleration;
            perpVelocity *= 0.7;

            const maxVel = maxMeander / 4;
            perpVelocity = Math.max(-maxVel, Math.min(maxVel, perpVelocity));

            perpOffset += perpVelocity;
            perpOffset = Math.max(-maxMeander, Math.min(maxMeander, perpOffset));

            // Reduce meander near connection points for smoother join
            const edgeFactor = Math.min(t * 5, (1 - t) * 5, 1);
            const totalMeander = perpOffset * edgeFactor;

            controlPoints.push({
                x: baseX + perpX * totalMeander,
                y: baseY + perpY * totalMeander
            });
        }

        // Interpolate and create polygon
        if (controlPoints.length >= 3) {
            const smoothRiver = this.interpolateRiverCurve(controlPoints);
            const riverPolygon = this.riverToPolygon(smoothRiver, riverWidth);
            this.waterBodies.push({ type: 'RIVER', points: riverPolygon });
        }
    }

    /**
     * Generate a meandering river across the map with natural curves and optional branching.
     */
    private generateRiver() {
        const { width, height } = this.params;

        // Consistent river width for this map (40-70 pixels)
        const baseRiverWidth = 40 + Math.random() * 30;

        // Decide river orientation and create control points
        const horizontal = Math.random() > 0.5;

        // Generate the main river centerline with more natural curves
        const controlPoints = this.generateRiverControlPoints(horizontal, width, height, baseRiverWidth);

        // Interpolate to create smooth curve
        const smoothCenterline = this.interpolateRiverCurve(controlPoints);

        // Convert to polygon
        const mainRiverPolygon = this.riverToPolygon(smoothCenterline, baseRiverWidth);
        this.waterBodies.push({ type: 'RIVER', points: mainRiverPolygon });

        // Add tributaries (inflows that don't rejoin)
        const numTributaries = Math.floor(Math.random() * 3); // 0-2 tributaries
        for (let i = 0; i < numTributaries; i++) {
            this.addTributary(smoothCenterline, baseRiverWidth, horizontal);
        }

        // Chance for river branching that rejoins (creates island)
        if (Math.random() < 0.25) {
            this.addRiverIsland(smoothCenterline, baseRiverWidth, horizontal);
        }
    }

    /**
     * Generate control points for a natural river curve using velocity-based random walk.
     */
    private generateRiverControlPoints(horizontal: boolean, width: number, height: number, riverWidth: number): Point[] {
        const points: Point[] = [];

        // Width factor: 0 = narrow (30px), 1 = wide (70px)
        const widthFactor = Math.max(0, Math.min(1, (riverWidth - 30) / 40));

        const numControlPoints = Math.floor(18 + (1 - widthFactor) * 12 + Math.random() * 8);
        const baseAmplitude = 120 + widthFactor * 250;
        const maxMeanderAmplitude = baseAmplitude + Math.random() * 150;
        const directionChangeChance = 0.15 + (1 - widthFactor) * 0.35;
        const accelMagnitude = 25 + (1 - widthFactor) * 45;
        const accelVariation = 15 + (1 - widthFactor) * 30;
        const curveTendency = 0.88 + (1 - widthFactor) * 0.07;
        const bendChance = 0.12 + (1 - widthFactor) * 0.18;
        const bendMagnitude = 0.4 + widthFactor * 0.3;
        const margin = riverWidth * 3;

        if (horizontal) {
            let y = height * (0.35 + Math.random() * 0.3);
            let yVelocity = (Math.random() - 0.5) * (35 + (1 - widthFactor) * 25);
            let yAcceleration = 0;

            for (let i = 0; i <= numControlPoints; i++) {
                const t = i / numControlPoints;
                const x = width * t;

                if (Math.random() < directionChangeChance) {
                    yAcceleration = (Math.random() - 0.5) * accelMagnitude;
                } else {
                    yAcceleration += (Math.random() - 0.5) * accelVariation;
                }

                yVelocity += yAcceleration;
                yVelocity *= curveTendency;

                const maxVelocity = maxMeanderAmplitude / (2.5 - widthFactor);
                yVelocity = Math.max(-maxVelocity, Math.min(maxVelocity, yVelocity));

                y += yVelocity;

                if (Math.random() < bendChance) {
                    const bendSize = (Math.random() - 0.5) * maxMeanderAmplitude * bendMagnitude;
                    y += bendSize;
                    yVelocity += bendSize * 0.4;
                }

                const centerY = height / 2;
                const distFromCenter = y - centerY;
                const maxDist = (height / 2) - margin;
                if (Math.abs(distFromCenter) > maxDist * 0.6) {
                    const pushback = -distFromCenter * 0.2;
                    yVelocity += pushback;
                }

                y = Math.max(margin, Math.min(height - margin, y));
                points.push({ x, y });
            }
        } else {
            let x = width * (0.35 + Math.random() * 0.3);
            let xVelocity = (Math.random() - 0.5) * (35 + (1 - widthFactor) * 25);
            let xAcceleration = 0;

            for (let i = 0; i <= numControlPoints; i++) {
                const t = i / numControlPoints;
                const y = height * t;

                if (Math.random() < directionChangeChance) {
                    xAcceleration = (Math.random() - 0.5) * accelMagnitude;
                } else {
                    xAcceleration += (Math.random() - 0.5) * accelVariation;
                }

                xVelocity += xAcceleration;
                xVelocity *= curveTendency;

                const maxVelocity = maxMeanderAmplitude / (2.5 - widthFactor);
                xVelocity = Math.max(-maxVelocity, Math.min(maxVelocity, xVelocity));

                x += xVelocity;

                if (Math.random() < bendChance) {
                    const bendSize = (Math.random() - 0.5) * maxMeanderAmplitude * bendMagnitude;
                    x += bendSize;
                    xVelocity += bendSize * 0.4;
                }

                const centerX = width / 2;
                const distFromCenter = x - centerX;
                const maxDist = (width / 2) - margin;
                if (Math.abs(distFromCenter) > maxDist * 0.6) {
                    const pushback = -distFromCenter * 0.2;
                    xVelocity += pushback;
                }

                x = Math.max(margin, Math.min(width - margin, x));
                points.push({ x, y });
            }
        }

        return points;
    }

    /**
     * Interpolate control points using Catmull-Rom spline for smooth curves.
     */
    private interpolateRiverCurve(controlPoints: Point[]): Point[] {
        const result: Point[] = [];
        const segmentsPerSpan = 8;

        for (let i = 0; i < controlPoints.length - 1; i++) {
            const p0 = controlPoints[Math.max(0, i - 1)];
            const p1 = controlPoints[i];
            const p2 = controlPoints[Math.min(controlPoints.length - 1, i + 1)];
            const p3 = controlPoints[Math.min(controlPoints.length - 1, i + 2)];

            for (let j = 0; j < segmentsPerSpan; j++) {
                const t = j / segmentsPerSpan;
                const point = catmullRom(p0, p1, p2, p3, t);
                result.push(point);
            }
        }

        result.push(controlPoints[controlPoints.length - 1]);
        return result;
    }

    /**
     * Add a tributary (inflow stream) that flows from map edge to join the main river.
     */
    private addTributary(mainCenterline: Point[], baseWidth: number, horizontal: boolean) {
        const { width, height } = this.params;
        const tributaryWidth = baseWidth * (0.3 + Math.random() * 0.25);

        const joinIdx = Math.floor(mainCenterline.length * (0.15 + Math.random() * 0.7));
        const joinPoint = mainCenterline[joinIdx];
        const side = Math.random() > 0.5 ? 1 : -1;

        const numPoints = 8 + Math.floor(Math.random() * 4);
        const controlPoints: Point[] = [];
        const approachAngle = (30 + Math.random() * 40) * (Math.PI / 180);
        const flowDirection = Math.random() > 0.5 ? 1 : -1;

        let startX: number, startY: number;
        const edgeOffset = 300 + Math.random() * 400;

        if (horizontal) {
            startY = side > 0 ? height : 0;
            startX = joinPoint.x + flowDirection * edgeOffset * Math.tan(approachAngle);
            startX = Math.max(50, Math.min(width - 50, startX));
        } else {
            startX = side > 0 ? width : 0;
            startY = joinPoint.y + flowDirection * edgeOffset * Math.tan(approachAngle);
            startY = Math.max(50, Math.min(height - 50, startY));
        }

        const maxMeander = 40 + Math.random() * 50;
        let perpVelocity = (Math.random() - 0.5) * 15;
        let perpAcceleration = 0;

        const flowDx = joinPoint.x - startX;
        const flowDy = joinPoint.y - startY;
        const flowLen = Math.sqrt(flowDx * flowDx + flowDy * flowDy) || 1;
        const perpX = -flowDy / flowLen;
        const perpY = flowDx / flowLen;

        let perpOffset = 0;

        for (let i = 0; i < numPoints; i++) {
            const t = i / (numPoints - 1);

            const baseX = startX + (joinPoint.x - startX) * t;
            const baseY = startY + (joinPoint.y - startY) * t;

            if (Math.random() < 0.35) {
                perpAcceleration = (Math.random() - 0.5) * 12;
            } else {
                perpAcceleration += (Math.random() - 0.5) * 8;
            }

            perpVelocity += perpAcceleration;
            perpVelocity *= 0.75;

            const maxVel = maxMeander / 4;
            perpVelocity = Math.max(-maxVel, Math.min(maxVel, perpVelocity));

            perpOffset += perpVelocity;
            perpOffset = Math.max(-maxMeander, Math.min(maxMeander, perpOffset));

            const connectionFactor = t > 0.75 ? (1 - t) / 0.25 : (t < 0.1 ? t / 0.1 : 1);
            const totalMeander = perpOffset * connectionFactor;

            controlPoints.push({
                x: baseX + perpX * totalMeander,
                y: baseY + perpY * totalMeander
            });
        }

        if (controlPoints.length >= 3) {
            const smoothTributary = this.interpolateRiverCurve(controlPoints);
            const tributaryPolygon = this.riverToPolygon(smoothTributary, tributaryWidth);
            this.waterBodies.push({ type: 'RIVER', points: tributaryPolygon });
        }
    }

    /**
     * Add a river branch that splits off and rejoins, creating an island.
     */
    private addRiverIsland(mainCenterline: Point[], baseWidth: number, horizontal: boolean) {
        const branchWidth = baseWidth * (0.4 + Math.random() * 0.3);

        const startIdx = Math.floor(mainCenterline.length * (0.25 + Math.random() * 0.15));
        const endIdx = Math.floor(mainCenterline.length * (0.55 + Math.random() * 0.2));

        if (endIdx - startIdx < 12) return;

        const branchPoints: Point[] = [];
        const branchOffset = (Math.random() > 0.5 ? 1 : -1) * (50 + Math.random() * 70);

        for (let i = startIdx; i <= endIdx; i++) {
            const t = (i - startIdx) / (endIdx - startIdx);
            const mainPoint = mainCenterline[i];
            const offsetAmount = Math.sin(t * Math.PI) * branchOffset;

            if (horizontal) {
                branchPoints.push({ x: mainPoint.x, y: mainPoint.y + offsetAmount });
            } else {
                branchPoints.push({ x: mainPoint.x + offsetAmount, y: mainPoint.y });
            }
        }

        if (branchPoints.length >= 5) {
            const branchPolygon = this.riverToPolygon(branchPoints, branchWidth);
            this.waterBodies.push({ type: 'RIVER', points: branchPolygon });
        }
    }

    /**
     * Convert a river centerline to a polygon by offsetting both sides.
     */
    private riverToPolygon(centerline: Point[], width: number): Point[] {
        const leftSide: Point[] = [];
        const rightSide: Point[] = [];
        const halfWidth = width / 2;

        const noiseValues: number[] = [];
        for (let i = 0; i < centerline.length; i++) {
            noiseValues.push(0.9 + Math.random() * 0.2);
        }

        const smoothedNoise: number[] = [];
        for (let i = 0; i < noiseValues.length; i++) {
            const prev = noiseValues[Math.max(0, i - 1)];
            const curr = noiseValues[i];
            const next = noiseValues[Math.min(noiseValues.length - 1, i + 1)];
            smoothedNoise.push((prev + curr + next) / 3);
        }

        for (let i = 0; i < centerline.length; i++) {
            const curr = centerline[i];
            const prev = centerline[Math.max(0, i - 1)];
            const next = centerline[Math.min(centerline.length - 1, i + 1)];

            const dx = next.x - prev.x;
            const dy = next.y - prev.y;
            const len = Math.sqrt(dx * dx + dy * dy) || 1;

            const nx = -dy / len;
            const ny = dx / len;

            const localWidth = halfWidth * smoothedNoise[i];

            leftSide.push({ x: curr.x + nx * localWidth, y: curr.y + ny * localWidth });
            rightSide.push({ x: curr.x - nx * localWidth, y: curr.y - ny * localWidth });
        }

        return [...leftSide, ...rightSide.reverse()];
    }

    /**
     * Generate a coastline with natural curves, coves and peninsulas.
     */
    private generateCoast() {
        const { width, height } = this.params;

        const side = Math.floor(Math.random() * 4);
        const numControlPoints = 14 + Math.floor(Math.random() * 6);
        const coastDepth = width * (0.15 + Math.random() * 0.15);

        const numFeatures = 2 + Math.floor(Math.random() * 3);
        const features: { position: number; type: 'cove' | 'peninsula'; size: number }[] = [];
        for (let i = 0; i < numFeatures; i++) {
            features.push({
                position: 0.1 + Math.random() * 0.8,
                type: Math.random() > 0.5 ? 'cove' : 'peninsula',
                size: 0.3 + Math.random() * 0.5
            });
        }

        const controlPoints: Point[] = [];
        let depthVelocity = 0;
        const wavelength = 300 + Math.random() * 200;
        const baseAmplitude = 40 + Math.random() * 40;

        if (side === 0 || side === 1) {
            const baseX = side === 0 ? coastDepth : width - coastDepth;
            const sign = side === 0 ? 1 : -1;

            for (let i = 0; i <= numControlPoints; i++) {
                const t = i / numControlPoints;
                const y = height * t;

                const sinVariation = Math.sin((y / wavelength) * Math.PI * 2) * baseAmplitude;
                depthVelocity += (Math.random() - 0.5) * 25;
                depthVelocity *= 0.75;

                let featureOffset = 0;
                for (const feature of features) {
                    const distToFeature = Math.abs(t - feature.position);
                    const featureWidth = 0.15;
                    if (distToFeature < featureWidth) {
                        const featureStrength = Math.cos((distToFeature / featureWidth) * Math.PI / 2);
                        const featureSize = coastDepth * feature.size;
                        if (feature.type === 'cove') {
                            featureOffset -= featureStrength * featureSize;
                        } else {
                            featureOffset += featureStrength * featureSize;
                        }
                    }
                }

                const totalOffset = sinVariation + depthVelocity + featureOffset;
                controlPoints.push({ x: baseX + sign * totalOffset, y });
            }
        } else {
            const baseY = side === 2 ? coastDepth : height - coastDepth;
            const sign = side === 2 ? 1 : -1;

            for (let i = 0; i <= numControlPoints; i++) {
                const t = i / numControlPoints;
                const x = width * t;

                const sinVariation = Math.sin((x / wavelength) * Math.PI * 2) * baseAmplitude;
                depthVelocity += (Math.random() - 0.5) * 25;
                depthVelocity *= 0.75;

                let featureOffset = 0;
                for (const feature of features) {
                    const distToFeature = Math.abs(t - feature.position);
                    const featureWidth = 0.15;
                    if (distToFeature < featureWidth) {
                        const featureStrength = Math.cos((distToFeature / featureWidth) * Math.PI / 2);
                        const featureSize = coastDepth * feature.size;
                        if (feature.type === 'cove') {
                            featureOffset -= featureStrength * featureSize;
                        } else {
                            featureOffset += featureStrength * featureSize;
                        }
                    }
                }

                const totalOffset = sinVariation + depthVelocity + featureOffset;
                controlPoints.push({ x, y: baseY + sign * totalOffset });
            }
        }

        const smoothCoastline = this.interpolateCoastCurve(controlPoints);
        const points: Point[] = [];

        if (side === 0) {
            points.push({ x: 0, y: 0 });
            points.push(...smoothCoastline);
            points.push({ x: 0, y: height });
        } else if (side === 1) {
            points.push({ x: width, y: 0 });
            points.push(...smoothCoastline);
            points.push({ x: width, y: height });
        } else if (side === 2) {
            points.push({ x: 0, y: 0 });
            points.push(...smoothCoastline);
            points.push({ x: width, y: 0 });
        } else {
            points.push({ x: 0, y: height });
            points.push(...smoothCoastline);
            points.push({ x: width, y: height });
        }

        this.waterBodies.push({ type: 'COAST', points });
    }

    private interpolateCoastCurve(controlPoints: Point[]): Point[] {
        const result: Point[] = [];
        const segmentsPerSpan = 6;

        for (let i = 0; i < controlPoints.length - 1; i++) {
            const p0 = controlPoints[Math.max(0, i - 1)];
            const p1 = controlPoints[i];
            const p2 = controlPoints[Math.min(controlPoints.length - 1, i + 1)];
            const p3 = controlPoints[Math.min(controlPoints.length - 1, i + 2)];

            for (let j = 0; j < segmentsPerSpan; j++) {
                const t = j / segmentsPerSpan;
                result.push(catmullRom(p0, p1, p2, p3, t));
            }
        }

        result.push(controlPoints[controlPoints.length - 1]);
        return result;
    }

    /**
     * Generate lakes on the map with varied sizes and shapes.
     */
    private generateLake() {
        const { width, height } = this.params;

        const lakeType = Math.random();

        if (lakeType < 0.4) {
            this.generateSingleLake(width, height, 0.12 + Math.random() * 0.15, true);
        } else if (lakeType < 0.7) {
            const numLakes = 2 + Math.floor(Math.random() * 2);
            for (let i = 0; i < numLakes; i++) {
                const size = 0.05 + Math.random() * 0.08;
                this.generateSingleLake(width, height, size, false);
            }
        } else {
            this.generateElongatedLake(width, height);
        }
    }

    private generateSingleLake(mapWidth: number, mapHeight: number, sizeRatio: number, irregular: boolean) {
        const margin = sizeRatio + 0.1;
        const cx = mapWidth * (margin + Math.random() * (1 - 2 * margin));
        const cy = mapHeight * (margin + Math.random() * (1 - 2 * margin));
        const baseRadius = Math.min(mapWidth, mapHeight) * sizeRatio;

        const numControlPoints = irregular ? (14 + Math.floor(Math.random() * 6)) : (10 + Math.floor(Math.random() * 4));
        const controlPoints: Point[] = [];

        let radiusOffset = 0;
        let radiusVelocity = 0;
        const variationScale = irregular ? 0.25 : 0.15;
        const maxOffset = irregular ? 0.5 : 0.3;

        for (let i = 0; i < numControlPoints; i++) {
            const angle = (Math.PI * 2 / numControlPoints) * i;

            radiusVelocity += (Math.random() - 0.5) * variationScale;
            radiusVelocity *= 0.65;
            radiusOffset += radiusVelocity;
            radiusOffset = Math.max(-maxOffset, Math.min(maxOffset, radiusOffset));

            let extraVariation = 0;
            if (irregular && Math.random() < 0.2) {
                extraVariation = (Math.random() - 0.5) * 0.3;
            }

            const radius = baseRadius * (0.8 + radiusOffset + extraVariation + Math.random() * 0.1);

            controlPoints.push({
                x: cx + Math.cos(angle) * radius,
                y: cy + Math.sin(angle) * radius
            });
        }

        const smoothPoints = this.interpolateLakeCurve(controlPoints);
        this.waterBodies.push({ type: 'LAKE', points: smoothPoints });
    }

    private generateElongatedLake(mapWidth: number, mapHeight: number) {
        const angle = Math.random() * Math.PI;
        const cx = mapWidth * (0.3 + Math.random() * 0.4);
        const cy = mapHeight * (0.3 + Math.random() * 0.4);

        const length = Math.min(mapWidth, mapHeight) * (0.2 + Math.random() * 0.15);
        const width = length * (0.2 + Math.random() * 0.15);

        const numControlPoints = 16 + Math.floor(Math.random() * 6);
        const controlPoints: Point[] = [];

        let widthVelocity = 0;
        let widthOffset = 0;

        for (let i = 0; i < numControlPoints; i++) {
            const t = i / numControlPoints;
            const pointAngle = t * Math.PI * 2;

            widthVelocity += (Math.random() - 0.5) * 0.1;
            widthVelocity *= 0.8;
            widthOffset += widthVelocity;
            widthOffset = Math.max(-0.3, Math.min(0.3, widthOffset));

            const widthMultiplier = 1 + widthOffset + Math.random() * 0.1;

            const localX = Math.cos(pointAngle) * length / 2;
            const localY = Math.sin(pointAngle) * width * widthMultiplier / 2;

            const rotatedX = localX * Math.cos(angle) - localY * Math.sin(angle);
            const rotatedY = localX * Math.sin(angle) + localY * Math.cos(angle);

            controlPoints.push({
                x: cx + rotatedX,
                y: cy + rotatedY
            });
        }

        const smoothPoints = this.interpolateLakeCurve(controlPoints);
        this.waterBodies.push({ type: 'LAKE', points: smoothPoints });
    }

    private interpolateLakeCurve(controlPoints: Point[]): Point[] {
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
     * Calculate minimum distance from a point to any water body edge.
     */
    distanceToWater(point: Point): number {
        let minDist = Infinity;

        for (const water of this.waterBodies) {
            const polygon = water.points;
            for (let i = 0; i < polygon.length; i++) {
                const p1 = polygon[i];
                const p2 = polygon[(i + 1) % polygon.length];
                const dist = this.pointToSegmentDist(point, p1, p2);
                if (dist < minDist) {
                    minDist = dist;
                }
            }
        }

        return minDist;
    }

    private pointToSegmentDist(point: Point, p1: Point, p2: Point): number {
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const lengthSq = dx * dx + dy * dy;

        if (lengthSq === 0) {
            return Math.sqrt((point.x - p1.x) ** 2 + (point.y - p1.y) ** 2);
        }

        let t = ((point.x - p1.x) * dx + (point.y - p1.y) * dy) / lengthSq;
        t = Math.max(0, Math.min(1, t));

        const projX = p1.x + t * dx;
        const projY = p1.y + t * dy;

        return Math.sqrt((point.x - projX) ** 2 + (point.y - projY) ** 2);
    }
}
