export const LoadingOverlay = ({ message = "Processing..." }) => {
    return (
        <div className="absolute inset-0 bg-black/50 backdrop-blur-sm z-50 flex flex-col items-center justify-center animate-in fade-in duration-200">
            <div className="relative">
                {/* Spinner Ring */}
                <div className="w-16 h-16 border-4 border-cyan-500/30 border-t-cyan-400 rounded-full animate-spin"></div>

                {/* Inner Pulse */}
                <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-8 h-8 bg-cyan-500/20 rounded-full animate-pulse"></div>
                </div>
            </div>

            <div className="mt-4 text-cyan-400 font-mono text-lg font-bold tracking-wider animate-pulse">
                {message}
            </div>
        </div>
    );
};
