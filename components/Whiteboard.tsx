import React, { useRef, useState, useEffect, useCallback } from 'react';
import { 
  ToolType, 
  WhiteboardElement, 
  ViewState, 
  Point, 
  PencilElement, 
  RectangleElement, 
  CircleElement, 
  ArrowElement,
  TriangleElement,
  LaserStroke,
  ImageElement
} from '../types';
import { 
  generateId, 
  screenToWorld, 
  worldToScreen,
  distance, 
  getSvgPathFromPoints, 
  getTriangleArea,
  getTriangleAngles,
  convertShapeToPoints,
  isElementRoughlyIntersecting
} from '../utils';
import { 
  hitTestElement, 
  getElementBounds, 
  getCommonBounds,
  doBoundsIntersect
} from '../utils/BoundsUtils';
import { useHistory } from '../hooks/useHistory';
import { Toolbar } from './Toolbar';
import { MiniToolbar } from './MiniToolbar';

const ZOOM_MIN = 0.1;
const ZOOM_MAX = 10;
const SCROLL_SENSITIVITY = 0.002;
const ERASER_RADIUS = 20;
const LASER_FADE_SPEED = 0.02;

const MathLabel = ({ x, y, children }: { x: number, y: number, children?: React.ReactNode }) => (
    <g transform={`translate(${x}, ${y})`} style={{ pointerEvents: 'none' }}>
        <rect x={-4} y={-14} width={Math.max(40, (children?.toString().length || 0) * 8)} height={20} fill="white" fillOpacity="0.8" rx={4} />
        <text x={0} y={0} fontSize="12" fontFamily="monospace" fill="#2563eb" fontWeight="bold">{children}</text>
    </g>
);

const InfoBox = ({ x, y, lines }: { x: number, y: number, lines: string[] }) => (
    <g transform={`translate(${x}, ${y})`} style={{ pointerEvents: 'none', zIndex: 100 }}>
        <rect x={-5} y={-15} width={140} height={lines.length * 16 + 8} fill="white" fillOpacity="0.95" stroke="#e5e7eb" rx={6} className="shadow-sm" />
        {lines.map((line, i) => (
            <text key={i} x={0} y={i * 16} fontSize="11" fontFamily="monospace" fill="#374151">{line}</text>
        ))}
    </g>
);

export const Whiteboard: React.FC = () => {
  const { elements, pushToHistory, undo, redo, canUndo, canRedo } = useHistory([]);
  const [view, setView] = useState<ViewState>({ x: 0, y: 0, scale: 1 });
  const [activeTool, setActiveTool] = useState<ToolType>(ToolType.SELECT);
  const [activeColor, setActiveColor] = useState<string>('#000000');
  const [activeStrokeWidth, setActiveStrokeWidth] = useState<number>(2);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState<string | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [dragStart, setDragStart] = useState<Point>({ x: 0, y: 0 });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectionBox, setSelectionBox] = useState<{start: Point, end: Point} | null>(null);
  const [laserStrokes, setLaserStrokes] = useState<LaserStroke[]>([]);
  const [currentLaserId, setCurrentLaserId] = useState<string | null>(null);
  const [triangleStep, setTriangleStep] = useState<number>(0);
  const [currentElement, setCurrentElement] = useState<WhiteboardElement | null>(null);
  const [tempElements, setTempElements] = useState<WhiteboardElement[] | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [cursorPos, setCursorPos] = useState<Point | null>(null);

  // Multi-touch tracking refs
  const activePointers = useRef<Map<number, Point>>(new Map());
  const pinchState = useRef<{
    initialDist: number;
    initialScale: number;
    worldMid: Point;
  } | null>(null);

  useEffect(() => {
    let frameId: number;
    const fade = () => {
      setLaserStrokes(prev => {
        if (prev.length === 0) return prev;
        const next = prev.map(stroke => {
          if (stroke.id === currentLaserId) return stroke;
          return { ...stroke, opacity: stroke.opacity - LASER_FADE_SPEED };
        }).filter(stroke => stroke.opacity > 0);
        return next;
      });
      frameId = requestAnimationFrame(fade);
    };
    frameId = requestAnimationFrame(fade);
    return () => cancelAnimationFrame(frameId);
  }, [currentLaserId]);

  const getElementAtPosition = (worldPos: Point): string | null => {
    const targetElements = tempElements || elements;
    for (let i = targetElements.length - 1; i >= 0; i--) {
        if (hitTestElement(targetElements[i], worldPos, view.scale)) return targetElements[i].id;
    }
    return null;
  };

  const handleWheel = (e: React.WheelEvent) => {
    const scaleChange = Math.exp(-e.deltaY * SCROLL_SENSITIVITY);
    const newScale = Math.min(Math.max(view.scale * scaleChange, ZOOM_MIN), ZOOM_MAX);
    const worldPoint = screenToWorld({ x: e.clientX, y: e.clientY }, view);
    const newX = e.clientX - worldPoint.x * newScale;
    const newY = e.clientY - worldPoint.y * newScale;
    setView({ x: newX, y: newY, scale: newScale });
  };
  
  const [dragOrigin, setDragOrigin] = useState<Point | null>(null);
  const [dragOffset, setDragOffset] = useState<Point>({x: 0, y: 0});

  const performErase = (worldPos: Point, currentList: WhiteboardElement[]): WhiteboardElement[] => {
      const radius = ERASER_RADIUS / view.scale;
      let hasChanges = false;
      const newList: WhiteboardElement[] = [];
      for (const el of currentList) {
          if (!isElementRoughlyIntersecting(el, worldPos, radius)) { newList.push(el); continue; }
          const points = convertShapeToPoints(el, 5 / view.scale); 
          const newSegments: Point[][] = [];
          let currentSegment: Point[] = [];
          for (const p of points) {
              if (distance(p, worldPos) > radius) currentSegment.push(p);
              else {
                  if (currentSegment.length > 0) { newSegments.push(currentSegment); currentSegment = []; }
              }
          }
          if (currentSegment.length > 0) newSegments.push(currentSegment);
          if (newSegments.length === 1 && newSegments[0].length === points.length) { newList.push(el); }
          else {
              hasChanges = true;
              newSegments.forEach(seg => {
                  if (seg.length > 1) { 
                      newList.push({ id: generateId(), type: 'pencil', x: seg[0].x, y: seg[0].y, points: seg, strokeColor: el.strokeColor, strokeWidth: el.strokeWidth });
                  }
              });
          }
      }
      return hasChanges ? newList : currentList;
  };

  const handlePointerDownV2 = (e: React.PointerEvent) => {
    activePointers.current.set(e.pointerId, {x: e.clientX, y: e.clientY});
    const worldPos = screenToWorld({x: e.clientX, y: e.clientY}, view);

    // Initial Pinch Setup
    if (activePointers.current.size === 2) {
      // FIX: Explicitly cast pointers to Point[] to avoid 'unknown' type issues during array conversion
      const pointers = Array.from(activePointers.current.values()) as Point[];
      const dist = distance(pointers[0], pointers[1]);
      const midPoint = { x: (pointers[0].x + pointers[1].x) / 2, y: (pointers[0].y + pointers[1].y) / 2 };
      pinchState.current = {
        initialDist: dist,
        initialScale: view.scale,
        worldMid: screenToWorld(midPoint, view)
      };
      
      // Stop other single-finger gestures
      setIsPanning(false);
      setIsDragging(false);
      setSelectionBox(null);
      return;
    }

    if (activeTool === ToolType.HAND || e.button === 1 || e.buttons === 4) {
        setIsPanning(true);
        setDragStart({ x: e.clientX, y: e.clientY });
        e.currentTarget.setPointerCapture(e.pointerId);
        return;
    }

    if (activeTool === ToolType.ERASER) {
        setIsDragging(true);
        setTempElements(elements); 
        setTempElements(performErase(worldPos, elements));
        e.currentTarget.setPointerCapture(e.pointerId);
        return;
    }

    if (activeTool === ToolType.LASER) {
      const id = generateId();
      setCurrentLaserId(id);
      setLaserStrokes(prev => [...prev, { id, points: [worldPos], opacity: 1, lastUpdate: Date.now() }]);
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }

    if (activeTool === ToolType.SELECT) {
        if (selectedIds.size === 1) {
            const id = Array.from(selectedIds)[0];
            const el = elements.find(e => e.id === id);
            if (el) {
                if (el.type === 'rectangle' || el.type === 'image') {
                    const r = el as (RectangleElement | ImageElement);
                    const br = { x: r.x + r.width, y: r.y + r.height };
                    if (distance(worldPos, br) < 15 / view.scale) { setIsResizing('rect-br'); e.currentTarget.setPointerCapture(e.pointerId); return; }
                } else if (el.type === 'circle') {
                    const c = el as CircleElement;
                    if (distance(worldPos, { x: c.x + c.radius, y: c.y }) < 15 / view.scale) { setIsResizing('circle-r'); e.currentTarget.setPointerCapture(e.pointerId); return; }
                } else if (el.type === 'arrow') {
                    const a = el as ArrowElement;
                    if (distance(worldPos, {x: a.x, y: a.y}) < 15 / view.scale) { setIsResizing('arrow-start'); e.currentTarget.setPointerCapture(e.pointerId); return; }
                    if (distance(worldPos, {x: a.endX, y: a.endY}) < 15 / view.scale) { setIsResizing('arrow-end'); e.currentTarget.setPointerCapture(e.pointerId); return; }
                } else if (el.type === 'triangle') {
                    const t = el as TriangleElement;
                    if (distance(worldPos, t.p1) < 15 / view.scale) { setIsResizing('tri-1'); e.currentTarget.setPointerCapture(e.pointerId); return; }
                    if (distance(worldPos, t.p2) < 15 / view.scale) { setIsResizing('tri-2'); e.currentTarget.setPointerCapture(e.pointerId); return; }
                    if (distance(worldPos, t.p3) < 15 / view.scale) { setIsResizing('tri-3'); e.currentTarget.setPointerCapture(e.pointerId); return; }
                }
            }
        }
        const hitId = getElementAtPosition(worldPos);
        if (hitId) {
            if (e.shiftKey) { setSelectedIds(prev => { const next = new Set(prev); if (next.has(hitId)) next.delete(hitId); else next.add(hitId); return next; }); }
            else { if (!selectedIds.has(hitId)) setSelectedIds(new Set([hitId])); }
            setIsDragging(true);
            setDragOrigin(worldPos);
            setDragOffset({x: 0, y: 0});
            e.currentTarget.setPointerCapture(e.pointerId);
        } else {
            if (!e.shiftKey) setSelectedIds(new Set());
            setSelectionBox({ start: worldPos, end: worldPos });
            e.currentTarget.setPointerCapture(e.pointerId);
        }
        return;
    }

    if (activeTool === ToolType.TRIANGLE) {
        if (!currentElement) {
            const id = generateId();
            setCurrentElement({ id, type: 'triangle', x: worldPos.x, y: worldPos.y, p1: worldPos, p2: worldPos, p3: worldPos, strokeColor: activeColor, fillColor: 'transparent', strokeWidth: activeStrokeWidth });
            setTriangleStep(1); 
        } else {
            const tri = currentElement as TriangleElement;
            if (triangleStep === 1) { setCurrentElement({ ...tri, p2: worldPos, p3: worldPos }); setTriangleStep(2); }
            else if (triangleStep === 2) { pushToHistory([...elements, { ...tri, p3: worldPos }]); setCurrentElement(null); setTriangleStep(0); }
        }
        return;
    }

    const id = generateId();
    let newEl: WhiteboardElement | null = null;
    if (activeTool === ToolType.PENCIL) newEl = { id, type: 'pencil', x: worldPos.x, y: worldPos.y, points: [worldPos], strokeColor: activeColor, strokeWidth: activeStrokeWidth };
    else if (activeTool === ToolType.RECTANGLE) newEl = { id, type: 'rectangle', x: worldPos.x, y: worldPos.y, width: 0, height: 0, strokeColor: activeColor, fillColor: 'transparent', strokeWidth: activeStrokeWidth };
    else if (activeTool === ToolType.CIRCLE) newEl = { id, type: 'circle', x: worldPos.x, y: worldPos.y, radius: 0, strokeColor: activeColor, fillColor: 'transparent', strokeWidth: activeStrokeWidth };
    else if (activeTool === ToolType.ARROW) newEl = { id, type: 'arrow', x: worldPos.x, y: worldPos.y, endX: worldPos.x, endY: worldPos.y, strokeColor: activeColor, strokeWidth: activeStrokeWidth };
    if (newEl) { setCurrentElement(newEl); e.currentTarget.setPointerCapture(e.pointerId); }
  };

  const handlePointerMoveV2 = (e: React.PointerEvent) => {
      setCursorPos({x: e.clientX, y: e.clientY});
      activePointers.current.set(e.pointerId, {x: e.clientX, y: e.clientY});
      const worldPos = screenToWorld({x: e.clientX, y: e.clientY}, view);

      // Smooth Pinch-to-Zoom logic
      if (activePointers.current.size === 2 && pinchState.current) {
          // FIX: Explicitly cast pointers to Point[] to avoid 'unknown' type issues during array conversion
          const pointers = Array.from(activePointers.current.values()) as Point[];
          const newDist = distance(pointers[0], pointers[1]);
          const midPoint = { x: (pointers[0].x + pointers[1].x) / 2, y: (pointers[0].y + pointers[1].y) / 2 };
          
          const scaleChange = newDist / pinchState.current.initialDist;
          const newScale = Math.min(Math.max(pinchState.current.initialScale * scaleChange, ZOOM_MIN), ZOOM_MAX);
          
          setView({
            x: midPoint.x - pinchState.current.worldMid.x * newScale,
            y: midPoint.y - pinchState.current.worldMid.y * newScale,
            scale: newScale
          });
          return;
      }

      if (activeTool === ToolType.ERASER && isDragging) {
          if (tempElements) setTempElements(performErase(worldPos, tempElements));
          return;
      }

      if (activeTool === ToolType.LASER && currentLaserId) {
        setLaserStrokes(prev => prev.map(s => s.id === currentLaserId ? { ...s, points: [...s.points, worldPos], lastUpdate: Date.now() } : s));
        return;
      }

      if (isPanning) {
          setView(prev => ({ ...prev, x: prev.x + e.clientX - dragStart.x, y: prev.y + e.clientY - dragStart.y }));
          setDragStart({x: e.clientX, y: e.clientY});
          return;
      }

      if (isResizing) {
          const targetId = Array.from(selectedIds)[0];
          const newElements = elements.map(el => {
              if (el.id !== targetId) return el;
              if (isResizing === 'rect-br' && (el.type === 'rectangle' || el.type === 'image')) {
                  const r = el as (RectangleElement | ImageElement);
                  return { ...r, width: worldPos.x - r.x, height: worldPos.y - r.y };
              }
              if (isResizing === 'circle-r' && el.type === 'circle') {
                  return { ...el, radius: distance({x: el.x, y: el.y}, worldPos) };
              }
              if (isResizing === 'arrow-start' && el.type === 'arrow') return { ...el, x: worldPos.x, y: worldPos.y };
              if (isResizing === 'arrow-end' && el.type === 'arrow') return { ...el, endX: worldPos.x, endY: worldPos.y };
              if (isResizing === 'tri-1' && el.type === 'triangle') return { ...el, p1: worldPos };
              if (isResizing === 'tri-2' && el.type === 'triangle') return { ...el, p2: worldPos };
              if (isResizing === 'tri-3' && el.type === 'triangle') return { ...el, p3: worldPos };
              return el;
          });
          setTempElements(newElements);
          return;
      }

      if (selectionBox) {
          setSelectionBox(prev => prev ? ({ ...prev, end: worldPos }) : null);
          const boxBounds = { minX: Math.min(selectionBox.start.x, worldPos.x), minY: Math.min(selectionBox.start.y, worldPos.y), maxX: Math.max(selectionBox.start.x, worldPos.x), maxY: Math.max(selectionBox.start.y, worldPos.y) };
          const newSelected = new Set<string>();
          elements.forEach(el => { if (doBoundsIntersect(boxBounds, getElementBounds(el))) newSelected.add(el.id); });
          setSelectedIds(newSelected);
          return;
      }

      if (isDragging && dragOrigin) {
          setDragOffset({ x: worldPos.x - dragOrigin.x, y: worldPos.y - dragOrigin.y });
          return;
      }

      if (currentElement) {
          if (currentElement.type === 'pencil') { const el = currentElement as PencilElement; setCurrentElement({ ...el, points: [...el.points, worldPos] }); }
          else if (currentElement.type === 'rectangle') { const el = currentElement as RectangleElement; setCurrentElement({ ...el, width: worldPos.x - el.x, height: worldPos.y - el.y }); }
          else if (currentElement.type === 'circle') { const el = currentElement as CircleElement; setCurrentElement({ ...el, radius: distance({x: el.x, y: el.y}, worldPos) }); }
          else if (currentElement.type === 'arrow') { const el = currentElement as ArrowElement; setCurrentElement({ ...el, endX: worldPos.x, endY: worldPos.y }); }
          else if (currentElement.type === 'triangle') {
              const tri = currentElement as TriangleElement;
              if (triangleStep === 1) setCurrentElement({ ...tri, p2: worldPos, p3: worldPos });
              else if (triangleStep === 2) setCurrentElement({ ...tri, p3: worldPos });
          }
      }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    activePointers.current.delete(e.pointerId);
    if (activePointers.current.size < 2) {
      pinchState.current = null;
    }
    
    e.currentTarget.releasePointerCapture(e.pointerId);
    setIsPanning(false);
    setSelectionBox(null);
    setCurrentLaserId(null);

    if (isResizing || tempElements) {
        pushToHistory(tempElements || elements);
        setTempElements(null);
        setIsResizing(null);
        return;
    }

    if (isDragging && dragOrigin) {
        if (dragOffset.x !== 0 || dragOffset.y !== 0) {
            const newElements = elements.map(el => {
                if (selectedIds.has(el.id)) {
                    if (el.type === 'pencil') return { ...el, points: (el as PencilElement).points.map(pt => ({ x: pt.x + dragOffset.x, y: pt.y + dragOffset.y })) };
                    if (el.type === 'arrow') return { ...el, x: el.x + dragOffset.x, y: el.y + dragOffset.y, endX: (el as ArrowElement).endX + dragOffset.x, endY: (el as ArrowElement).endY + dragOffset.y };
                    if (el.type === 'triangle') return { ...el, p1: {x: (el as TriangleElement).p1.x + dragOffset.x, y: (el as TriangleElement).p1.y + dragOffset.y}, p2: {x: (el as TriangleElement).p2.x + dragOffset.x, y: (el as TriangleElement).p2.y + dragOffset.y}, p3: {x: (el as TriangleElement).p3.x + dragOffset.x, y: (el as TriangleElement).p3.y + dragOffset.y} };
                    return { ...el, x: el.x + dragOffset.x, y: el.y + dragOffset.y };
                }
                return el;
            });
            pushToHistory(newElements);
        }
        setIsDragging(false);
        setDragOrigin(null);
        setDragOffset({x: 0, y: 0});
    }

    if (currentElement && activeTool !== ToolType.TRIANGLE) {
      let el = currentElement;
      if (el.type === 'rectangle') { if (el.width < 0) { el.x += el.width; el.width = Math.abs(el.width); } if (el.height < 0) { el.y += el.height; el.height = Math.abs(el.height); } }
      pushToHistory([...elements, el]);
      setCurrentElement(null);
    }
  };

  const handlePointerCancel = (e: React.PointerEvent) => {
    activePointers.current.delete(e.pointerId);
    if (activePointers.current.size < 2) pinchState.current = null;
    setIsPanning(false);
    setIsDragging(false);
    setSelectionBox(null);
    setCurrentElement(null);
    setTempElements(null);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
        const dataUrl = event.target?.result as string;
        const img = new Image();
        img.onload = () => {
            const center = screenToWorld({ x: window.innerWidth / 2, y: window.innerHeight / 2 }, view);
            const scaleFactor = (window.innerWidth * 0.4) / img.width;
            const newImage: ImageElement = {
                id: generateId(),
                type: 'image',
                src: dataUrl,
                x: center.x - (img.width * scaleFactor) / 2,
                y: center.y - (img.height * scaleFactor) / 2,
                width: img.width * scaleFactor,
                height: img.height * scaleFactor,
            };
            pushToHistory([...elements, newImage]);
            setSelectedIds(new Set([newImage.id]));
        };
        img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  };

  const deleteSelected = useCallback(() => {
    if (selectedIds.size > 0) {
        pushToHistory(elements.filter(el => !selectedIds.has(el.id)));
        setSelectedIds(new Set());
    }
  }, [selectedIds, elements, pushToHistory]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'z') { e.preventDefault(); undo(); }
    if ((e.metaKey || e.ctrlKey) && e.key === 'y') { e.preventDefault(); redo(); }
    if ((e.metaKey || e.ctrlKey) && e.key === 'a') { e.preventDefault(); setSelectedIds(new Set(elements.map(e => e.id))); }
    if (e.key === 'Backspace' || e.key === 'Delete') deleteSelected();
    if (e.key === 'Escape') { setSelectedIds(new Set()); setSelectionBox(null); }
    if (e.key === 'v') setActiveTool(ToolType.SELECT);
    if (e.key === 'h') setActiveTool(ToolType.HAND);
    if (e.key === 'p') setActiveTool(ToolType.PENCIL);
    if (e.key === 'l') setActiveTool(ToolType.LASER);
    if (e.key === 'e') setActiveTool(ToolType.ERASER);
  }, [elements, undo, redo, deleteSelected]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const renderElement = (el: WhiteboardElement) => {
    const isSelected = selectedIds.has(el.id);
    const isCreating = currentElement?.id === el.id;
    const showMeasurements = (isSelected && selectedIds.size === 1) || isCreating;
    let dx = isSelected && isDragging ? dragOffset.x : 0;
    let dy = isSelected && isDragging ? dragOffset.y : 0;
    const commonProps = { key: el.id, stroke: el.strokeColor || 'black', strokeWidth: el.strokeWidth || 2, fill: el.fillColor || 'transparent' };

    if (el.type === 'rectangle' || el.type === 'image') {
      const r = el as (RectangleElement | ImageElement);
      const x = r.x + dx, y = r.y + dy, w = r.width, h = r.height;
      return (
        <React.Fragment key={el.id}>
          {el.type === 'image' ? <image href={(el as ImageElement).src} x={x} y={y} width={w} height={h} /> : <rect {...commonProps} x={x} y={y} width={w} height={h} className={isSelected && selectedIds.size === 1 ? 'stroke-blue-500 stroke-[3px]' : ''} />}
          {showMeasurements && (
            <>
              <MathLabel x={x + w/2 - 20} y={y - 10}>{Math.round(w)}</MathLabel>
              <MathLabel x={x - 45} y={y + h/2 + 5}>{Math.round(h)}</MathLabel>
            </>
          )}
          {isSelected && selectedIds.size === 1 && <rect x={x + w - 4} y={y + h - 4} width={8} height={8} fill="white" stroke="#3b82f6" strokeWidth={2} style={{cursor: 'nwse-resize'}} />}
        </React.Fragment>
      );
    }
    if (el.type === 'pencil') {
        const offsetPoints = (el as PencilElement).points.map(p => ({ x: p.x + dx, y: p.y + dy }));
        return <path key={el.id} d={getSvgPathFromPoints(offsetPoints)} stroke={el.strokeColor} strokeWidth={el.strokeWidth} fill="none" strokeLinecap="round" strokeLinejoin="round" className={isSelected && selectedIds.size === 1 ? 'stroke-blue-500/50 stroke-[6px]' : ''} />;
    }
    if (el.type === 'circle') {
        const cx = (el as CircleElement).x + dx, cy = (el as CircleElement).y + dy, r = (el as CircleElement).radius;
        return (
            <React.Fragment key={el.id}>
                <circle {...commonProps} cx={cx} cy={cy} r={r} className={isSelected && selectedIds.size === 1 ? 'stroke-blue-500 stroke-[3px]' : ''} />
                {isSelected && selectedIds.size === 1 && <circle cx={cx + r} cy={cy} r={4} fill="white" stroke="#3b82f6" strokeWidth={2} style={{cursor: 'ew-resize'}} />}
            </React.Fragment>
        );
    }
    if (el.type === 'arrow') {
        const sx = (el as ArrowElement).x + dx, sy = (el as ArrowElement).y + dy, ex = (el as ArrowElement).endX + dx, ey = (el as ArrowElement).endY + dy;
        return (
            <React.Fragment key={el.id}>
                <line x1={sx} y1={sy} x2={ex} y2={ey} stroke={el.strokeColor} strokeWidth={el.strokeWidth} markerEnd="url(#arrowhead)" className={isSelected && selectedIds.size === 1 ? 'stroke-blue-500/50 stroke-[6px]' : ''} />
                {isSelected && selectedIds.size === 1 && (
                    <>
                        <circle cx={sx} cy={sy} r={4} fill="white" stroke="#3b82f6" strokeWidth={2} />
                        <circle cx={ex} cy={ey} r={4} fill="white" stroke="#3b82f6" strokeWidth={2} />
                    </>
                )}
            </React.Fragment>
        );
    }
    if (el.type === 'triangle') {
        const t = el as TriangleElement;
        const p1 = {x: t.p1.x+dx, y: t.p1.y+dy}, p2 = {x: t.p2.x+dx, y: t.p2.y+dy}, p3 = {x: t.p3.x+dx, y: t.p3.y+dy};
        return (
            <React.Fragment key={el.id}>
                <path {...commonProps} d={`M ${p1.x} ${p1.y} L ${p2.x} ${p2.y} L ${p3.x} ${p3.y} Z`} className={isSelected && selectedIds.size === 1 ? 'stroke-blue-500 stroke-[3px]' : ''} />
                {isSelected && selectedIds.size === 1 && (
                    <>
                        <circle cx={p1.x} cy={p1.y} r={4} fill="white" stroke="#3b82f6" strokeWidth={2} />
                        <circle cx={p2.x} cy={p2.y} r={4} fill="white" stroke="#3b82f6" strokeWidth={2} />
                        <circle cx={p3.x} cy={p3.y} r={4} fill="white" stroke="#3b82f6" strokeWidth={2} />
                    </>
                )}
            </React.Fragment>
        );
    }
    return null;
  };

  const gridSize = 40 * view.scale;
  const elementsToRender = tempElements || elements;

  let selectionBoundsRect = null;
  let miniToolbarPos = null;
  if (selectedIds.size > 0 && !isResizing) {
      const selectedElements = elementsToRender.filter(el => selectedIds.has(el.id)).map(el => {
          if (isDragging && dragOffset && (dragOffset.x !== 0 || dragOffset.y !== 0)) {
              if (el.type === 'pencil') return { ...el, points: (el as PencilElement).points.map(pt => ({ x: pt.x + dragOffset.x, y: pt.y + dragOffset.y })) };
              if (el.type === 'arrow') return { ...el, x: el.x + dragOffset.x, y: el.y + dragOffset.y, endX: (el as ArrowElement).endX + dragOffset.x, endY: (el as ArrowElement).endY + dragOffset.y };
              if (el.type === 'triangle') return { ...el, p1: {x: (el as TriangleElement).p1.x + dragOffset.x, y: (el as TriangleElement).p1.y + dragOffset.y}, p2: {x: (el as TriangleElement).p2.x + dragOffset.x, y: (el as TriangleElement).p2.y + dragOffset.y}, p3: {x: (el as TriangleElement).p3.x + dragOffset.x, y: (el as TriangleElement).p3.y + dragOffset.y} };
              return { ...el, x: el.x + dragOffset.x, y: el.y + dragOffset.y };
          }
          return el;
      });
      const bounds = getCommonBounds(selectedElements);
      if (bounds) {
          selectionBoundsRect = <rect x={bounds.minX - 5} y={bounds.minY - 5} width={bounds.maxX - bounds.minX + 10} height={bounds.maxY - bounds.minY + 10} fill="none" stroke="#3b82f6" strokeWidth={1.5} strokeDasharray="4 2" pointerEvents="none" />;
          miniToolbarPos = worldToScreen({ x: (bounds.minX + bounds.maxX) / 2, y: bounds.minY }, view);
      }
  }

  const cursorStyle = activeTool === ToolType.ERASER ? 'none' : activeTool === ToolType.HAND ? (isPanning ? 'grabbing' : 'grab') : 'crosshair';

  return (
    <div className="w-full h-full relative overflow-hidden bg-[#f9f9f9]">
      <input type="file" ref={fileInputRef} onChange={handleImageUpload} accept="image/*" className="hidden" />
      <Toolbar 
        activeTool={activeTool} 
        setActiveTool={setActiveTool} 
        activeColor={activeColor}
        setActiveColor={setActiveColor}
        activeStrokeWidth={activeStrokeWidth}
        setActiveStrokeWidth={setActiveStrokeWidth}
        undo={undo}
        redo={redo}
        canUndo={canUndo}
        canRedo={canRedo}
        onUploadClick={() => fileInputRef.current?.click()}
      />
      <div 
        ref={containerRef}
        className="w-full h-full touch-none"
        style={{ cursor: cursorStyle }}
        onWheel={handleWheel}
        onPointerDown={handlePointerDownV2}
        onPointerMove={handlePointerMoveV2}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onContextMenu={(e) => e.preventDefault()}
      >
        <svg className="w-full h-full absolute top-0 left-0 block">
          <defs>
            <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
              <polygon points="0 0, 10 3.5, 0 7" fill={activeColor} />
            </marker>
            <pattern id="grid-pattern" x={view.x % gridSize} y={view.y % gridSize} width={gridSize} height={gridSize} patternUnits="userSpaceOnUse">
                <circle cx={2 * view.scale} cy={2 * view.scale} r={1.5 * view.scale} fill="#ccc" />
            </pattern>
            <filter id="laser-glow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="2" result="blur" /><feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>
          <rect x="0" y="0" width="100%" height="100%" fill="url(#grid-pattern)" />
          <g transform={`translate(${view.x}, ${view.y}) scale(${view.scale})`}>
            {elementsToRender.map(renderElement)}
            {currentElement && renderElement(currentElement)}
            {laserStrokes.map(stroke => <path key={stroke.id} d={getSvgPathFromPoints(stroke.points)} fill="none" stroke="#ff0000" strokeWidth={3 / view.scale} strokeLinecap="round" strokeLinejoin="round" opacity={stroke.opacity} filter="url(#laser-glow)" />)}
            {selectionBoundsRect}
            {selectionBox && <rect x={Math.min(selectionBox.start.x, selectionBox.end.x)} y={Math.min(selectionBox.start.y, selectionBox.end.y)} width={Math.abs(selectionBox.end.x - selectionBox.start.x)} height={Math.abs(selectionBox.end.y - selectionBox.start.y)} fill="rgba(59, 130, 246, 0.1)" stroke="#3b82f6" strokeWidth={1} rx={4} />}
          </g>
        </svg>
        {activeTool === ToolType.ERASER && cursorPos && <div className="fixed pointer-events-none rounded-full border-2 border-gray-400 bg-white/50 z-50 flex items-center justify-center shadow-sm" style={{ left: cursorPos.x, top: cursorPos.y, width: ERASER_RADIUS * 2, height: ERASER_RADIUS * 2, transform: 'translate(-50%, -50%)' }}><div className="w-1 h-1 bg-gray-600 rounded-full" /></div>}
      </div>
      {miniToolbarPos && selectedIds.size > 0 && !isDragging && <MiniToolbar x={miniToolbarPos.x} y={miniToolbarPos.y} onDelete={deleteSelected} />}
      <div className="fixed right-4 bottom-4 flex flex-col-reverse items-end gap-3 sm:flex-row sm:items-center z-50 pointer-events-none select-none">
         <div className="pointer-events-auto bg-white/90 backdrop-blur-sm px-3 py-1.5 rounded-full shadow-sm border border-gray-200 flex items-center gap-1 transition-all opacity-70 hover:opacity-100"><span className="text-[10px] text-gray-400 font-medium">Powered by</span><span className="text-[10px] font-bold text-gray-700 tracking-tight">Axmadjon</span></div>
         <div className="pointer-events-auto bg-white p-1.5 rounded-lg shadow-lg border border-gray-200 flex gap-1 items-center text-sm text-gray-600">
             <button onClick={() => setView(v => ({...v, scale: Math.max(v.scale - 0.2, ZOOM_MIN)}))} className="w-7 h-7 flex items-center justify-center hover:bg-gray-100 rounded text-lg text-gray-500">-</button>
             <span className="w-10 text-center text-xs font-medium tabular-nums">{Math.round(view.scale * 100)}%</span>
             <button onClick={() => setView(v => ({...v, scale: Math.min(v.scale + 0.2, ZOOM_MAX)}))} className="w-7 h-7 flex items-center justify-center hover:bg-gray-100 rounded text-lg text-gray-500">+</button>
         </div>
      </div>
      {activeTool === ToolType.TRIANGLE && <div className="fixed top-4 left-1/2 -translate-x-1/2 bg-blue-600 text-white px-4 py-2 rounded-full shadow-lg text-sm font-medium animate-fade-in pointer-events-none">{triangleStep === 0 ? "Click to place 1st point" : triangleStep === 1 ? "Click to place 2nd point" : "Click to place 3rd point"}</div>}
    </div>
  );
};