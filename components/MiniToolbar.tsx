import React from 'react';

interface MiniToolbarProps {
  x: number;
  y: number;
  onDelete: () => void;
}

export const MiniToolbar: React.FC<MiniToolbarProps> = ({ x, y, onDelete }) => {
  return (
    <div 
      className="fixed z-50 flex items-center bg-white rounded-lg shadow-[0_4px_12px_rgba(0,0,0,0.15)] border border-gray-100 p-1.5 animate-in fade-in slide-in-from-bottom-2 duration-200"
      style={{
        left: x,
        top: y,
        transform: 'translate(-50%, -100%) translateY(-12px)'
      }}
    >
      <button 
        onClick={onDelete}
        className="p-2 text-red-500 hover:bg-red-50 rounded-md transition-colors group relative"
        title="Delete"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 6h18"></path>
          <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>
          <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
        </svg>
      </button>
    </div>
  );
};