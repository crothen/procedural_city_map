
# Plot Generation Guide

This document outlines the logic, strategies, and constraints used in the `PlotGenerator` system.

## 1. Core Concepts

The generator creates "Blocks" (Plots) representing land parcels. It does **not** subdivide them into individual building lots; that responsibility lies with the `BuildingGenerator`.

### Two Main Generation Modes

1.  **Urban Core (Enclosed Plots)**
    *   **Logic**: Identifies closed loops (cycles) in the road network graph using a "Face Tracing" algorithm (always turning left).
    *   **Target Area**: Downtown / High-density centers where roads form grids.
    *   **Geometry**: The polygon is defined by the road centerlines, then shrunk inward (2.0m) to create sidewalks.
    *   **Occupancy**: Marks the **inner** half-edges of the road loop as "Occupied". The outer sides remain free for other types of generation.

2.  **Suburban Strips (Filament Plots)**
    *   **Logic**: Iterates over road edges that are *not* part of an Urban Core loop.
    *   **Target Area**: Suburbs, long arterial roads, sparse areas.
    *   **Geometry**: "Extrudes" a strip parallel to the road.
        *   **Gap**: Starts 3.0m away from the road centerline (leaving a 1.0m safety buffer against the 2.0m Downtown sidewalk).
        *   **Depth**: Typically 50m deep.
    *   **Resilience**: The `attemptStroke` function tries to generate a continuous strip along a chain of roads. If the chain fails (e.g., hits an obstacle), it falls back to generating a plot for the single current road segment.

## 2. Gap Filling & Continuity

To prevent "broken" or single-sided streets, a **Gap Filler** runs after the main pass.

### Logic
*   **Target**: Any road segment that looks "empty" on one side but "active" on the other.
*   **Neighbor Awareness**: A segment is considered a candidate if:
    *   The opposite side is occupied.
    *   **OR** it connects to a node that is part of another active street (Neighbor check).
*   **Action**: Force-generates a "Filament Plot" with slightly relaxed constraints (allows shallower depth ~30m).

## 3. Constraints & Validation

### Overlap Detection (`isValidPlot`)
*   **Mechanism**: The candidate polygon is temporarily shrunk by **0.5m**.
*   **Check**: If this slightly shrunken polygon intersects any existing plot, the candidate is rejected.
*   **Reasoning**: A small shrink buffer allows plots to touch edges (perfect align) without triggering false-positive overlaps, but prevents gross intersection.

### Dimensions
*   **Minimum Area**: 50 sq meters.
*   **Minimum Width**: **8.0 meters** (measured via Oriented Bounding Box width).
    *   *Purpose*: Prevents the creation of useless "needle" plots in narrow gaps.
*   **Winding Order**: All polygons are enforced to be **Counter-Clockwise (CCW)** before operations like shrinking to ensure consistent behavior.

### Environmental
*   **Water**: Plots (and Buildings) are checked against the `WaterGenerator`.
    *   **Centroid Check**: Plot center must be on land.
    *   **Vertex Check**: (For buildings) Every corner must be on land.

## 4. Data Structures

### `occupiedHalfEdges` (Set<string>)
*   Tracks which "side" of a road is used.
*   **Key**: `"startNodeId->endNodeId"` (Directional).
*   **Usage**:
    *   If `A->B` is in the set, the **Left** side of the road traveling from A to B is taken.
    *   This allows a single road to be Downtown on one side and Suburban on the other.

## 5. Building Integration

The `BuildingGenerator` takes these raw Blocks and:
1.  **Subdivides** them into smaller "Lots".
2.  **Validates** each Lot (`canFitBuilding` check).
3.  **Places** buildings or courtyards.
