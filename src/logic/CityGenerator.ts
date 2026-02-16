import type {
  Point,
  Node,
  Edge,
  Block,
  Building,
  WaterBody,
  Agent,
  GenerationParams,
} from "./types";
import { pointToSegmentDistance } from "./geometry";
import { WaterGenerator } from "./WaterGenerator";
import { CityBoundary } from "./CityBoundary";
import { PlotGenerator } from "./PlotGenerator";
import { BuildingGenerator } from "./BuildingGenerator";

export class CityGenerator {
  // Public state for rendering
  nodes: Map<string, Node> = new Map();
  edges: Edge[] = [];
  activeAgents: Agent[] = [];
  // Private backing field
  private _params: GenerationParams;

  get params(): GenerationParams {
    return this._params;
  }

  set params(newParams: GenerationParams) {
    this._params = newParams;
    this.waterGen.updateParams(newParams);
    this.cityBoundaryGen.updateParams(newParams);
    this.blockGen.updateParams(newParams);
    this.buildingGen.updateParams(newParams);
  }

  // Sub-generators
  private waterGen: WaterGenerator;
  private cityBoundaryGen: CityBoundary;
  private blockGen: PlotGenerator;
  private buildingGen: BuildingGenerator;

  // Bridge tracking
  bridgeEdgeIds: Set<string> = new Set();
  private bridgePositions: Point[] = [];
  private readonly maxBridgeableWidth = 60;
  private readonly minBridgeSpacing = 200;

  /**
   * Manually set the city center and regenerate boundary + initial roads.
   */
  setCityCenter(point: Point) {
    this.cityBoundaryGen.initialize(point);
    this.generate();
    // Clear buildings/plots as they are invalid now
    this.buildingGen.reset();
  }

  generate() {
    this.resetRoads();
    const center = this.cityBoundaryGen.cityCenter;
    const startNode = this.addNode(center);
    this.initializeAgents(startNode);
  }

  // Exit road tracking
  private exitRoadCount = 0;
  private readonly baseExitProbability = 0.8;
  private readonly exitProbabilityDecay = 0.5;

  // Visualization
  lastStepEdgeIds: Set<string> = new Set();

  // Counters
  private nodeIdCounter = 0;
  private edgeIdCounter = 0;
  private stepCounter = 0;
  private fillCheckInterval = 20;

  constructor(params: GenerationParams) {
    this._params = params;

    this.waterGen = new WaterGenerator(params);
    this.cityBoundaryGen = new CityBoundary(params, this.waterGen);
    this.blockGen = new PlotGenerator(
      params,
      this.waterGen,
      this.nodes,
      this.edges,
      this.bridgeEdgeIds,
      this.cityBoundaryGen.cityCenter
    );
    this.buildingGen = new BuildingGenerator(
      params,
      this.nodes,
      this.edges,
      this.blockGen.blocks,
      this.waterGen
    );

    this.reset();
  }

  // ==================== PUBLIC ACCESSORS ====================

  get waterBodies(): WaterBody[] {
    return this.waterGen.waterBodies;
  }

  get cityCenter(): Point {
    return this.cityBoundaryGen.cityCenter;
  }

  get cityRadius(): number {
    return this.cityBoundaryGen.cityRadius;
  }

  get cityCityBoundary(): Point[] {
    return this.cityBoundaryGen.cityBoundary;
  }

  getUrbanDensity(point: Point): number {
    return this.cityBoundaryGen.getUrbanDensity(point);
  }

  // Alias for backwards compatibility
  get cityBoundary(): Point[] {
    return this.cityBoundaryGen.cityBoundary;
  }

  get blocks(): Block[] {
    return this.blockGen.blocks;
  }

  get buildings(): Building[] {
    return this.buildingGen.buildings;
  }

  get courtyards(): Building[] {
    return this.buildingGen.courtyards;
  }

  get lastStepBuildingIds(): Set<string> {
    return this.buildingGen.lastStepBuildingIds;
  }

  get showBlocks(): boolean {
    return this.blockGen.showPlots;
  }

  set showBlocks(value: boolean) {
    this.blockGen.showPlots = value;
  }

  // ==================== RESET METHODS ====================

  reset() {
    this.nodes.clear();
    this.edges = [];
    this.activeAgents = [];
    this.nodeIdCounter = 0;
    this.edgeIdCounter = 0;
    this.stepCounter = 0;
    this.lastStepEdgeIds.clear();
    this.bridgeEdgeIds.clear();
    this.bridgePositions = [];
    this.exitRoadCount = 0;

    // Reset sub-generators
    this.waterGen.reset();
    this.cityBoundaryGen.reset();
    this.blockGen.reset();
    this.buildingGen.reset();

    // Generate water features first
    this.waterGen.generate();

    // Initialize city boundary
    this.cityBoundaryGen.initialize();

    // Create starting node
    const startNode = this.addNode(this.cityBoundaryGen.cityCenter);

    // Update block generator refs
    this.blockGen.updateRefs(
      this.nodes,
      this.edges,
      this.bridgeEdgeIds,
      this.cityBoundaryGen.cityCenter
    );

    // Initial agents depend on strategy
    this.initializeAgents(startNode);
  }

  resetRoads() {
    this.nodes.clear();
    this.edges = [];
    this.activeAgents = [];
    this.nodeIdCounter = 0;
    this.edgeIdCounter = 0;
    this.stepCounter = 0;
    this.lastStepEdgeIds.clear();
    this.bridgeEdgeIds.clear();
    this.bridgePositions = [];
    this.exitRoadCount = 0;

    this.blockGen.reset();
    this.buildingGen.reset();

    const startNode = this.addNode(this.cityBoundaryGen.cityCenter);

    this.blockGen.updateRefs(
      this.nodes,
      this.edges,
      this.bridgeEdgeIds,
      this.cityBoundaryGen.cityCenter
    );

    this.initializeAgents(startNode);
  }

  resetWater() {
    this.nodes.clear();
    this.edges = [];
    this.activeAgents = [];
    this.nodeIdCounter = 0;
    this.edgeIdCounter = 0;
    this.stepCounter = 0;
    this.lastStepEdgeIds.clear();
    this.bridgeEdgeIds.clear();
    this.bridgePositions = [];
    this.exitRoadCount = 0;

    this.blockGen.reset();
    this.buildingGen.reset();
    this.waterGen.reset();

    this.waterGen.generate();

    const startPoint = this.cityBoundaryGen.findValidStartPoint();
    const startNode = this.addNode(startPoint);

    this.cityBoundaryGen.cityCenter.x = startPoint.x;
    this.cityBoundaryGen.cityCenter.y = startPoint.y;
    this.cityBoundaryGen.generate();

    this.blockGen.updateRefs(
      this.nodes,
      this.edges,
      this.bridgeEdgeIds,
      this.cityBoundaryGen.cityCenter
    );

    this.initializeAgents(startNode);
  }

  resetCityBoundary() {
    this.nodes.clear();
    this.edges = [];
    this.activeAgents = [];
    this.nodeIdCounter = 0;
    this.edgeIdCounter = 0;
    this.stepCounter = 0;
    this.lastStepEdgeIds.clear();
    this.bridgeEdgeIds.clear();
    this.bridgePositions = [];
    this.exitRoadCount = 0;

    this.blockGen.reset();
    this.buildingGen.reset();

    // Re-initialize boundary, respecting any existing manual center
    this.cityBoundaryGen.initialize();

    // Sync generator center with boundary center
    const startPoint = this.cityBoundaryGen.cityCenter;
    const startNode = this.addNode(startPoint);

    // this.cityBoundaryGen.generate(); - initialize() calls generate()

    this.blockGen.updateRefs(
      this.nodes,
      this.edges,
      this.bridgeEdgeIds,
      this.cityBoundaryGen.cityCenter
    );

    this.initializeAgents(startNode);
  }

  // ==================== GENERATION METHODS ====================

  generateBlocks() {
    this.blockGen.updateRefs(
      this.nodes,
      this.edges,
      this.bridgeEdgeIds,
      this.cityBoundaryGen.cityCenter
    );
    this.blockGen.generate();
    this.buildingGen.updateRefs(this.nodes, this.edges, this.blockGen.blocks);
  }

  clearBlocks() {
    this.blockGen.clearPlots();
    this.buildingGen.clearBuildings();
  }

  startBuildingGeneration() {
    this.buildingGen.updateRefs(this.nodes, this.edges, this.blockGen.blocks);
    this.buildingGen.startGeneration();
  }

  stepBuildingGeneration(): boolean {
    return this.buildingGen.stepGeneration();
  }

  isBuildingGenerationActive(): boolean {
    return this.buildingGen.isGenerationActive();
  }

  clearBuildings() {
    this.buildingGen.clearBuildings();
  }

  toggleBlocks() {
    this.blockGen.togglePlots();
  }



  // ==================== ROAD STEPPING ====================

  private initializeAgents(startNode: Node) {
    const { strategy } = this.params;
    const startPoint = { x: startNode.x, y: startNode.y };

    if (strategy === "GRID") {
      [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2].forEach((angle) => {
        this.activeAgents.push({
          pos: startPoint,
          dir: angle,
          parentNodeId: startNode.id,
          stepsSinceBranch: 0,
        });
      });
    } else if (strategy === "RADIAL") {
      for (let i = 0; i < 8; i++) {
        this.activeAgents.push({
          pos: startPoint,
          dir: ((Math.PI * 2) / 8) * i,
          parentNodeId: startNode.id,
          type: "SPOKE",
          stepsSinceBranch: 0,
        });
      }
    } else {
      for (let i = 0; i < 3; i++) {
        const angle = ((Math.PI * 2) / 3) * i;
        this.activeAgents.push({
          pos: startPoint,
          dir: angle,
          parentNodeId: startNode.id,
          stepsSinceBranch: 0,
        });
      }
    }
  }

  step() {
    if (this.activeAgents.length === 0) return;

    this.lastStepEdgeIds.clear();

    const newAgents: Agent[] = [];
    const deadAgentsIndices: number[] = [];

    this.activeAgents.forEach((agent, index) => {
      let angle = agent.dir;

      // Handle river-following agents
      if (agent.followingRiver) {
        if (Math.random() < 0.1) {
          agent.followingRiver = false;
          const randomTurn = (Math.random() - 0.5) * Math.PI;
          angle = agent.dir + randomTurn;
        } else {
          const checkDist = this.params.segmentLength * 0.8;
          const leftPoint = {
            x: agent.pos.x + Math.cos(agent.dir - Math.PI / 2) * checkDist,
            y: agent.pos.y + Math.sin(agent.dir - Math.PI / 2) * checkDist,
          };
          const rightPoint = {
            x: agent.pos.x + Math.cos(agent.dir + Math.PI / 2) * checkDist,
            y: agent.pos.y + Math.sin(agent.dir + Math.PI / 2) * checkDist,
          };
          const waterOnLeft = this.waterGen.isPointInWater(leftPoint);
          const waterOnRight = this.waterGen.isPointInWater(rightPoint);

          if (!waterOnLeft && !waterOnRight) {
            agent.followingRiver = false;
          } else if (waterOnLeft && waterOnRight) {
            agent.followingRiver = false;
            angle += ((Math.random() > 0.5 ? 1 : -1) * Math.PI) / 2;
          } else {
            const turnAdjust = waterOnLeft ? -0.1 : 0.1;
            angle = agent.dir + turnAdjust + (Math.random() * 0.2 - 0.1);
          }
        }
      } else if (this.params.strategy === "ORGANIC") {
        angle += Math.random() * 0.4 - 0.2;
      } else if (this.params.strategy === "RADIAL") {
        if (agent.type === "RING") {
          const dx = agent.pos.x - this.params.width / 2;
          const dy = agent.pos.y - this.params.height / 2;
          const angleToCenter = Math.atan2(dy, dx);
          const t1 = angleToCenter + Math.PI / 2;
          const t2 = angleToCenter - Math.PI / 2;
          const diff1 = Math.abs(
            Math.atan2(Math.sin(agent.dir - t1), Math.cos(agent.dir - t1))
          );
          const diff2 = Math.abs(
            Math.atan2(Math.sin(agent.dir - t2), Math.cos(agent.dir - t2))
          );
          angle = diff1 < diff2 ? t1 : t2;
        }
      }

      const nextPos = {
        x: agent.pos.x + Math.cos(angle) * this.params.segmentLength,
        y: agent.pos.y + Math.sin(angle) * this.params.segmentLength,
      };

      // Bounds check
      if (
        nextPos.x < 0 ||
        nextPos.x > this.params.width ||
        nextPos.y < 0 ||
        nextPos.y > this.params.height
      ) {
        deadAgentsIndices.push(index);
        return;
      }

      // City boundary check
      const insideCity = this.cityBoundaryGen.isPointInsideCity(nextPos);
      const wasInsideCity = this.cityBoundaryGen.isPointInsideCity(agent.pos);
      const density = this.getUrbanDensity(nextPos); // Get density (0.0 - 1.0)

      if (this.params.hardCityLimit) {
        if (!insideCity && wasInsideCity) {
          const exitProbability =
            this.baseExitProbability *
            Math.pow(this.exitProbabilityDecay, this.exitRoadCount);
          if (Math.random() < exitProbability) {
            agent.stepsSinceBranch = -1000;
            this.exitRoadCount++;
          } else {
            deadAgentsIndices.push(index);
            return;
          }
        }
      } else {
        // Soft Limit logic driven by Density
        // Lower density = Higher chance of stopping
        // Density 1.0 -> Stop Prob ~0.01 (1%)
        // Density 0.0 -> Stop Prob ~0.21 (21%)
        const baseStopChance = 0.01;
        const lowDensityPenalty = Math.pow(1 - density, 3) * 0.2;
        const stopProbability = baseStopChance + lowDensityPenalty;

        if (Math.random() < stopProbability) {
          deadAgentsIndices.push(index);
          return;
        }

        // Reduce branch timer if in low density to suppress rapid growth
        if (agent.stepsSinceBranch >= 0 && density < 0.3) {
          const reduction = Math.floor((1 - density) * 2);
          if (reduction > 0) {
            agent.stepsSinceBranch = Math.max(0, agent.stepsSinceBranch - reduction);
          }
        }
      }

      // Water check
      const nextInWater = this.waterGen.isPointInWater(nextPos);
      const currentInWater = this.waterGen.isPointInWater(agent.pos);
      let isBridgeCrossing = false;

      if (nextInWater && !currentInWater) {
        const perpAngle = this.findPerpendicularCrossingAngle(agent.pos, angle);
        const crossingWidth = this.getWaterCrossingWidth(agent.pos, perpAngle);

        if (
          crossingWidth !== null &&
          crossingWidth <= this.maxBridgeableWidth
        ) {
          const bridgeProbability = this.getBridgeProbability(agent.pos);

          if (Math.random() < bridgeProbability) {
            const landingPoint = this.findLandingPoint(
              agent.pos,
              perpAngle,
              crossingWidth
            );
            if (landingPoint) {
              const bridgeStart = this.addNode(agent.pos);
              const bridgeEnd = this.addNode(landingPoint);

              this.addEdge(agent.parentNodeId, bridgeStart.id);

              const bridgeEdge = this.addEdge(bridgeStart.id, bridgeEnd.id);
              if (bridgeEdge) {
                this.bridgeEdgeIds.add(bridgeEdge.id);
                this.bridgePositions.push({
                  x: (agent.pos.x + landingPoint.x) / 2,
                  y: (agent.pos.y + landingPoint.y) / 2,
                });
              }

              agent.pos = landingPoint;
              agent.parentNodeId = bridgeEnd.id;
              agent.dir = perpAngle;
              isBridgeCrossing = true;
            }
          }
        }

        if (!isBridgeCrossing) {
          const perpAngle = this.findPerpendicularCrossingAngle(
            agent.pos,
            angle
          );
          // If we hit water and don't bridge, follow it (if getting denser) or turn?
          // Existing logic: follow river
          const riverDirection = perpAngle + Math.PI / 2;
          const turnDirection = Math.random() > 0.5 ? 0 : Math.PI;
          agent.dir = riverDirection + turnDirection;
          agent.followingRiver = true;
          return;
        }
      } else if (nextInWater) {
        deadAgentsIndices.push(index);
        return;
      }

      if (isBridgeCrossing) {
        return;
      }

      // Collision check
      let collided = false;
      let snapTargetId: string | null = null;

      const collisionRadius =
        this.params.strategy === "GRID"
          ? this.params.segmentLength * 0.9
          : this.params.segmentLength * 1.4;

      for (const [id, node] of this.nodes) {
        if (id === agent.parentNodeId) continue;

        const dx = nextPos.x - node.x;
        const dy = nextPos.y - node.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < collisionRadius) {
          snapTargetId = node.id;
          collided = true;
          break;
        }
      }

      if (collided && snapTargetId) {
        this.addEdge(agent.parentNodeId, snapTargetId);
        deadAgentsIndices.push(index);
        return;
      }

      // Create new node
      const newNode = this.addNode(nextPos);
      this.addEdge(agent.parentNodeId, newNode.id);

      agent.pos = nextPos;
      agent.dir = angle;
      agent.parentNodeId = newNode.id;
      agent.stepsSinceBranch++;

      // Branching logic driven by Density
      const roll = Math.random();
      // Only branch if inside city (or if density is high enough?)
      // Let's use density as the primary factor.

      const canBranch = agent.stepsSinceBranch >= 0;

      // Scale branching probabilities by density
      // High density -> Higher branching factor
      // Low density -> Lower branching factor
      const effectiveBranchingFactor = this.params.branchingFactor * density;

      const accumulatedProbability = canBranch
        ? 1 - Math.pow(1 - effectiveBranchingFactor, agent.stepsSinceBranch)
        : 0;
      const shouldBranch = roll < accumulatedProbability;

      if (this.params.strategy === "GRID") {
        if (shouldBranch) {
          agent.stepsSinceBranch = 0;
          const turns = [];
          const firstTurn = (Math.random() > 0.5 ? 1 : -1) * (Math.PI / 2);
          turns.push(firstTurn);

          if (density > 0.7 && Math.random() > 0.5) {
            // Double branch in high density
            turns.push(-firstTurn);
          }


          turns.forEach((turn) => {
            newAgents.push({
              pos: nextPos,
              dir: angle + turn,
              parentNodeId: newNode.id,
              stepsSinceBranch: 0,
            });
          });
        }
      } else if (this.params.strategy === "RADIAL") {
        if (agent.type === "SPOKE" && shouldBranch) {
          agent.stepsSinceBranch = 0;
          const turns = [];
          const firstTurn = (Math.random() > 0.5 ? 1 : -1) * (Math.PI / 2);
          turns.push(firstTurn);

          if (this.params.branchingFactor > 0.7 && Math.random() < 0.5) {
            turns.push(-firstTurn);
          }

          turns.forEach((turn) => {
            newAgents.push({
              pos: nextPos,
              dir: angle + turn,
              parentNodeId: newNode.id,
              type: "RING",
              stepsSinceBranch: 0,
            });
          });
        }
        if (agent.type === "RING" && Math.random() < 0.05) {
          deadAgentsIndices.push(index);
        }
      } else {
        if (shouldBranch) {
          agent.stepsSinceBranch = 0;
          const turnAngle =
            (Math.random() > 0.5 ? 1 : -1) *
            (Math.PI / 2 + (Math.random() * 0.4 - 0.2));
          newAgents.push({
            pos: nextPos,
            dir: angle + turnAngle,
            parentNodeId: newNode.id,
            stepsSinceBranch: 0,
          });
        }
      }
    });

    // Remove dead agents
    for (let i = deadAgentsIndices.length - 1; i >= 0; i--) {
      this.activeAgents.splice(deadAgentsIndices[i], 1);
    }

    this.activeAgents.push(...newAgents);

    // Periodically fill empty areas
    if (
      this.stepCounter % this.fillCheckInterval === 0 &&
      this.nodes.size > 20
    ) {
      this.fillEmptyAreas();
    }
  }

  // ==================== CLEANUP ====================

  removeEdge(edgeId: string) {
    const idx = this.edges.findIndex(e => e.id === edgeId);
    if (idx === -1) return;

    const edge = this.edges[idx];
    this.edges.splice(idx, 1);

    // Update node connections
    const n1 = this.nodes.get(edge.startNodeId);
    if (n1) {
      n1.connections = n1.connections.filter(id => id !== edge.endNodeId);
    }
    const n2 = this.nodes.get(edge.endNodeId);
    if (n2) {
      n2.connections = n2.connections.filter(id => id !== edge.startNodeId);
    }

    // Optional: Remove isolated nodes
    if (n1 && n1.connections.length === 0) this.nodes.delete(n1.id);
    if (n2 && n2.connections.length === 0) this.nodes.delete(n2.id);
  }

  pruneSpurs(): boolean {
    let removedAny = false;
    // Iterate backwards so we can remove safely
    for (let i = this.edges.length - 1; i >= 0; i--) {
      const edge = this.edges[i];
      const n1 = this.nodes.get(edge.startNodeId);
      const n2 = this.nodes.get(edge.endNodeId);

      if (!n1 || !n2) continue;

      // Check for Spur condition:
      let tip: Node | null = null;
      let root: Node | null = null;

      if (n1.connections.length === 1 && n2.connections.length >= 3) {
        tip = n1;
        root = n2;
      } else if (n2.connections.length === 1 && n1.connections.length >= 3) {
        tip = n2;
        root = n1;
      }

      if (tip && root) {
        this.removeEdge(edge.id);
        removedAny = true;
      }
    }
    return removedAny;
  }

  cleanup() {
    let iterations = 0;
    const maxIterations = 10;

    while (iterations < maxIterations) {
      // 1. Remove Spurs (Dead ends attached to junctions)
      this.pruneSpurs();

      // 2. Remove Invalid Plots
      // Pass a validator to check if we can actually build there
      this.blockGen.cleanupPlots((plot) => this.buildingGen.canFitBuilding(plot));

      // 3. Remove Empty Loops
      const edgesToRemove = this.blockGen.findEmptyRoadLoops();

      if (edgesToRemove.length > 0) {
        edgesToRemove.forEach(id => this.removeEdge(id));
        this.generateBlocks(); // Regenerate to reflect graph changes
        // Continue loop to check new state
      } else {
        // No structural changes needed.
        // If plots were removed, they stay removed.
        break;
      }
      iterations++;
    }

    // Final sync
    this.buildingGen.updateRefs(this.nodes, this.edges, this.blockGen.blocks);
  }

  // ==================== HELPER METHODS ====================

  private addNode(point: Point): Node {
    const id = `n_${this.nodeIdCounter++}`;
    const node: Node = { ...point, id, connections: [] };
    this.nodes.set(id, node);
    return node;
  }

  private addEdge(fromId: string, toId: string): Edge | null {
    if (fromId === toId) return null;
    if (
      this.edges.some(
        (e) =>
          (e.startNodeId === fromId && e.endNodeId === toId) ||
          (e.startNodeId === toId && e.endNodeId === fromId)
      )
    ) {
      return null;
    }

    const id = `e_${this.edgeIdCounter++}`;
    const edge = { id, startNodeId: fromId, endNodeId: toId };
    this.edges.push(edge);
    this.nodes.get(fromId)?.connections.push(toId);
    this.nodes.get(toId)?.connections.push(fromId);

    this.lastStepEdgeIds.add(id);

    return edge;
  }

  private getWaterCrossingWidth(
    startPoint: Point,
    angle: number
  ): number | null {
    const maxSearchDist = this.maxBridgeableWidth + 20;
    const stepSize = 2;
    const dirX = Math.cos(angle);
    const dirY = Math.sin(angle);

    let enteredWater = false;
    let waterEntryDist = 0;

    for (let dist = 0; dist <= maxSearchDist; dist += stepSize) {
      const testPoint = {
        x: startPoint.x + dirX * dist,
        y: startPoint.y + dirY * dist,
      };

      const inWater = this.waterGen.isPointInWater(testPoint);

      if (!enteredWater && inWater) {
        enteredWater = true;
        waterEntryDist = dist;
      } else if (enteredWater && !inWater) {
        return dist - waterEntryDist;
      }
    }

    return null;
  }

  private findLandingPoint(
    startPoint: Point,
    angle: number,
    crossingWidth: number
  ): Point | null {
    const dirX = Math.cos(angle);
    const dirY = Math.sin(angle);

    const searchStart = crossingWidth + 5;
    const searchEnd = crossingWidth + 30;
    const stepSize = 2;

    for (let dist = searchStart; dist <= searchEnd; dist += stepSize) {
      const testPoint = {
        x: startPoint.x + dirX * dist,
        y: startPoint.y + dirY * dist,
      };

      if (!this.waterGen.isPointInWater(testPoint)) {
        if (
          testPoint.x >= 0 &&
          testPoint.x <= this.params.width &&
          testPoint.y >= 0 &&
          testPoint.y <= this.params.height
        ) {
          return testPoint;
        }
      }
    }

    return null;
  }

  private findPerpendicularCrossingAngle(
    startPoint: Point,
    agentAngle: number
  ): number {
    let nearestSegmentStart: Point | null = null;
    let nearestSegmentEnd: Point | null = null;
    let nearestDist = Infinity;

    for (const water of this.waterGen.waterBodies) {
      const polygon = water.points;
      for (let i = 0; i < polygon.length; i++) {
        const p1 = polygon[i];
        const p2 = polygon[(i + 1) % polygon.length];
        const dist = pointToSegmentDistance(startPoint, p1, p2);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearestSegmentStart = p1;
          nearestSegmentEnd = p2;
        }
      }
    }

    if (!nearestSegmentStart || !nearestSegmentEnd) {
      return agentAngle;
    }

    const edgeDx = nearestSegmentEnd.x - nearestSegmentStart.x;
    const edgeDy = nearestSegmentEnd.y - nearestSegmentStart.y;
    const edgeLen = Math.sqrt(edgeDx * edgeDx + edgeDy * edgeDy) || 1;

    const perpAngle1 = Math.atan2(-edgeDx / edgeLen, edgeDy / edgeLen);
    const perpAngle2 = perpAngle1 + Math.PI;

    const diff1 = Math.abs(
      Math.atan2(
        Math.sin(agentAngle - perpAngle1),
        Math.cos(agentAngle - perpAngle1)
      )
    );
    const diff2 = Math.abs(
      Math.atan2(
        Math.sin(agentAngle - perpAngle2),
        Math.cos(agentAngle - perpAngle2)
      )
    );

    return diff1 < diff2 ? perpAngle1 : perpAngle2;
  }

  private getBridgeProbability(position: Point): number {
    const baseProbability = 0.7;

    if (this.bridgePositions.length === 0) {
      return baseProbability;
    }

    let minDist = Infinity;
    for (const bridgePos of this.bridgePositions) {
      const dist = Math.sqrt(
        (position.x - bridgePos.x) ** 2 + (position.y - bridgePos.y) ** 2
      );
      if (dist < minDist) {
        minDist = dist;
      }
    }

    if (minDist < this.minBridgeSpacing * 0.5) {
      return 0.05;
    } else if (minDist < this.minBridgeSpacing) {
      const t =
        (minDist - this.minBridgeSpacing * 0.5) / (this.minBridgeSpacing * 0.5);
      return 0.05 + t * (baseProbability - 0.05);
    }

    return baseProbability;
  }

  private fillEmptyAreas() {
    const minDistanceForEmpty = this.params.segmentLength * 4;
    const sampleCount = 10;
    const directionsToCheck = 8;
    const surroundedThreshold = 5;

    for (let i = 0; i < sampleCount; i++) {
      const margin = this.params.segmentLength * 2;
      const testPoint: Point = {
        x: margin + Math.random() * (this.params.width - margin * 2),
        y: margin + Math.random() * (this.params.height - margin * 2),
      };

      if (this.waterGen.isPointInWater(testPoint)) {
        continue;
      }

      const distFromCenter = Math.sqrt(
        (testPoint.x - this.cityBoundaryGen.cityCenter.x) ** 2 +
        (testPoint.y - this.cityBoundaryGen.cityCenter.y) ** 2
      );
      if (distFromCenter > this.cityBoundaryGen.cityRadius) {
        continue;
      }

      const nearestDist = this.distanceToNearestNode(testPoint);
      if (nearestDist < minDistanceForEmpty) {
        continue;
      }

      const surroundedCount = this.countSurroundingDirections(
        testPoint,
        directionsToCheck
      );
      if (surroundedCount >= surroundedThreshold) {
        this.spawnFillAgents(testPoint);
        return;
      }
    }
  }

  private distanceToNearestNode(point: Point): number {
    let minDist = Infinity;
    for (const node of this.nodes.values()) {
      const dx = point.x - node.x;
      const dy = point.y - node.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < minDist) {
        minDist = dist;
      }
    }
    return minDist;
  }

  private countSurroundingDirections(
    point: Point,
    numDirections: number
  ): number {
    const maxRayDistance = Math.max(this.params.width, this.params.height) / 2;
    const hitThreshold = this.params.segmentLength * 2;
    let hitCount = 0;

    for (let i = 0; i < numDirections; i++) {
      const angle = ((Math.PI * 2) / numDirections) * i;
      const dirX = Math.cos(angle);
      const dirY = Math.sin(angle);

      for (const node of this.nodes.values()) {
        const dx = node.x - point.x;
        const dy = node.y - point.y;

        const dot = dx * dirX + dy * dirY;
        if (dot < 0) continue;
        if (dot > maxRayDistance) continue;

        const projX = dot * dirX;
        const projY = dot * dirY;
        const perpDist = Math.sqrt((dx - projX) ** 2 + (dy - projY) ** 2);

        if (perpDist < hitThreshold) {
          hitCount++;
          break;
        }
      }
    }

    return hitCount;
  }

  private spawnFillAgents(point: Point): void {
    let nearestNode: Node | null = null;
    let nearestDist = Infinity;
    for (const node of this.nodes.values()) {
      const dx = point.x - node.x;
      const dy = point.y - node.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestNode = node;
      }
    }

    if (!nearestNode) return;

    const newNode = this.addNode(point);
    this.addEdge(newNode.id, nearestNode.id);

    const numAgents = this.params.strategy === "RADIAL" ? 4 : 3;
    for (let i = 0; i < numAgents; i++) {
      const angle = ((Math.PI * 2) / numAgents) * i + Math.random() * 0.3;
      this.activeAgents.push({
        pos: { x: point.x, y: point.y },
        dir: angle,
        parentNodeId: newNode.id,
        type: this.params.strategy === "RADIAL" ? "RING" : undefined,
        stepsSinceBranch: 0,
      });
    }
  }

  // ==================== UTILITY METHODS ====================

  isPointInWater(point: Point): boolean {
    return this.waterGen.isPointInWater(point);
  }

  isPointInsideCity(point: Point): boolean {
    return this.cityBoundaryGen.isPointInsideCity(point);
  }
}

// Re-export types and the GenerationParams interface
export type { GenerationParams } from "./types";
