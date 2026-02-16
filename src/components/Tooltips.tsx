import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { KnowledgeEntry } from '../data/knowledge_base';

// Portal component to render tooltips outside the scrollable container
const Portal = ({ children }: { children: React.ReactNode }) => {
    return createPortal(children, document.body);
};

export const InfoTooltip = ({ text }: { text: string }) => {
    const [isVisible, setIsVisible] = useState(false);
    const [position, setPosition] = useState({ x: 0, y: 0 });
    const triggerRef = useRef<HTMLDivElement>(null);

    const handleMouseEnter = () => {
        if (triggerRef.current) {
            const rect = triggerRef.current.getBoundingClientRect();
            setPosition({
                x: rect.right + 10, // 10px offset to the right
                y: rect.top
            });
            setIsVisible(true);
        }
    };

    return (
        <>
            <div
                ref={triggerRef}
                onMouseEnter={handleMouseEnter}
                onMouseLeave={() => setIsVisible(false)}
                className="inline-flex items-center justify-center w-4 h-4 ml-2 rounded-full border border-gray-600 bg-gray-800 text-[10px] text-gray-400 cursor-help hover:border-cyan-500 hover:text-cyan-400 transition-colors"
                aria-label="More info"
            >
                i
            </div>
            {isVisible && (
                <Portal>
                    <div
                        className="fixed z-[9999] max-w-xs p-2 text-xs text-gray-200 bg-gray-900 border border-gray-700 rounded shadow-xl pointer-events-none animate-in fade-in zoom-in duration-200"
                        style={{
                            left: position.x,
                            top: position.y,
                            transform: 'translateY(-50%)' // Center vertically relative to trigger
                        }}
                    >
                        {text}
                        {/* Little triangle pointer (optional, css border hack) */}
                        <div className="absolute top-1/2 -left-1 w-2 h-2 -mt-1 bg-gray-900 border-l border-b border-gray-700 transform rotate-45" />
                    </div>
                </Portal>
            )}
        </>
    );
};

export const SectionInfo = ({ info }: { info: KnowledgeEntry }) => {
    const [isOpen, setIsOpen] = useState(false);

    // Prevent scrolling when modal is open
    useEffect(() => {
        if (isOpen) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = '';
        }
        return () => { document.body.style.overflow = ''; };
    }, [isOpen]);

    return (
        <>
            <button
                onClick={(e) => {
                    e.stopPropagation();
                    setIsOpen(true);
                }}
                className="ml-auto mr-2 p-1.5 rounded-full hover:bg-white/10 text-gray-500 hover:text-cyan-400 transition-colors group"
                title="Detailed Information"
            >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="group-hover:scale-110 transition-transform">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="16" x2="12" y2="12"></line>
                    <line x1="12" y1="8" x2="12.01" y2="8"></line>
                </svg>
            </button>
            {isOpen && (
                <Portal>
                    {/* Backdrop */}
                    <div
                        className="fixed inset-0 bg-black/80 backdrop-blur-md z-[9998] animate-in fade-in duration-200"
                        onClick={() => setIsOpen(false)}
                    />

                    {/* Modal Card */}
                    <div
                        className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[9999] w-[90vw] max-w-2xl bg-[#131316] border border-gray-700 rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 fade-in duration-200"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Header */}
                        <div className="bg-gray-900/50 p-6 border-b border-gray-700 flex justify-between items-start">
                            <div>
                                <h3 className="text-2xl font-bold text-white bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent mb-1">
                                    {info.title}
                                </h3>
                                <p className="text-sm text-gray-400 font-medium uppercase tracking-wider">
                                    {info.subtitle}
                                </p>
                            </div>
                            <button
                                onClick={() => setIsOpen(false)}
                                className="text-gray-500 hover:text-white transition-colors p-1"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <line x1="18" y1="6" x2="6" y2="18"></line>
                                    <line x1="6" y1="6" x2="18" y2="18"></line>
                                </svg>
                            </button>
                        </div>

                        {/* Content */}
                        <div className="p-6 max-h-[70vh] overflow-y-auto custom-scrollbar">
                            <div className="space-y-8">
                                {info.sections.map((section, idx) => (
                                    <div key={idx} className="group">
                                        <h4 className="text-lg font-semibold text-cyan-200 mb-3 flex items-center">
                                            <span className="w-1.5 h-1.5 rounded-full bg-cyan-500 mr-2 group-hover:scale-150 transition-transform" />
                                            {section.heading}
                                        </h4>
                                        <div className="text-gray-300 leading-relaxed text-sm space-y-2 pl-3.5 border-l border-gray-800 ml-[3px]">
                                            {section.content.split('\n').map((line, lid) => (
                                                <p key={lid}>{line}</p>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Footer */}
                        <div className="p-4 bg-gray-900/50 border-t border-gray-700 flex justify-end">
                            <button
                                onClick={() => setIsOpen(false)}
                                className="px-6 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg text-sm font-medium transition-colors border border-gray-600 hover:border-gray-500 shadow-lg"
                            >
                                Done
                            </button>
                        </div>
                    </div>
                </Portal>
            )}
        </>
    );
};
