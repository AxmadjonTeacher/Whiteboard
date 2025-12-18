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
  doBoundsIntersect,
  isPointInBounds
} from '../utils/BoundsUtils';
import { useHistory } from '../hooks/useHistory';
import { Toolbar } from './Toolbar';
import { MiniToolbar } from './MiniToolbar';
import { ZoomControls } from './ZoomControls';

const ZOOM_MIN = 0.1;
const ZOOM_MAX = 10;
const ZOOM_STEP = 1.2;
const SCROLL_SENSITIVITY = 0.002;
const ERASER_RADIUS = 20;
const LASER_LIFETIME_MS = 7000; // 7 seconds

export const Whiteboard: React.FC = () => {
  const { elements, pushToHistory, undo, redo, canUndo, canRedo } = useHistory([]);
  // Ref to track latest elements for async operations (like file upload/paste)
  const elementsRef = useRef(elements);
  elementsRef.current = elements;

  const [view, setView] = useState<ViewState>({ x: 0, y: 0, scale: 1 });
  const [activeTool, setActiveTool] = useState<ToolType>(ToolType.SELECT);
  const [activeColor, setActiveColor] = useState<string>('#000000');
  const [activeStrokeWidth, setActiveStrokeWidth] = useState<number>(2);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState<string | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [dragStart, setDragStart] = useState<Point>({ x: 0, y: 0 });
  const [dragOrigin, setDragOrigin] = useState<Point | null>(null);
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
    let lastTime = performance.now();

    const fade = (time: number) => {
      const deltaTime = time - lastTime;
      lastTime = time;

      setLaserStrokes(prev => {
        if (prev.length === 0) return prev;
        
        const decay = deltaTime / LASER_LIFETIME_MS;

        const next = prev.map(stroke => {
          if (stroke.id === currentLaserId) return stroke;
          return { ...stroke, opacity: stroke.opacity - decay };
        }).filter(stroke => stroke.opacity > 0);
        return next;
      });
      frameId = requestAnimationFrame(fade);
    };
    frameId = requestAnimationFrame(fade);
    return () => cancelAnimationFrame(frameId);
  }, [currentLaserId]);

  const handleImageInput = (file: File) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
         const worldCenter = screenToWorld({ x: window.innerWidth/2, y: window.innerHeight/2 }, view);
         let w = img.width;
         let h = img.height;
         // Scaled down logic
         const maxDim = 600 / view.scale;
         if (w > maxDim || h > maxDim) {
             const ratio = Math.min(maxDim/w, maxDim/h);
             w *= ratio;
             h *= ratio;
         }

         const newImg: ImageElement = {
             id: generateId(),
             type: 'image',
             x: worldCenter.x - w/2,
             y: worldCenter.y - h/2,
             width: w,
             height: h,
             src: event.target?.result as string
         };
         pushToHistory([...elementsRef.current, newImg]);
         // Auto-select so user can move it immediately
         setSelectedIds(new Set([newImg.id]));
         setActiveTool(ToolType.SELECT);
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  // Keyboard and Paste Listeners
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo(); return; }
        if ((e.ctrlKey || e.metaKey) && e.key === 'y') { e.preventDefault(); redo(); return; }
        if (e.key === 'Backspace' || e.key === 'Delete') {
             if (selectedIds.size > 0) {
                 const newEls = elements.filter(el => !selectedIds.has(el.id));
                 pushToHistory(newEls);
                 setSelectedIds(new Set());
             }
             return;
        }
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

        switch(e.key.toLowerCase()) {
            case 'v': setActiveTool(ToolType.SELECT); break;
            case 'h': setActiveTool(ToolType.HAND); break;
            case 'r': setActiveTool(ToolType.RECTANGLE); break;
            case 'c': setActiveTool(ToolType.CIRCLE); break;
            case 't': setActiveTool(ToolType.TRIANGLE); break;
            case 'a': setActiveTool(ToolType.ARROW); break;
            case 'p': setActiveTool(ToolType.PENCIL); break;
            case 'l': setActiveTool(ToolType.LASER); break;
            case 'e': setActiveTool(ToolType.ERASER); break;
            case 'u': fileInputRef.current?.click(); break;
        }
    };

    const handlePaste = (e: ClipboardEvent) => {
        const item = e.clipboardData?.items[0];
        if (item?.type.includes('image')) {
            const file = item.getAsFile();
            if (file) handleImageInput(file);
        }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('paste', handlePaste);
    return () => {
        window.removeEventListener('keydown', handleKeyDown);
        window.removeEventListener('paste', handlePaste);
    };
  }, [undo, redo, selectedIds, elements, pushToHistory, view]);

  const getElementAtPosition = (worldPos: Point): string | null => {
    const targetElements = tempElements || elements;
    for (let i = targetElements.length - 1; i >= 0; i--) {
        if (hitTestElement(targetElements[i], worldPos, view.scale)) return targetElements[i].id;
    }
    return null;
  };

  const updateZoom = (newScale: number, centerX: number, centerY: number) => {
    const scale = Math.min(Math.max(newScale, ZOOM_MIN), ZOOM_MAX);
    const worldPoint = screenToWorld({ x: centerX, y: centerY }, view);
    const newX = centerX - worldPoint.x * scale;
    const newY = centerY - worldPoint.y * scale;
    setView({ x: newX, y: newY, scale });
  };

  const handleWheel = (e: React.WheelEvent) => {
    const scaleChange = Math.exp(-e.deltaY * SCROLL_SENSITIVITY);
    updateZoom(view.scale * scaleChange, e.clientX, e.clientY);
  };

  const handleZoomIn = () => {
    updateZoom(view.scale * ZOOM_STEP, window.innerWidth / 2, window.innerHeight / 2);
  };

  const handleZoomOut = () => {
    updateZoom(view.scale / ZOOM_STEP, window.innerWidth / 2, window.innerHeight / 2);
  };

  const handleZoomToFit = () => {
    if (elements.length === 0) {
      setView({ x: 0, y: 0, scale: 1 });
      return;
    }
    const bounds = getCommonBounds(elements);
    if (!bounds) return;
    const padding = 60;
    const availableWidth = window.innerWidth - padding * 2;
    const availableHeight = window.innerHeight - padding * 2;
    const boundsWidth = bounds.maxX - bounds.minX;
    const boundsHeight = bounds.maxY - bounds.minY;
    if (boundsWidth === 0 || boundsHeight === 0) {
      setView({ x: window.innerWidth / 2 - bounds.minX, y: window.innerHeight / 2 - bounds.minY, scale: 1 });
      return;
    }
    const scaleX = availableWidth / boundsWidth;
    const scaleY = availableHeight / boundsHeight;
    const nextScale = Math.min(scaleX, scaleY, 1.0);
    const finalScale = Math.max(nextScale, ZOOM_MIN);
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;
    setView({
      x: window.innerWidth / 2 - centerX * finalScale,
      y: window.innerHeight / 2 - centerY * finalScale,
      scale: finalScale
    });
  };
  
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
          
          if (newSegments.length === 1 && newSegments[0].length === points.length) { 
              newList.push(el); 
          } else {
              hasChanges = true;
              newSegments.forEach(seg => {
                  if (seg.length > 1) { 
                      newList.push({ id: generateId(), type: 'pencil', x: seg[0].x, y: seg[0].y, points: seg, strokeColor: el.strokeColor || activeColor, strokeWidth: el.strokeWidth || activeStrokeWidth });
                  }
              });
          }
      }
      return hasChanges ? newList : currentList;
  };

  const handlePointerDownV2 = (e: React.PointerEvent) => {
    activePointers.current.set(e.pointerId, {x: e.clientX, y: e.clientY});
    const worldPos = screenToWorld({x: e.clientX, y: e.clientY}, view);

    if (activePointers.current.size === 2) {
      const pointers = Array.from(activePointers.current.values()) as Point[];
      const dist = distance(pointers[0], pointers[1]);
      const midPoint = { x: (pointers[0].x + pointers[1].x) / 2, y: (pointers[0].y + pointers[1].y) / 2 };
      pinchState.current = {
        initialDist: dist,
        initialScale: view.scale,
        worldMid: screenToWorld(midPoint, view)
      };
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
    setDragOrigin(worldPos); 
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

      if (activePointers.current.size === 2 && pinchState.current) {
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
          setTempElements(performErase(worldPos, tempElements || elements));
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

      if (isResizing && selectedIds.size === 1) {
          const targetId = Array.from(selectedIds)[0];
          const baseElements = elements; 
          const newElements = baseElements.map(el => {
              if (el.id !== targetId) return el;
              if (isResizing === 'rect-br' && (el.type === 'rectangle' || el.type === 'image')) {
                  const r = el as (RectangleElement | ImageElement);
                  return { ...r, width: worldPos.x - r.x, height: worldPos.y - r.y };
              }
              if (isResizing === 'circle-r' && el.type === 'circle') {
                  const c = el as CircleElement;
                  return { ...c, radius: distance({x: c.x, y: c.y}, worldPos) };
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

      if (isDragging && selectedIds.size > 0 && dragOrigin) {
          const dx = worldPos.x - dragOrigin.x;
          const dy = worldPos.y - dragOrigin.y;
          // Cumulative delta from original state to avoid incremental jitter
          const newElements = elements.map(el => {
              if (!selectedIds.has(el.id)) return el;
              if (el.type === 'triangle') {
                  const t = el as TriangleElement;
                  return { ...t, p1: {x: t.p1.x + dx, y: t.p1.y + dy}, p2: {x: t.p2.x + dx, y: t.p2.y + dy}, p3: {x: t.p3.x + dx, y: t.p3.y + dy} };
              } else if (el.type === 'pencil') {
                  const p = el as PencilElement;
                  return { ...p, points: p.points.map(pt => ({ x: pt.x + dx, y: pt.y + dy })) };
              } else if (el.type === 'arrow') {
                  const a = el as ArrowElement;
                  return { ...a, x: a.x + dx, y: a.y + dy, endX: a.endX + dx, endY: a.endY + dy };
              } else {
                  return { ...el, x: (el as any).x + dx, y: (el as any).y + dy };
              }
          });
          setTempElements(newElements);
          return;
      }

      if (selectionBox) {
          setSelectionBox(prev => prev ? ({ ...prev, end: worldPos }) : null);
          const sb = selectionBox;
          const boxBounds = { minX: Math.min(sb.start.x, worldPos.x), minY: Math.min(sb.start.y, worldPos.y), maxX: Math.max(sb.start.x, worldPos.x), maxY: Math.max(sb.start.y, worldPos.y) };
          const newSelected = new Set<string>();
          elements.forEach(el => { if (doBoundsIntersect(getElementBounds(el), boxBounds)) newSelected.add(el.id); });
          setSelectedIds(newSelected);
          return;
      }

      if (currentElement && dragOrigin) {
          if (activeTool === ToolType.PENCIL) {
              const p = currentElement as PencilElement;
              setCurrentElement({ ...p, points: [...p.points, worldPos] });
          } else if (activeTool === ToolType.RECTANGLE) {
              setCurrentElement({ ...currentElement, x: Math.min(dragOrigin.x, worldPos.x), y: Math.min(dragOrigin.y, worldPos.y), width: Math.abs(dragOrigin.x - worldPos.x), height: Math.abs(dragOrigin.y - worldPos.y) } as RectangleElement);
          } else if (activeTool === ToolType.CIRCLE) {
              setCurrentElement({ ...currentElement, x: dragOrigin.x, y: dragOrigin.y, radius: distance(dragOrigin, worldPos) } as CircleElement);
          } else if (activeTool === ToolType.ARROW) {
              setCurrentElement({ ...currentElement, x: dragOrigin.x, y: dragOrigin.y, endX: worldPos.x, endY: worldPos.y } as ArrowElement);
          } else if (activeTool === ToolType.TRIANGLE && triangleStep > 0) {
              const t = currentElement as TriangleElement;
              if (triangleStep === 1) setCurrentElement({ ...t, p2: worldPos, p3: worldPos });
              else setCurrentElement({ ...t, p3: worldPos });
          }
      }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    activePointers.current.delete(e.pointerId);
    if (activePointers.current.size < 2) pinchState.current = null;
    setIsPanning(false);
    setIsDragging(false);
    setIsResizing(null);
    setDragOrigin(null);
    if (activeTool === ToolType.ERASER && tempElements) { pushToHistory(tempElements); setTempElements(null); }
    if (activeTool === ToolType.LASER) setCurrentLaserId(null);
    if (selectionBox) setSelectionBox(null);
    if (tempElements) { pushToHistory(tempElements); setTempElements(null); }
    if (currentElement) {
        if (activeTool === ToolType.TRIANGLE && triangleStep !== 0) return;
        let valid = true;
        if (currentElement.type === 'rectangle' && (currentElement as RectangleElement).width < 5) valid = false;
        if (currentElement.type === 'circle' && (currentElement as CircleElement).radius < 5) valid = false;
        if (currentElement.type === 'arrow' && distance({x:currentElement.x, y:currentElement.y}, {x:(currentElement as ArrowElement).endX, y:(currentElement as ArrowElement).endY}) < 5) valid = false;
        if (valid) pushToHistory([...elements, currentElement]);
        setCurrentElement(null);
    }
  };

  const renderElement = (el: WhiteboardElement, isSelected: boolean) => {
    const renderHandles = () => {
        if (!isSelected || selectedIds.size > 1) return null;
        const handleClass = "fill-white stroke-blue-500 stroke-1 hover:fill-blue-100 cursor-pointer";
        const handleSize = 8 / view.scale;
        if (el.type === 'rectangle' || el.type === 'image') {
            const r = el as (RectangleElement | ImageElement);
            return (
                <>
                  <rect x={r.x - 2/view.scale} y={r.y - 2/view.scale} width={r.width + 4/view.scale} height={r.height + 4/view.scale} fill="none" stroke="#3b82f6" strokeWidth={1/view.scale} pointerEvents="none" />
                  <rect x={r.x + r.width - handleSize/2} y={r.y + r.height - handleSize/2} width={handleSize} height={handleSize} className={handleClass} />
                </>
            );
        } else if (el.type === 'circle') {
             const c = el as CircleElement;
             return (
                 <>
                   <circle cx={c.x} cy={c.y} r={c.radius + 2/view.scale} fill="none" stroke="#3b82f6" strokeWidth={1/view.scale} pointerEvents="none"/>
                   <rect x={c.x + c.radius - handleSize/2} y={c.y - handleSize/2} width={handleSize} height={handleSize} className={handleClass} />
                 </>
             );
        } else if (el.type === 'triangle') {
            const t = el as TriangleElement;
             return (
                 <>
                   <polygon points={`${t.p1.x},${t.p1.y} ${t.p2.x},${t.p2.y} ${t.p3.x},${t.p3.y}`} fill="none" stroke="#3b82f6" strokeWidth={1/view.scale} pointerEvents="none" />
                   <rect x={t.p1.x - handleSize/2} y={t.p1.y - handleSize/2} width={handleSize} height={handleSize} className={handleClass} />
                   <rect x={t.p2.x - handleSize/2} y={t.p2.y - handleSize/2} width={handleSize} height={handleSize} className={handleClass} />
                   <rect x={t.p3.x - handleSize/2} y={t.p3.y - handleSize/2} width={handleSize} height={handleSize} className={handleClass} />
                 </>
             );
        } else if (el.type === 'arrow') {
            const a = el as ArrowElement;
            return (
                 <>
                   <line x1={a.x} y1={a.y} x2={a.endX} y2={a.endY} stroke="#3b82f6" strokeWidth={1/view.scale} pointerEvents="none" />
                   <rect x={a.x - handleSize/2} y={a.y - handleSize/2} width={handleSize} height={handleSize} className={handleClass} />
                   <rect x={a.endX - handleSize/2} y={a.endY - handleSize/2} width={handleSize} height={handleSize} className={handleClass} />
                 </>
            );
        }
        return null;
    };

    switch (el.type) {
      case 'pencil':
        return (
            <g key={el.id}>
              {isSelected && <path d={getSvgPathFromPoints((el as PencilElement).points)} fill="none" stroke="#3b82f6" strokeWidth={(el.strokeWidth || 2) + 4 / view.scale} strokeLinecap="round" strokeLinejoin="round" opacity="0.3"/>}
              <path d={getSvgPathFromPoints((el as PencilElement).points)} fill="none" stroke={el.strokeColor} strokeWidth={el.strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
            </g>
        );
      case 'rectangle':
        const r = el as RectangleElement;
        return (
          <g key={el.id}>
             {isSelected && <rect x={r.x - 2 / view.scale} y={r.y - 2 / view.scale} width={r.width + 4 / view.scale} height={r.height + 4 / view.scale} fill="none" stroke="#3b82f6" strokeWidth={2 / view.scale} opacity="0.3" rx={2 / view.scale}/>}
             <rect x={r.x} y={r.y} width={r.width} height={r.height} fill={r.fillColor} stroke={r.strokeColor} strokeWidth={r.strokeWidth} />
             {renderHandles()}
          </g>
        );
      case 'circle':
        const c = el as CircleElement;
        return (
            <g key={el.id}>
                {isSelected && <circle cx={c.x} cy={c.y} r={c.radius + 2 / view.scale} fill="none" stroke="#3b82f6" strokeWidth={2 / view.scale} opacity="0.3"/>}
                <circle cx={c.x} cy={c.y} r={c.radius} fill={c.fillColor} stroke={c.strokeColor} strokeWidth={c.strokeWidth} />
                {renderHandles()}
            </g>
        );
      case 'triangle':
        const t = el as TriangleElement;
        return (
            <g key={el.id}>
                {isSelected && <polygon points={`${t.p1.x},${t.p1.y} ${t.p2.x},${t.p2.y} ${t.p3.x},${t.p3.y}`} fill="none" stroke="#3b82f6" strokeWidth={4 / view.scale} strokeLinejoin="round" opacity="0.3"/>}
                <polygon points={`${t.p1.x},${t.p1.y} ${t.p2.x},${t.p2.y} ${t.p3.x},${t.p3.y}`} fill={t.fillColor} stroke={t.strokeColor} strokeWidth={t.strokeWidth} strokeLinejoin="round"/>
                {renderHandles()}
            </g>
        );
      case 'arrow':
        const a = el as ArrowElement;
        const angle = Math.atan2(a.endY - a.y, a.endX - a.x);
        const headLen = 15 / view.scale;
        const arrowHead = `M ${a.endX} ${a.endY} L ${a.endX - headLen * Math.cos(angle - Math.PI / 6)} ${a.endY - headLen * Math.sin(angle - Math.PI / 6)} L ${a.endX - headLen * Math.cos(angle + Math.PI / 6)} ${a.endY - headLen * Math.sin(angle + Math.PI / 6)} Z`;
        return (
            <g key={el.id}>
                {isSelected && <line x1={a.x} y1={a.y} x2={a.endX} y2={a.endY} stroke="#3b82f6" strokeWidth={(a.strokeWidth || 2) + 4 / view.scale} opacity="0.3" />}
                <line x1={a.x} y1={a.y} x2={a.endX} y2={a.endY} stroke={a.strokeColor} strokeWidth={a.strokeWidth} />
                <path d={arrowHead} fill={a.strokeColor} />
                {renderHandles()}
            </g>
        );
      case 'image':
        const img = el as ImageElement;
        return (
            <g key={el.id}>
                {isSelected && <rect x={img.x - 2 / view.scale} y={img.y - 2 / view.scale} width={img.width + 4 / view.scale} height={img.height + 4 / view.scale} fill="none" stroke="#3b82f6" strokeWidth={2 / view.scale} opacity="0.3"/>}
                <image href={img.src} x={img.x} y={img.y} width={img.width} height={img.height} style={{ pointerEvents: 'none' }} />
                {renderHandles()}
            </g>
        );
      default: return null;
    }
  };

  const displayElements = tempElements || elements;
  const selectedElements = displayElements.filter(e => selectedIds.has(e.id));
  const selectionBounds = getCommonBounds(selectedElements);
  const selectionScreenPos = selectionBounds ? worldToScreen({x: (selectionBounds.minX + selectionBounds.maxX)/2, y: selectionBounds.minY}, view) : null;

  return (
    <div 
        ref={containerRef}
        className={`w-full h-full bg-gray-50 overflow-hidden relative cursor-crosshair touch-none ${isDragging ? 'cursor-grabbing' : ''}`}
        onPointerDown={handlePointerDownV2}
        onPointerMove={handlePointerMoveV2}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        onWheel={handleWheel}
    >
        <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={(e) => { const f = e.target.files?.[0]; if(f) handleImageInput(f); if(fileInputRef.current) fileInputRef.current.value=''; }} />
        <Toolbar activeTool={activeTool} setActiveTool={setActiveTool} activeColor={activeColor} setActiveColor={setActiveColor} activeStrokeWidth={activeStrokeWidth} setActiveStrokeWidth={setActiveStrokeWidth} undo={undo} redo={redo} canUndo={canUndo} canRedo={canRedo} onUploadClick={() => fileInputRef.current?.click()} />
        <ZoomControls scale={view.scale} onZoomIn={handleZoomIn} onZoomOut={handleZoomOut} onZoomToFit={handleZoomToFit} />
        {selectionScreenPos && !isDragging && !isResizing && !isPanning && <MiniToolbar x={selectionScreenPos.x} y={selectionScreenPos.y} onDelete={() => { pushToHistory(elements.filter(el => !selectedIds.has(el.id))); setSelectedIds(new Set()); }} /> }
        <svg className="w-full h-full pointer-events-none block">
            <defs>
                <pattern id="dot-pattern" x="0" y="0" width={20 * view.scale} height={20 * view.scale} patternUnits="userSpaceOnUse">
                    <circle cx={1 * view.scale} cy={1 * view.scale} r={1 * view.scale} fill="#cbd5e1" />
                </pattern>
            </defs>
            <g transform={`translate(${view.x}, ${view.y}) scale(${view.scale})`}>
                 <rect x={-view.x / view.scale} y={-view.y / view.scale} width={window.innerWidth / view.scale} height={window.innerHeight / view.scale} fill="url(#dot-pattern)" />
                 {displayElements.map(el => renderElement(el, selectedIds.has(el.id)))}
                 {selectedIds.size > 1 && selectionBounds && <rect x={selectionBounds.minX - 8 / view.scale} y={selectionBounds.minY - 8 / view.scale} width={selectionBounds.maxX - selectionBounds.minX + 16 / view.scale} height={selectionBounds.maxY - selectionBounds.minY + 16 / view.scale} fill="none" stroke="#3b82f6" strokeWidth={1.5 / view.scale} strokeDasharray={`${6 / view.scale} ${4 / view.scale}`} rx={4 / view.scale} /> }
                 {currentElement && renderElement(currentElement, true)}
                 {selectionBox && <rect x={Math.min(selectionBox.start.x, selectionBox.end.x)} y={Math.min(selectionBox.start.y, selectionBox.end.y)} width={Math.abs(selectionBox.start.x - selectionBox.end.x)} height={Math.abs(selectionBox.start.y - selectionBox.end.y)} fill="rgba(59, 130, 246, 0.1)" stroke="#3b82f6" strokeWidth={1 / view.scale} /> }
                 {laserStrokes.map(stroke => <polyline key={stroke.id} points={stroke.points.map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke="red" strokeWidth={4 / view.scale} strokeLinecap="round" strokeLinejoin="round" opacity={stroke.opacity} /> )}
                 {cursorPos && activeTool === ToolType.LASER && <circle cx={screenToWorld(cursorPos, view).x} cy={screenToWorld(cursorPos, view).y} r={3/view.scale} fill="red" /> }
            </g>
        </svg>
    </div>
  );
};