export type GenerationStrategy = 'ORGANIC' | 'GRID' | 'RADIAL';
export type WaterFeature = 'NONE' | 'RIVER' | 'COAST' | 'LAKE';

export interface Point {
    x: number;
    y: number;
}

export interface Node extends Point {
    id: string;
    connections: string[]; // IDs of connected nodes
}

export interface Edge {
    id: string;
    startNodeId: string;
    endNodeId: string;
}

// Water is represented as a polygon (array of points)
export interface WaterBody {
    type: WaterFeature;
    points: Point[]; // Polygon vertices
}

// Building footprint
export interface Building {
    id: string;
    points: Point[]; // Polygon vertices (clockwise)
    centroid: Point;
}

// City block - enclosed area surrounded by roads
export interface Block {
    id: string;
    points: Point[]; // Polygon vertices
    isEnclosed: boolean; // true if fully surrounded by roads, false if buffer zone
    area: number;
    roadIds: string[]; // IDs of edges that define street frontage
}

export interface GenerationParams {
    width: number;
    height: number;
    seed: number;
    growthSpeed: number; // Pixels per step (or steps per frame)
    branchingFactor: number; // 0-1 probability
    segmentLength: number;
    strategy: GenerationStrategy;
    waterFeature: WaterFeature;
    citySize: number; // 0-1, percentage of map the city should fill
    hardCityLimit: boolean; // true = roads stop at boundary, false = gradual density decline
    outerCityFalloff: number; // 0-1, additional area for outer city gradient (relative to map size)
    outerCityRandomness: number; // 0-1, how much noise affects the gradient falloff
    showCityLimitGradient: boolean; // Debug visualization
    // Water params
    riverWidth: number; // Width of the main river in meters
    // Building generation params (area-based)
    minBuildingArea: number; // Minimum building area in square pixels
    maxBuildingArea: number; // Maximum building area before splitting
    minEdgeLength: number; // Minimum edge length for building sides (pixels)
    minAngle: number; // Minimum interior angle in degrees (e.g., 30)
    buildingIrregularity: number; // 0-0.5, randomness of subdivision splits
    fixedBuildingDepth: number; // Max depth from street edge (0 = no trimming)
}

export interface Agent {
    pos: Point;
    dir: number;
    parentNodeId: string;
    type?: 'SPOKE' | 'RING'; // For radial
    stepsSinceBranch: number; // Track steps since last branch for accumulative probability
    followingRiver?: boolean; // Agent is following along a river edge
}
