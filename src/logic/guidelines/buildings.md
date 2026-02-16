# Building Generation System

This document serves as the reference guide for the **Building Generation** system. The system receives defined **Plots** (buildable areas) from the Plot Generator and is solely responsible for populating them with structures.

## 1. Input: Plots
The Building Generator operates on `Plot` polygons provided by the upstream system.

```typescript
interface Plot extends Block {
  roadIds: string[]; // IDs of frontage roads
  type: "URBAN_CORE" | "SUBURBAN_STRIP";
  isEnclosed: boolean;
}
```

## 2. Building Generation Logic
**Source**: `BuildingGenerator.ts`

The generator processes each plot to create individual `Building` objects using recursive subdivision and geometric validation.

### 2.1 Smart Subdivision (Block -> Lots)
**Function**: `smartSubdivide`
*   **Strategy**: Recursive Oriented Bounding Box (OBB) splitting.
*   **Road Alignment**:
    *   The algorithm identifies the closest road edge to the plot.
    *   Splits are aligned **perpendicular** to the road vector to maximize street frontage.
    *   If no road is detected (landlocked), it splits along the shortest axis to maintain aspect ratio.
*   **Recursion**: Continues until the sub-lot is smaller than `maxBuildingArea`.
*   **Irregularity**: Applies a randomized offset (`buildingIrregularity`) to the split line to prevent perfect grids.

### 2.2 Geometric Processing
**Function**: `trimBuilding` & `simplifyShape`
1.  **Depth Trimming**:
    *   Validates the depth of the lot against `fixedBuildingDepth`.
    *   Cuts the polygon at the max depth from the road frontage.
    *   **Scraps**: The rear portion of the lot becomes "Scrap" (often converted to Courtyard/Backyard space).
2.  **Simplification**:
    *   Removes collinear vertices and noise (< 2px deviation) to ensure clean rendering.

### 2.3 Placement Validation
**Function**: `canFitBuilding` & `addBuilding`
*   **Constraints**:
    *   `minBuildingArea`: Discards tiny artifacts.
    *   `minEdgeLength`: Discards sliver polygons.
    *   `WaterGenerator`: Ensures no part of the building intersects water.
*   **Spatial Hashing**:
    *   Uses a grid-based Spatial Hash (`buildingGridSize = 50`) to perform efficient implementation of collision detection.
    *   Prevents overlapping structures.

## 3. Data Structures
### Building
```typescript
interface Building {
  id: string;
  points: Point[];
  centroid: Point;
}
```
