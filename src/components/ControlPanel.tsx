
import { useState } from 'react';
import type { GenerationParams } from '../logic';

interface ControlPanelProps {
    params: GenerationParams;
    onChange: (newParams: GenerationParams) => void;
    onReset: () => void;
    onGenerateRoads: () => void;
    onGenerateCityBoundary: () => void;
    onGenerateWater: () => void;
    showGrid: boolean;
    onToggleGrid: () => void;
    showPlots: boolean;
    onTogglePlots: () => void;
    onGeneratePlots: () => void;
    onClearPlots: () => void;
    onGenerateBuildings: () => void;
    onClearBuildings: () => void;
    buildingCount: number;
    plotCount: number;
    isBuildingGenerating: boolean;
}

// Collapsible card section
const CollapsibleCard = ({ title, children, color = 'cyan', defaultOpen = true }: {
    title: string;
    children: React.ReactNode;
    color?: string;
    defaultOpen?: boolean;
}) => {
    const [isOpen, setIsOpen] = useState(defaultOpen);

    const headerColors: Record<string, string> = {
        cyan: 'bg-cyan-500/10 border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/20',
        purple: 'bg-purple-500/10 border-purple-500/30 text-purple-400 hover:bg-purple-500/20',
        amber: 'bg-amber-500/10 border-amber-500/30 text-amber-400 hover:bg-amber-500/20',
        blue: 'bg-blue-500/10 border-blue-500/30 text-blue-400 hover:bg-blue-500/20',
    };

    return (
        <div className="bg-gray-900/50 rounded-lg border border-white/5 overflow-hidden mb-3">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={`w-full px-3 py-2 flex items-center justify-between transition-colors ${headerColors[color]} ${isOpen ? 'border-b' : ''}`}
            >
                <h3 className="text-sm font-bold uppercase tracking-wider">{title}</h3>
                <svg
                    className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
            </button>
            {isOpen && (
                <div className="p-3">
                    {children}
                </div>
            )}
        </div>
    );
};

// Toggle component (compact)
const Toggle = ({ label, checked, onChange, color = 'cyan' }: {
    label: string;
    checked: boolean;
    onChange: () => void;
    color?: string;
}) => {
    const colorClasses: Record<string, string> = {
        cyan: 'bg-cyan-500',
        purple: 'bg-purple-500',
        orange: 'bg-orange-500',
        amber: 'bg-amber-500',
    };

    return (
        <div className="flex items-center justify-between py-1">
            <label className="text-sm text-gray-400 cursor-pointer" onClick={onChange}>
                {label}
            </label>
            <div
                onClick={onChange}
                className={`w-10 h-5 rounded-full cursor-pointer relative transition-colors ${checked ? colorClasses[color] : 'bg-gray-700'}`}
            >
                <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${checked ? 'translate-x-5' : 'translate-x-0'}`} />
            </div>
        </div>
    );
};

// Compact slider component
const Slider = ({ label, value, min, max, step, onChange, color = 'cyan', unit = '' }: {
    label: string;
    value: number;
    min: number;
    max: number;
    step: number;
    onChange: (value: number) => void;
    color?: string;
    unit?: string;
}) => {
    const colorClasses: Record<string, string> = {
        cyan: 'text-cyan-400 accent-cyan-400',
        purple: 'text-purple-400 accent-purple-500',
        green: 'text-green-400 accent-green-400',
        orange: 'text-orange-400 accent-orange-400',
        blue: 'text-blue-400 accent-blue-400',
        emerald: 'text-emerald-400 accent-emerald-400',
    };

    const displayValue = step < 1 ? value.toFixed(2) : Math.round(value);

    return (
        <div>
            <div className="flex justify-between mb-1">
                <label className="text-sm text-gray-500">{label}</label>
                <span className={`text-sm font-mono ${colorClasses[color]}`}>{displayValue}{unit}</span>
            </div>
            <input
                type="range"
                min={min}
                max={max}
                step={step}
                value={value}
                onChange={(e) => onChange(parseFloat(e.target.value))}
                className={`w-full h-2.5 bg-gray-700 rounded appearance-none cursor-pointer ${colorClasses[color]}`}
            />
        </div>
    );
};

// Compact select component
const Select = ({ label, value, options, onChange }: {
    label: string;
    value: string;
    options: { value: string; label: string }[];
    onChange: (value: string) => void;
}) => (
    <div>
        <label className="text-sm text-gray-500 mb-1 block">{label}</label>
        <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 text-white rounded px-2 py-2 text-sm focus:border-cyan-500 outline-none"
        >
            {options.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
        </select>
    </div>
);

// Small button
const SmallButton = ({ children, onClick, variant = 'default', disabled = false, className = '' }: {
    children: React.ReactNode;
    onClick: () => void;
    variant?: 'default' | 'primary' | 'danger' | 'success';
    disabled?: boolean;
    className?: string;
}) => {
    const variants: Record<string, string> = {
        default: 'bg-gray-700/50 hover:bg-gray-600/50 text-gray-400 border-white/5',
        primary: 'bg-cyan-900/40 hover:bg-cyan-800/50 text-cyan-400 border-cyan-500/30',
        danger: 'bg-red-900/30 hover:bg-red-800/40 text-red-400 border-red-500/20',
        success: 'bg-emerald-900/40 hover:bg-emerald-800/50 text-emerald-400 border-emerald-500/30',
    };

    return (
        <button
            onClick={onClick}
            disabled={disabled}
            className={`px-3 py-2 rounded text-sm font-medium transition-colors border disabled:opacity-40 disabled:cursor-not-allowed ${variants[variant]} ${className}`}
        >
            {children}
        </button>
    );
};

export const ControlPanel = ({
    params,
    onChange,
    onReset,
    onGenerateRoads,
    onGenerateCityBoundary,
    onGenerateWater,
    showGrid,
    onToggleGrid,
    showPlots,
    onTogglePlots,
    onGeneratePlots,
    onClearPlots,
    onGenerateBuildings,
    onClearBuildings,
    buildingCount,
    plotCount,
    isBuildingGenerating
}: ControlPanelProps) => {

    const handleChange = (key: keyof GenerationParams, value: number | string | boolean) => {
        onChange({ ...params, [key]: value });
    };

    const hasPlots = plotCount > 0;
    const hasBuildings = buildingCount > 0;

    return (
        <div className="w-[360px] h-full bg-[#0d0d10] border-r border-white/10 p-5 text-white flex flex-col shadow-xl z-10 flex-shrink-0 overflow-y-auto">
            <h2 className="text-2xl font-bold mb-4 bg-gradient-to-r from-cyan-400 to-purple-500 bg-clip-text text-transparent">
                City Generator
            </h2>

            {/* City Settings */}
            <CollapsibleCard title="City Settings" color="purple">
                <Slider
                    label="City Size"
                    value={params.citySize * 100}
                    min={20} max={100} step={5}
                    onChange={(v) => handleChange('citySize', v / 100)}
                    color="orange"
                    unit="%"
                />
                <Toggle
                    label="Hard City Limit (Walled)"
                    checked={params.hardCityLimit}
                    onChange={() => handleChange('hardCityLimit', !params.hardCityLimit)}
                    color="orange"
                />
                <SmallButton onClick={onGenerateCityBoundary} variant="primary" className="w-full mt-2">
                    Generate City Limits
                </SmallButton>
                <Select
                    label="Water Feature"
                    value={params.waterFeature}
                    options={[
                        { value: 'NONE', label: 'None' },
                        { value: 'RIVER', label: 'River' },
                        { value: 'COAST', label: 'Coast' },
                        { value: 'LAKE', label: 'Lake' },
                    ]}
                    onChange={(v) => handleChange('waterFeature', v)}
                />
                <SmallButton onClick={onGenerateWater} variant="primary" className="w-full mt-2">
                    Generate Water
                </SmallButton>
            </CollapsibleCard>

            {/* Road Generation */}
            <CollapsibleCard title="Roads" color="cyan">
                <Select
                    label="Strategy"
                    value={params.strategy}
                    options={[
                        { value: 'ORGANIC', label: 'Organic' },
                        { value: 'GRID', label: 'Grid' },
                        { value: 'RADIAL', label: 'Radial' },
                    ]}
                    onChange={(v) => handleChange('strategy', v)}
                />
                <Slider
                    label="Branching"
                    value={params.branchingFactor}
                    min={0} max={1} step={0.01}
                    onChange={(v) => handleChange('branchingFactor', v)}
                    color="cyan"
                />
                <Slider
                    label="Segment Length"
                    value={params.segmentLength}
                    min={5} max={50} step={1}
                    onChange={(v) => handleChange('segmentLength', v)}
                    color="green"
                />
                <SmallButton onClick={onGenerateRoads} variant="primary" className="w-full mt-2">
                    Generate Roads
                </SmallButton>
            </CollapsibleCard>

            {/* Buildings */}
            <CollapsibleCard title="Buildings" color="amber">
                {/* Plots Row */}
                <div className="flex items-center gap-2 mb-3 pb-3 border-b border-white/5">
                    <span className="text-sm text-gray-400 flex-shrink-0">Plots</span>
                    <span className="text-sm font-mono text-amber-400 bg-amber-500/10 px-2 py-1 rounded">{plotCount}</span>
                    <div className="flex-1" />
                    <SmallButton onClick={onGeneratePlots} variant="primary" className="!bg-amber-900/40 !text-amber-400 !border-amber-500/30 hover:!bg-amber-800/50">
                        Generate
                    </SmallButton>
                    <SmallButton onClick={onClearPlots} disabled={!hasPlots}>
                        Clear
                    </SmallButton>
                </div>

                <Toggle
                    label="Show Plots"
                    checked={showPlots}
                    onChange={onTogglePlots}
                    color="amber"
                />
                <Slider
                    label="Min Building Area"
                    value={params.minBuildingArea}
                    min={16} max={400} step={8}
                    onChange={(v) => handleChange('minBuildingArea', v)}
                    color="blue"
                    unit="m²"
                />
                <Slider
                    label="Max Building Area"
                    value={params.maxBuildingArea}
                    min={100} max={2500} step={25}
                    onChange={(v) => handleChange('maxBuildingArea', v)}
                    color="emerald"
                    unit="m²"
                />
                <Slider
                    label="Min Edge Length"
                    value={params.minEdgeLength}
                    min={1} max={10} step={0.5}
                    onChange={(v) => handleChange('minEdgeLength', v)}
                    color="cyan"
                    unit="m"
                />
                <Slider
                    label="Min Angle"
                    value={params.minAngle}
                    min={10} max={60} step={5}
                    onChange={(v) => handleChange('minAngle', v)}
                    color="purple"
                    unit="°"
                />
                <Slider
                    label="Irregularity"
                    value={params.buildingIrregularity}
                    min={0} max={0.5} step={0.05}
                    onChange={(v) => handleChange('buildingIrregularity', v)}
                    color="orange"
                />
                <Slider
                    label="Building Depth"
                    value={params.fixedBuildingDepth}
                    min={0} max={40} step={1}
                    onChange={(v) => handleChange('fixedBuildingDepth', v)}
                    color="green"
                    unit="m"
                />

                {/* Buildings Row */}
                <div className="flex items-center gap-2 mt-3 pt-3 border-t border-white/5">
                    <span className="text-sm text-gray-400 flex-shrink-0">Buildings</span>
                    <span className="text-sm font-mono text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded">{buildingCount}</span>
                    <div className="flex-1" />
                    <SmallButton
                        onClick={onGenerateBuildings}
                        disabled={!hasPlots || isBuildingGenerating}
                        variant="success"
                        className={!hasPlots ? '!opacity-40' : ''}
                    >
                        {isBuildingGenerating ? 'Running...' : 'Generate'}
                    </SmallButton>
                    <SmallButton onClick={onClearBuildings} disabled={!hasBuildings}>
                        Clear
                    </SmallButton>
                </div>
                {!hasPlots && (
                    <p className="text-xs text-gray-600 mt-1 text-right">Generate plots first</p>
                )}
            </CollapsibleCard>

            {/* View Options */}
            <CollapsibleCard title="View" color="blue" defaultOpen={false}>
                <Toggle
                    label="Show Grid"
                    checked={showGrid}
                    onChange={onToggleGrid}
                    color="cyan"
                />
            </CollapsibleCard>

            {/* Reset All */}
            <button
                onClick={onReset}
                className="w-full py-3 bg-gray-800 hover:bg-gray-700 rounded-lg font-semibold text-base text-gray-300 transition-colors border border-white/5 mt-auto"
            >
                RESET ALL
            </button>

            <div className="mt-3 text-xs text-gray-600 font-mono text-center">
                Pan: Drag • Zoom: Scroll
            </div>
        </div>
    );
};
