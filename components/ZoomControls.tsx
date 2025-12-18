import React from 'react';

interface ZoomControlsProps {
  scale: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomToFit: () => void;
}

export const ZoomControls: React.FC<ZoomControlsProps> = ({ 
  scale, 
  onZoomIn, 
  onZoomOut, 
  onZoomToFit 
}) => {
  const stopPropagation = (e: React.PointerEvent | React.MouseEvent) => {
    e.stopPropagation();
  };

  return (
    <div 
      className="fixed bottom-6 right-6 flex items-center gap-3 z-50 select-none"
      onPointerDown={stopPropagation}
      onPointerMove={stopPropagation}
      onPointerUp={stopPropagation}
    >
      <span className="text-[11px] font-medium text-gray-400 pointer-events-none drop-shadow-sm">
        Created by Axmadjon
      </span>
      
      <div className="flex items-center bg-white rounded-lg shadow-[0_2px_15px_rgba(0,0,0,0.08)] border border-gray-200 p-1">
        <button
          onClick={onZoomOut}
          className="p-2 text-gray-600 hover:bg-gray-100 rounded-md transition-colors"
          title="Zoom Out"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/>
          </svg>
        </button>
        
        <div className="px-2 text-xs font-medium text-gray-500 min-w-[50px] text-center border-x border-gray-100">
          {(scale * 100).toFixed(0)}%
        </div>

        <button
          onClick={onZoomIn}
          className="p-2 text-gray-600 hover:bg-gray-100 rounded-md transition-colors"
          title="Zoom In"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/><line x1="11" y1="8" x2="11" y2="14"/>
          </svg>
        </button>

        <div className="w-px h-6 bg-gray-100 mx-1" />

        <button
          onClick={onZoomToFit}
          className="p-2 text-gray-600 hover:bg-gray-100 rounded-md transition-colors"
          title="Fit to Screen"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/>
          </svg>
        </button>
      </div>
    </div>
  );
};