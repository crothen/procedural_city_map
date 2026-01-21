
import { useRef, useEffect } from 'react';
import { CityGenerator } from '../logic';

interface CityCanvasProps {
    generator: CityGenerator;
    width: number;
    height: number;
    showGrid: boolean;
}

export const CityCanvas = ({ generator, width, height, showGrid }: CityCanvasProps) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    // Initial View Logic (Center the 2000x2000 world)
    const initialScale = 0.5;
    // World Center is at (generator.params.width / 2, generator.params.height / 2) -> (1000, 1000)
    // We want World Center to be at Screen Center (width/2, height/2)
    // ScreenX = WorldX * scale + ViewX
    // width/2 = 1000 * 0.5 + ViewX
    // ViewX = width/2 - 500

    // BUT we render relative to 0,0 usually.
    // If the map is 0..2000.

    const initialX = (width / 2) - (generator.params.width * initialScale / 2);
    const initialY = (height / 2) - (generator.params.height * initialScale / 2);

    // View State (Refs to avoid re-renders during 60fps interaction)
    const viewRef = useRef({
        x: initialX,
        y: initialY,
        scale: initialScale, // Zoom out a bit by default
        isDragging: false,
        lastX: 0,
        lastY: 0
    });

    // Handle Event Listeners manually to be closer to 'passive' non-rendering updates
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        // Wheel Zoom
        const handleWheel = (e: WheelEvent) => {
            e.preventDefault();
            const zoomIntensity = 0.1;
            const delta = -Math.sign(e.deltaY);
            const scaleChange = Math.exp(delta * zoomIntensity);

            const view = viewRef.current;
            const rect = canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            // Zoom point math: newScale = oldScale * scaleChange
            // We want the point under the mouse to stay stationary.
            // (x - viewX) / viewScale = worldX
            // worldX * newScale + newViewX = x
            // => newViewX = x - worldX * newScale

            const worldX = (mouseX - view.x) / view.scale;
            const worldY = (mouseY - view.y) / view.scale;

            view.scale *= scaleChange;
            view.x = mouseX - worldX * view.scale;
            view.y = mouseY - worldY * view.scale;
        };

        // Pan Start
        const handleMouseDown = (e: MouseEvent) => {
            const view = viewRef.current;
            view.isDragging = true;
            view.lastX = e.clientX;
            view.lastY = e.clientY;
            canvas.style.cursor = 'grabbing';
        };

        // Pan Move
        const handleMouseMove = (e: MouseEvent) => {
            const view = viewRef.current;
            if (!view.isDragging) return;

            const dx = e.clientX - view.lastX;
            const dy = e.clientY - view.lastY;

            view.x += dx;
            view.y += dy;
            view.lastX = e.clientX;
            view.lastY = e.clientY;
        };

        // Pan End
        const handleMouseUp = () => {
            viewRef.current.isDragging = false;
            canvas.style.cursor = 'grab';
        };

        canvas.addEventListener('wheel', handleWheel, { passive: false });
        canvas.addEventListener('mousedown', handleMouseDown);
        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);

        return () => {
            canvas.removeEventListener('wheel', handleWheel);
            canvas.removeEventListener('mousedown', handleMouseDown);
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, []); // Bind once

    // Render Loop
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        let animationFrameId: number;

        const render = () => {
            const view = viewRef.current;

            // Clear Screen (Reset transform first)
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.fillStyle = '#111116';
            ctx.fillRect(0, 0, width, height);

            // Apply Transform
            ctx.translate(view.x, view.y);
            ctx.scale(view.scale, view.scale);

            // Draw Map Boundary (visible border)
            ctx.strokeStyle = '#333';
            ctx.lineWidth = 4;
            ctx.strokeRect(0, 0, generator.params.width, generator.params.height);

            // Draw subtle background for the map area
            ctx.fillStyle = '#0a0a0c';
            ctx.fillRect(0, 0, generator.params.width, generator.params.height);

            // Draw City Boundary (organic polygon)
            if (generator.cityBoundary.length > 2) {
                ctx.beginPath();
                ctx.moveTo(generator.cityBoundary[0].x, generator.cityBoundary[0].y);
                for (let i = 1; i < generator.cityBoundary.length; i++) {
                    ctx.lineTo(generator.cityBoundary[i].x, generator.cityBoundary[i].y);
                }
                ctx.closePath();
                ctx.strokeStyle = '#2a2a30';
                ctx.lineWidth = 2;
                ctx.setLineDash([10, 10]);
                ctx.stroke();
                ctx.setLineDash([]); // Reset dash
            }

            // Draw Water Features (before roads)
            generator.waterBodies.forEach(water => {
                if (water.points.length < 3) return;

                ctx.beginPath();
                ctx.moveTo(water.points[0].x, water.points[0].y);
                for (let i = 1; i < water.points.length; i++) {
                    ctx.lineTo(water.points[i].x, water.points[i].y);
                }
                ctx.closePath();

                // Fill with water color - no stroke to avoid overlap artifacts
                ctx.fillStyle = '#1a3a5c'; // Deep blue
                ctx.fill();
            });

            // Draw Blocks (optional visualization)
            if (generator.showBlocks && generator.blocks.length > 0) {
                generator.blocks.forEach((block) => {
                    if (block.points.length < 3) return;

                    ctx.beginPath();
                    ctx.moveTo(block.points[0].x, block.points[0].y);
                    for (let i = 1; i < block.points.length; i++) {
                        ctx.lineTo(block.points[i].x, block.points[i].y);
                    }
                    ctx.closePath();

                    // Near-white fill
                    ctx.fillStyle = 'rgba(245, 245, 250, 0.25)';
                    ctx.fill();

                    // Light outline
                    ctx.strokeStyle = 'rgba(220, 220, 230, 0.5)';
                    ctx.lineWidth = 1;
                    ctx.stroke();
                });
            }

            // Draw Grid (Optional)
            if (showGrid) {
                const gridSize = 100;
                ctx.strokeStyle = '#222';
                ctx.lineWidth = 2;
                ctx.beginPath();
                for (let x = 0; x <= 2000; x += gridSize) {
                    ctx.moveTo(x, 0);
                    ctx.lineTo(x, 2000);
                }
                for (let y = 0; y <= 2000; y += gridSize) {
                    ctx.moveTo(0, y);
                    ctx.lineTo(2000, y);
                }
                ctx.stroke();
            }

            // Draw Edges (excluding bridges)
            ctx.lineWidth = 4;
            ctx.lineCap = 'round';
            ctx.strokeStyle = '#4a6fa5'; // Blue roads

            // Batch Draw Standard Edges
            ctx.beginPath();
            generator.edges.forEach(edge => {
                // Skip bridges - we'll draw them separately
                if (generator.bridgeEdgeIds.has(edge.id)) return;

                const start = generator.nodes.get(edge.startNodeId);
                const end = generator.nodes.get(edge.endNodeId);
                if (start && end) {
                    ctx.moveTo(start.x, start.y);
                    ctx.lineTo(end.x, end.y);
                }
            });
            ctx.stroke();

            // Draw Bridges with distinct style
            if (generator.bridgeEdgeIds.size > 0) {
                ctx.beginPath();
                ctx.strokeStyle = '#8B4513'; // Brown/wooden color
                ctx.lineWidth = 6;

                generator.bridgeEdgeIds.forEach(bridgeId => {
                    const edge = generator.edges.find(e => e.id === bridgeId);
                    if (edge) {
                        const start = generator.nodes.get(edge.startNodeId);
                        const end = generator.nodes.get(edge.endNodeId);
                        if (start && end) {
                            ctx.moveTo(start.x, start.y);
                            ctx.lineTo(end.x, end.y);
                        }
                    }
                });
                ctx.stroke();

                // Draw bridge railings/edges (lighter color on sides)
                ctx.beginPath();
                ctx.strokeStyle = '#D2691E'; // Lighter brown
                ctx.lineWidth = 2;

                generator.bridgeEdgeIds.forEach(bridgeId => {
                    const edge = generator.edges.find(e => e.id === bridgeId);
                    if (edge) {
                        const start = generator.nodes.get(edge.startNodeId);
                        const end = generator.nodes.get(edge.endNodeId);
                        if (start && end) {
                            ctx.moveTo(start.x, start.y);
                            ctx.lineTo(end.x, end.y);
                        }
                    }
                });
                ctx.stroke();
            }

            // Draw Buildings
            if (generator.buildings.length > 0) {
                // Draw regular buildings first
                generator.buildings.forEach(building => {
                    if (building.points.length < 3) return;
                    if (generator.lastStepBuildingIds.has(building.id)) return; // Draw highlighted ones later

                    ctx.beginPath();
                    ctx.moveTo(building.points[0].x, building.points[0].y);
                    for (let i = 1; i < building.points.length; i++) {
                        ctx.lineTo(building.points[i].x, building.points[i].y);
                    }
                    ctx.closePath();

                    // Pantone turquoise fill
                    ctx.fillStyle = '#40c4aa';
                    ctx.fill();

                    // Darker turquoise outline
                    ctx.strokeStyle = '#2a9d8f';
                    ctx.lineWidth = 1;
                    ctx.stroke();
                });

                // Draw newly created buildings with highlight
                if (generator.lastStepBuildingIds.size > 0) {
                    generator.lastStepBuildingIds.forEach(buildingId => {
                        const building = generator.buildings.find(b => b.id === buildingId);
                        if (!building || building.points.length < 3) return;

                        ctx.beginPath();
                        ctx.moveTo(building.points[0].x, building.points[0].y);
                        for (let i = 1; i < building.points.length; i++) {
                            ctx.lineTo(building.points[i].x, building.points[i].y);
                        }
                        ctx.closePath();

                        // Highlighted building (lighter turquoise)
                        ctx.fillStyle = '#5dd9bf';
                        ctx.fill();

                        // Bright outline for new buildings
                        ctx.strokeStyle = '#ffffff';
                        ctx.lineWidth = 2;
                        ctx.stroke();
                    });
                }
            }

            // Batch Draw Highlighted Edges
            if (generator.lastStepEdgeIds.size > 0) {
                ctx.beginPath();
                ctx.strokeStyle = '#ffffff';
                ctx.shadowColor = '#ffffff';
                ctx.shadowBlur = 10;
                ctx.lineWidth = 4;

                generator.lastStepEdgeIds.forEach(edgeId => {
                    const edge = generator.edges.find(e => e.id === edgeId);
                    if (edge) {
                        const start = generator.nodes.get(edge.startNodeId);
                        const end = generator.nodes.get(edge.endNodeId);
                        if (start && end) {
                            ctx.moveTo(start.x, start.y);
                            ctx.lineTo(end.x, end.y);
                        }
                    }
                });
                ctx.stroke();
                ctx.shadowBlur = 0; // Reset
            }

            // Draw Agents
            ctx.fillStyle = '#ff003c';
            const agentRadius = 4 / Math.sqrt(view.scale); // Keep visual size relatively constant or let them scale? Let them scale naturally but maybe clamp min size.

            generator.activeAgents.forEach(agent => {
                ctx.beginPath();
                ctx.arc(agent.pos.x, agent.pos.y, agentRadius, 0, Math.PI * 2);
                ctx.fill();
            });

            animationFrameId = requestAnimationFrame(render);
        };

        render();

        return () => {
            cancelAnimationFrame(animationFrameId);
        };
    }, [generator, width, height, showGrid]); // Dependencies updated

    return (
        <canvas
            ref={canvasRef}
            width={width}
            height={height}
            className="block cursor-grab active:cursor-grabbing outline-none"
        />
    );
};
