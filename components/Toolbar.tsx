import React from 'react';
import { ToolType, COLORS, STROKE_WIDTHS } from '../types';

interface ToolbarProps {
  activeTool: ToolType;
  setActiveTool: (tool: ToolType) => void;
  activeColor: string;
  setActiveColor: (color: string) => void;
  activeStrokeWidth: number;
  setActiveStrokeWidth: (width: number) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUploadClick: () => void;
}

const IconButton: React.FC<{ 
  active?: boolean; 
  onClick: () => void; 
  children: React.ReactNode;
  title?: string;
  disabled?: boolean;
}> = ({ active, onClick, children, title, disabled }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    title={title}
    className={`p-1.5 rounded-md transition-all duration-200 flex items-center justify-center
      ${active 
        ? 'bg-blue-100 text-blue-600 shadow-inner' 
        : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'}
      ${disabled ? 'opacity-40 cursor-not-allowed' : ''}
    `}
  >
    {children}
  </button>
);

export const Toolbar: React.FC<ToolbarProps> = ({
  activeTool,
  setActiveTool,
  activeColor,
  setActiveColor,
  activeStrokeWidth,
  setActiveStrokeWidth,
  undo,
  redo,
  canUndo,
  canRedo,
  onUploadClick,
}) => {
  return (
    <div className="fixed left-3 top-1/2 -translate-y-1/2 flex flex-col gap-3 z-50 select-none">
      {/* Tools Group */}
      <div className="bg-white p-1.5 rounded-lg shadow-[0_2px_15px_rgba(0,0,0,0.08)] border border-gray-200 flex flex-col gap-0.5">
        
        <IconButton 
          active={activeTool === ToolType.SELECT} 
          onClick={() => setActiveTool(ToolType.SELECT)}
          title="Cursor / Select (V)"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/>
          </svg>
        </IconButton>

        <IconButton 
          active={activeTool === ToolType.HAND} 
          onClick={() => setActiveTool(ToolType.HAND)}
          title="Hand / Pan (H)"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0"/>
            <path d="M14 10V4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v2"/>
            <path d="M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v8"/>
            <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>
          </svg>
        </IconButton>
        
        <div className="h-px bg-gray-100 my-0.5 mx-1" />

        <IconButton 
          active={activeTool === ToolType.RECTANGLE} 
          onClick={() => setActiveTool(ToolType.RECTANGLE)}
          title="Rectangle (R)"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/></svg>
        </IconButton>

        <IconButton 
          active={activeTool === ToolType.CIRCLE} 
          onClick={() => setActiveTool(ToolType.CIRCLE)}
          title="Circle (C)"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/></svg>
        </IconButton>

        <IconButton 
          active={activeTool === ToolType.TRIANGLE} 
          onClick={() => setActiveTool(ToolType.TRIANGLE)}
          title="Triangle (T)"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3L22 21H2L12 3z" /></svg>
        </IconButton>

        <IconButton 
          active={activeTool === ToolType.ARROW} 
          onClick={() => setActiveTool(ToolType.ARROW)}
          title="Arrow (A)"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
        </IconButton>

        <IconButton 
          active={activeTool === ToolType.PENCIL} 
          onClick={() => setActiveTool(ToolType.PENCIL)}
          title="Pencil (P)"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
        </IconButton>

        <IconButton 
          active={activeTool === ToolType.LASER} 
          onClick={() => setActiveTool(ToolType.LASER)}
          title="Laser Pointer (L)"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
          </svg>
        </IconButton>

        <IconButton 
          active={activeTool === ToolType.UPLOAD} 
          onClick={onUploadClick}
          title="Upload Image/Screenshot (U)"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
            <circle cx="8.5" cy="8.5" r="1.5"/>
            <polyline points="21 15 16 10 5 21"/>
          </svg>
        </IconButton>

        <div className="h-px bg-gray-100 my-0.5 mx-1" />

        <IconButton 
          active={activeTool === ToolType.ERASER} 
          onClick={() => setActiveTool(ToolType.ERASER)}
          title="Eraser (E)"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 20H7L3 16C2 15 2 13 3 12L13 2L22 11L20 20Z"/><path d="M17 17L7 7"/></svg>
        </IconButton>
      </div>

      {/* Styles Group */}
      <div className="bg-white p-2 rounded-lg shadow-[0_2px_15px_rgba(0,0,0,0.08)] border border-gray-200 flex flex-col gap-2 items-center">
        <div className="flex flex-col gap-1.5">
           {COLORS.map(color => (
             <button
               key={color}
               onClick={() => setActiveColor(color)}
               className={`w-5 h-5 rounded-full border-2 transition-transform hover:scale-110 ${activeColor === color ? 'border-gray-900 scale-110' : 'border-transparent'}`}
               style={{ backgroundColor: color }}
               title={color}
             />
           ))}
        </div>
        <div className="w-full h-px bg-gray-100" />
        <div className="flex flex-col gap-1.5 w-full items-center">
           {STROKE_WIDTHS.map(width => (
             <button
                key={width}
                onClick={() => setActiveStrokeWidth(width)}
                className={`w-7 h-7 flex items-center justify-center rounded-md hover:bg-gray-50 ${activeStrokeWidth === width ? 'bg-gray-100' : ''}`}
             >
               <div 
                className="bg-gray-800 rounded-full"
                style={{ width: width * 2, height: width * 2 }} 
               />
             </button>
           ))}
        </div>
      </div>

      {/* History Group */}
      <div className="bg-white p-1 rounded-lg shadow-[0_2px_15px_rgba(0,0,0,0.08)] border border-gray-200 flex flex-col gap-0.5">
        <IconButton onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg>
        </IconButton>
        <IconButton onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Y)">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13"/></svg>
        </IconButton>
      </div>
    </div>
  );
};