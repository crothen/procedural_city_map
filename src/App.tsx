
import { useState, useEffect, useRef, useCallback } from 'react';
import { CityCanvas } from './components/CityCanvas';
import { ControlPanel } from './components/ControlPanel';
import { CityGenerator, type GenerationParams } from './logic';

function App() {
  // Canvas size state
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  const [params, setParams] = useState<GenerationParams>({
    width: 2000, // Logical World Width (larger than screen for panning)
    height: 2000, // Logical World Height
    seed: 123,
    growthSpeed: 1,
    branchingFactor: 0.3,
    segmentLength: 8,
    strategy: 'ORGANIC',
    waterFeature: 'NONE',
    citySize: 0.7, // 70% of map by default
    hardCityLimit: false, // Soft city limits by default
    // Building generation (area-based)
    minBuildingArea: 64, // Minimum building area (8x8 pixels)
    maxBuildingArea: 625, // Maximum area before splitting (25x25 pixels)
    minEdgeLength: 4, // Minimum edge length for building sides
    minAngle: 30, // Minimum interior angle in degrees
    buildingIrregularity: 0.3, // 0-0.5, randomness of splits
    fixedBuildingDepth: 15 // Max depth from street (0 = no trimming)
  });

  const [isPlaying, setIsPlaying] = useState(false);
  const [showGrid, setShowGrid] = useState(false);
  const generatorRef = useRef<CityGenerator>(new CityGenerator(params));
  const requestRef = useRef<number | undefined>(undefined);

  const generator = generatorRef.current;

  // Sync params
  useEffect(() => {
    generator.params = params;
  }, [params]);

  // Window Resize Handler
  useEffect(() => {
    const handleResize = () => {
      if (containerRef.current) {
        setDimensions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight
        });
      }
    };

    window.addEventListener('resize', handleResize);
    handleResize(); // Initial size

    // Auto-start generation on load
    // We use a small timeout to ensure everything is ready
    setTimeout(() => {
      handleGenerateRoads();
    }, 100);

    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Force re-render counter
  const [, forceUpdate] = useState(0);

  const step = useCallback(() => {
    let didWork = false;

    // Step road generation if there are active agents (run many steps per frame)
    if (generator.activeAgents.length > 0) {
      for (let i = 0; i < 20; i++) {
        generator.step();
      }
      didWork = true;
    }

    // Also step building generation if active (run many steps per frame)
    if (generator.isBuildingGenerationActive()) {
      for (let i = 0; i < 20; i++) {
        const stillActive = generator.stepBuildingGeneration();
        if (!stillActive) break;
      }
      // Check if still active after stepping
      didWork = generator.isBuildingGenerationActive();
    }

    return didWork;
  }, []);

  const loop = useCallback(() => {
    const didWork = step();

    // Force re-render to update UI
    forceUpdate(n => n + 1);

    if (didWork) {
      requestRef.current = requestAnimationFrame(loop);
    } else {
      // Nothing more to generate - stop the loop
      setIsPlaying(false);
    }
  }, [step]);

  const startPlaying = useCallback(() => {
    if (!isPlaying) {
      setIsPlaying(true);
      requestRef.current = requestAnimationFrame(loop);
    }
  }, [isPlaying, loop]);

  const handleReset = () => {
    if (requestRef.current) cancelAnimationFrame(requestRef.current);
    setIsPlaying(false);
    generator.reset();
  };

  const handleGenerateRoads = () => {
    generator.resetRoads();
    startPlaying();
  };

  const handleGenerateCityBoundary = () => {
    generator.resetCityBoundary();
  };

  const handleGenerateWater = () => {
    generator.resetWater();
  };

  const handleGeneratePlots = () => {
    generator.generateBlocks();
    forceUpdate(n => n + 1); // Update UI to enable building generation
  };

  const handleClearPlots = () => {
    generator.clearBlocks();
    forceUpdate(n => n + 1); // Update UI
  };

  const handleGenerateBuildings = () => {
    // Start building generation - it will run incrementally in the loop
    generator.startBuildingGeneration();
    startPlaying();
  };

  const handleClearBuildings = () => {
    generator.clearBuildings();
    forceUpdate(n => n + 1); // Update UI
  };

  return (
    <div className="flex w-full h-screen bg-[#09090b] overflow-hidden">
      <ControlPanel
        params={params}
        onChange={setParams}
        onReset={handleReset}
        onGenerateRoads={handleGenerateRoads}
        onGenerateCityBoundary={handleGenerateCityBoundary}
        onGenerateWater={handleGenerateWater}
        showGrid={showGrid}
        onToggleGrid={() => setShowGrid(!showGrid)}
        showPlots={generator.showBlocks}
        onTogglePlots={() => generator.toggleBlocks()}
        onGeneratePlots={handleGeneratePlots}
        onClearPlots={handleClearPlots}
        onGenerateBuildings={handleGenerateBuildings}
        onClearBuildings={handleClearBuildings}
        buildingCount={generator.buildings.length}
        plotCount={generator.blocks.length}
        isBuildingGenerating={generator.isBuildingGenerationActive()}
      />

      <div ref={containerRef} className="flex-1 relative">
        {dimensions.width > 0 && (
          <CityCanvas
            generator={generator}
            width={dimensions.width}
            height={dimensions.height}
            showGrid={showGrid}
          />
        )}
        <div className="absolute create-pointer-events-none bottom-4 right-4 text-white/30 text-xs font-mono bg-black/40 px-3 py-1 rounded backdrop-blur-sm pointer-events-none">
          Agents: {generator.activeAgents.length} • Nodes: {generator.nodes.size} • Plots: {generator.blocks.length} • Buildings: {generator.buildings.length}
        </div>
      </div>
    </div>
  );
}

export default App;
