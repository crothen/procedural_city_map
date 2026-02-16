# Map Cleanup System Reference

## Overview
The cleanup system is a recursive process designed to remove invalid geometry (tiny plots, artifacts) and repair the road network (removing dead ends and empty loops). It runs iteratively until the map stabilizes or a maximum iteration count is reached.

## The Recursive Loop
Located in `CityGenerator.ts`, the `cleanup()` method executes the following steps in a loop (max 10 iterations):

1.  **Prune Spurs**: Removes short dead-end roads attached to junctions to clean up block interiors.
2.  **Cleanup Plots**: Filters out plots that are too small, too thin, or unbuildable.
3.  **Find Empty Loops**: Identifies closed road loops that contain no valid plots.
4.  **Break Loops**: Removes the longest edge of an empty loop to open the space.
5.  **Regenerate**: Re-runs the block generator to fill the newly opened space (if possible).

## 1. Spur Removal (`pruneSpurs`)
- **Definition**: An edge is a "Spur" if one node is a **Tip** (Degree 1) and the other is a **Junction** (Degree ≥ 3).
- **Action**: The edge is removed.
- **Goal**: Cleans up "intrusions" where a road pokes into a block but doesn't connect to anything, often caused by the organic growth algorithm terminating early.

## 2. Plot Cleanup (`cleanupPlots`)
- **Location**: `PlotGenerator.ts`
- **Criteria**: A plot is kept ONLY if it passes ALL checks:
    - **Area**: `> minBuildingArea`
    - **Width**: OBB (Oriented Bounding Box) width `> minEdgeLength`
    - **Enclosure**: If it's an "Urban Core" plot, it must be valid (convex-ish headers).
    - **Building Viability (Advanced)**:
        - The system runs a "Dry Run" of the `BuildingGenerator`.
        - It attempts to subdivide the plot and fit a building.
        - **Strict Checks**: The candidate building polygon is validated for **Area**, **Min Edge Length**, and **Min Angle** (defaults to ~20 degrees).
        - If NO valid building can fit, the plot is deleted.

## 3. Empty Loop Detection (`findEmptyRoadLoops`)
- **Location**: `PlotGenerator.ts`
- **Logic**:
    - Traces every "Face" (closed loop) in the graph.
    - Checks if any half-edge belonging to that face is marked as "Occupied" by a valid plot.
    - If a loop has **Zero Occupied Edges**, it is an "Empty Loop".
- **Action**: The system identifies the **Longest Edge** in the loop and marks it for removal.
- **Goal**: Merge the empty space with a neighbor to potentially create a larger, buildable area.

## UI Integration
- **Async Execution**: The cleanup process is CPU-intensive. It is wrapped in a `setTimeout` to allow the React `LoadingOverlay` to render before processing starts.
- **State**: `isProcessing` disables UI controls during execution.
