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
  TriangleElement
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
const ZOOM_MAX = 5;
const SCROLL_SENSITIVITY = 0.002;
const ERASER_RADIUS = 20;

// Styles for math labels
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
  // --- State ---
  const { elements, pushToHistory, undo, redo, canUndo, canRedo } = useHistory([]);
  const [view, setView] = useState<ViewState>({ x: 0, y: 0, scale: 1 });
  
  const [activeTool, setActiveTool] = useState<ToolType>(ToolType.SELECT);
  const [activeColor, setActiveColor] = useState<string>('#000000');
  const [activeStrokeWidth, setActiveStrokeWidth] = useState<number>(2);
  
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState<string | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [dragStart, setDragStart] = useState<Point>({ x: 0, y: 0 });
  
  // Selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectionBox, setSelectionBox] = useState<{start: Point, end: Point} | null>(null);

  // Triangle creation state
  const [triangleStep, setTriangleStep] = useState<number>(0);

  // Temporary state for drawing
  const [currentElement, setCurrentElement] = useState<WhiteboardElement | null>(null);
  
  // Temporary elements during erasing (live feedback)
  const [tempElements, setTempElements] = useState<WhiteboardElement[] | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const [cursorPos, setCursorPos] = useState<Point | null>(null);

  // --- Helpers ---
  const getMousePos = (e: React.MouseEvent | React.PointerEvent): Point => {
    return { x: e.clientX, y: e.clientY };
  };

  const getElementAtPosition = (worldPos: Point): string | null => {
    const targetElements = tempElements || elements;
    // Iterate in reverse to select top-most
    for (let i = targetElements.length - 1; i >= 0; i--) {
        if (hitTestElement(targetElements[i], worldPos, view.scale)) {
            return targetElements[i].id;
        }
    }
    return null;
  };

  // --- Event Handlers ---

  const handleWheel = (e: React.WheelEvent) => {
    const scaleChange = Math.exp(-e.deltaY * SCROLL_SENSITIVITY);
    const newScale = Math.min(Math.max(view.scale * scaleChange, ZOOM_MIN), ZOOM_MAX);
    const mouseX = e.clientX;
    const mouseY = e.clientY;
    const worldPoint = screenToWorld({ x: mouseX, y: mouseY }, view);
    const newX = mouseX - worldPoint.x * newScale;
    const newY = mouseY - worldPoint.y * newScale;
    setView({ x: newX, y: newY, scale: newScale });
  };
  
  const [dragOrigin, setDragOrigin] = useState<Point | null>(null);
  const [dragOffset, setDragOffset] = useState<Point>({x: 0, y: 0});

  const performErase = (worldPos: Point, currentList: WhiteboardElement[]): WhiteboardElement[] => {
      const radius = ERASER_RADIUS / view.scale;
      let hasChanges = false;
      const newList: WhiteboardElement[] = [];

      for (const el of currentList) {
          if (!isElementRoughlyIntersecting(el, worldPos, radius)) {
              newList.push(el);
              continue;
          }
          const points = convertShapeToPoints(el, 5 / view.scale); 
          const newSegments: Point[][] = [];
          let currentSegment: Point[] = [];

          for (const p of points) {
              if (distance(p, worldPos) > radius) {
                  currentSegment.push(p);
              } else {
                  if (currentSegment.length > 0) {
                      newSegments.push(currentSegment);
                      currentSegment = [];
                  }
              }
          }
          if (currentSegment.length > 0) newSegments.push(currentSegment);
          
          const totalPointsAfter = newSegments.reduce((acc, seg) => acc + seg.length, 0);
          if (totalPointsAfter === points.length) {
              newList.push(el);
          } else {
              hasChanges = true;
              newSegments.forEach(seg => {
                  if (seg.length > 1) { 
                      newList.push({
                          id: generateId(),
                          type: 'pencil',
                          x: seg[0].x, y: seg[0].y,
                          points: seg,
                          strokeColor: el.strokeColor,
                          strokeWidth: el.strokeWidth,
                          fillColor: 'none'
                      });
                  }
              });
          }
      }
      return hasChanges ? newList : currentList;
  };

  const handlePointerDownV2 = (e: React.PointerEvent) => {
    const mousePos = getMousePos(e);
    const worldPos = screenToWorld(mousePos, view);

    // 1. Hand / Pan
    if (activeTool === ToolType.HAND || e.button === 1 || e.buttons === 4) {
        setIsPanning(true);
        setDragStart({ x: e.clientX, y: e.clientY });
        e.currentTarget.setPointerCapture(e.pointerId);
        return;
    }

    // 2. Eraser
    if (activeTool === ToolType.ERASER) {
        setIsDragging(true);
        setTempElements(elements); 
        const next = performErase(worldPos, elements);
        setTempElements(next);
        e.currentTarget.setPointerCapture(e.pointerId);
        return;
    }

    // 3. Selection / Cursor
    if (activeTool === ToolType.SELECT) {
        // Check Resizing Handles for Single Selection
        if (selectedIds.size === 1) {
            const id = Array.from(selectedIds)[0];
            const el = (tempElements || elements).find(e => e.id === id);
            if (el) {
                if (el.type === 'rectangle') {
                    const r = el as RectangleElement;
                    const br = { x: r.x + r.width, y: r.y + r.height };
                    if (distance(worldPos, br) < 10 / view.scale) {
                        setIsResizing('rect-br'); e.currentTarget.setPointerCapture(e.pointerId); return;
                    }
                } else if (el.type === 'circle') {
                    const c = el as CircleElement;
                    const handle = { x: c.x + c.radius, y: c.y };
                    if (distance(worldPos, handle) < 10 / view.scale) {
                        setIsResizing('circle-r'); e.currentTarget.setPointerCapture(e.pointerId); return;
                    }
                } else if (el.type === 'arrow') {
                    const a = el as ArrowElement;
                    if (distance(worldPos, {x: a.x, y: a.y}) < 10 / view.scale) {
                        setIsResizing('arrow-start'); e.currentTarget.setPointerCapture(e.pointerId); return;
                    }
                    if (distance(worldPos, {x: a.endX, y: a.endY}) < 10 / view.scale) {
                        setIsResizing('arrow-end'); e.currentTarget.setPointerCapture(e.pointerId); return;
                    }
                } else if (el.type === 'triangle') {
                    const t = el as TriangleElement;
                    if (distance(worldPos, t.p1) < 10 / view.scale) { setIsResizing('tri-1'); e.currentTarget.setPointerCapture(e.pointerId); return; }
                    if (distance(worldPos, t.p2) < 10 / view.scale) { setIsResizing('tri-2'); e.currentTarget.setPointerCapture(e.pointerId); return; }
                    if (distance(worldPos, t.p3) < 10 / view.scale) { setIsResizing('tri-3'); e.currentTarget.setPointerCapture(e.pointerId); return; }
                }
            }
        }

        const hitId = getElementAtPosition(worldPos);
        if (hitId) {
            // Clicked on element
            if (e.shiftKey) {
                // Toggle selection
                setSelectedIds(prev => {
                    const next = new Set(prev);
                    if (next.has(hitId)) next.delete(hitId);
                    else next.add(hitId);
                    return next;
                });
            } else {
                if (!selectedIds.has(hitId)) {
                    setSelectedIds(new Set([hitId]));
                }
            }
            setIsDragging(true);
            setDragOrigin(worldPos);
            setDragOffset({x: 0, y: 0});
            e.currentTarget.setPointerCapture(e.pointerId);
        } else {
            // Clicked on empty space -> Box Selection
            if (!e.shiftKey) {
                setSelectedIds(new Set());
            }
            setSelectionBox({ start: worldPos, end: worldPos });
            e.currentTarget.setPointerCapture(e.pointerId);
        }
        return;
    }

    // 4. Creation Tools
    if (activeTool === ToolType.TRIANGLE) {
        if (!currentElement) {
            const id = generateId();
            const newEl: TriangleElement = { 
                id, type: 'triangle', 
                x: worldPos.x, y: worldPos.y,
                p1: worldPos, p2: worldPos, p3: worldPos, 
                strokeColor: activeColor, fillColor: 'transparent', strokeWidth: activeStrokeWidth 
            };
            setCurrentElement(newEl);
            setTriangleStep(1); 
        } else {
            const tri = currentElement as TriangleElement;
            if (triangleStep === 1) {
                setCurrentElement({ ...tri, p2: worldPos, p3: worldPos });
                setTriangleStep(2);
            } else if (triangleStep === 2) {
                pushToHistory([...elements, { ...tri, p3: worldPos }]);
                setCurrentElement(null);
                setTriangleStep(0);
            }
        }
        return;
    }

    // Other shapes drag-to-create
    let newEl: WhiteboardElement | null = null;
    const id = generateId();
    if (activeTool === ToolType.PENCIL) {
        newEl = { id, type: 'pencil', x: worldPos.x, y: worldPos.y, points: [worldPos], strokeColor: activeColor, strokeWidth: activeStrokeWidth };
    } else if (activeTool === ToolType.RECTANGLE) {
        newEl = { id, type: 'rectangle', x: worldPos.x, y: worldPos.y, width: 0, height: 0, strokeColor: activeColor, fillColor: 'transparent', strokeWidth: activeStrokeWidth };
    } else if (activeTool === ToolType.CIRCLE) {
        newEl = { id, type: 'circle', x: worldPos.x, y: worldPos.y, radius: 0, strokeColor: activeColor, fillColor: 'transparent', strokeWidth: activeStrokeWidth };
    } else if (activeTool === ToolType.ARROW) {
        newEl = { id, type: 'arrow', x: worldPos.x, y: worldPos.y, endX: worldPos.x, endY: worldPos.y, strokeColor: activeColor, strokeWidth: activeStrokeWidth };
    }
    
    if (newEl) {
        setCurrentElement(newEl);
        e.currentTarget.setPointerCapture(e.pointerId);
    }
  };

  const handlePointerMoveV2 = (e: React.PointerEvent) => {
      const mousePos = getMousePos(e);
      setCursorPos(mousePos);
      const worldPos = screenToWorld(mousePos, view);
      
      // Eraser
      if (activeTool === ToolType.ERASER && isDragging) {
          if (tempElements) {
              const next = performErase(worldPos, tempElements);
              setTempElements(next);
          }
          return;
      }

      // Panning
      if (isPanning) {
          const dx = mousePos.x - dragStart.x;
          const dy = mousePos.y - dragStart.y;
          setView(prev => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
          setDragStart(mousePos);
          return;
      }

      // Selection Box
      if (selectionBox) {
          setSelectionBox(prev => prev ? ({ ...prev, end: worldPos }) : null);
          // Live Selection Update
          const boxBounds = {
              minX: Math.min(selectionBox.start.x, worldPos.x),
              minY: Math.min(selectionBox.start.y, worldPos.y),
              maxX: Math.max(selectionBox.start.x, worldPos.x),
              maxY: Math.max(selectionBox.start.y, worldPos.y)
          };
          
          const newSelected = new Set<string>();
          elements.forEach(el => {
              const elBounds = getElementBounds(el);
              if (doBoundsIntersect(boxBounds, elBounds)) {
                  newSelected.add(el.id);
              }
          });
          setSelectedIds(newSelected);
          return;
      }

      // Dragging Selection
      if (isDragging && dragOrigin) {
          setDragOffset({
              x: worldPos.x - dragOrigin.x,
              y: worldPos.y - dragOrigin.y
          });
          return;
      }

      // Creating/Resizing shapes
      if (currentElement) {
          if (currentElement.type === 'triangle') {
              const tri = currentElement as TriangleElement;
              if (triangleStep === 1) {
                  setCurrentElement({ ...tri, p2: worldPos, p3: worldPos });
              } else if (triangleStep === 2) {
                  setCurrentElement({ ...tri, p3: worldPos });
              }
          } else if (currentElement.type === 'pencil') {
              const el = currentElement as PencilElement;
              setCurrentElement({ ...el, points: [...el.points, worldPos] });
          } else if (currentElement.type === 'rectangle') {
              const el = currentElement as RectangleElement;
              setCurrentElement({ ...el, width: worldPos.x - el.x, height: worldPos.y - el.y });
          } else if (currentElement.type === 'circle') {
              const el = currentElement as CircleElement;
              setCurrentElement({ ...el, radius: distance({x: el.x, y: el.y}, worldPos) });
          } else if (currentElement.type === 'arrow') {
              const el = currentElement as ArrowElement;
              setCurrentElement({ ...el, endX: worldPos.x, endY: worldPos.y });
          }
      }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    e.currentTarget.releasePointerCapture(e.pointerId);
    setIsPanning(false);
    setSelectionBox(null);

    if (activeTool === ToolType.ERASER) {
        setIsDragging(false);
        if (tempElements) {
            pushToHistory(tempElements);
            setTempElements(null);
        }
        return;
    }

    if (isResizing) {
        setIsResizing(null);
        return;
    }

    if (isDragging && dragOrigin) {
        if (dragOffset.x !== 0 || dragOffset.y !== 0) {
            const newElements = elements.map(el => {
                if (selectedIds.has(el.id)) {
                    if (el.type === 'pencil') {
                        const p = el as PencilElement;
                        return { ...p, points: p.points.map(pt => ({ x: pt.x + dragOffset.x, y: pt.y + dragOffset.y })) };
                    } else if (el.type === 'arrow') {
                         const a = el as ArrowElement;
                         return { ...a, x: a.x + dragOffset.x, y: a.y + dragOffset.y, endX: a.endX + dragOffset.x, endY: a.endY + dragOffset.y };
                    } else if (el.type === 'triangle') {
                        const t = el as TriangleElement;
                        return { ...t, p1: {x: t.p1.x + dragOffset.x, y: t.p1.y + dragOffset.y}, p2: {x: t.p2.x + dragOffset.x, y: t.p2.y + dragOffset.y}, p3: {x: t.p3.x + dragOffset.x, y: t.p3.y + dragOffset.y} };
                    } else {
                        return { ...el, x: el.x + dragOffset.x, y: el.y + dragOffset.y };
                    }
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
      let finalElement = currentElement;
      if (finalElement.type === 'rectangle') {
          const r = finalElement as RectangleElement;
          if (r.width < 0) { r.x += r.width; r.width = Math.abs(r.width); }
          if (r.height < 0) { r.y += r.height; r.height = Math.abs(r.height); }
          finalElement = r;
      }
      pushToHistory([...elements, finalElement]);
      setCurrentElement(null);
    }
  };

  const deleteSelected = useCallback(() => {
    if (selectedIds.size > 0) {
        const newElements = elements.filter(el => !selectedIds.has(el.id));
        pushToHistory(newElements);
        setSelectedIds(new Set());
    }
  }, [selectedIds, elements, pushToHistory]);

  const handleKeyDown = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'z') { e.preventDefault(); undo(); }
    if ((e.metaKey || e.ctrlKey) && e.key === 'y') { e.preventDefault(); redo(); }
    if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
        e.preventDefault();
        setSelectedIds(new Set(elements.map(e => e.id)));
    }
    if (e.key === 'Backspace' || e.key === 'Delete') {
        deleteSelected();
    }
    if (e.key === 'Escape') {
        setSelectedIds(new Set());
        setSelectionBox(null);
    }
    if (e.key === 'v') { setActiveTool(ToolType.SELECT); setCurrentElement(null); setTriangleStep(0); }
    if (e.key === 'h') { setActiveTool(ToolType.HAND); setCurrentElement(null); }
    if (e.key === 'r') setActiveTool(ToolType.RECTANGLE);
    if (e.key === 'c') setActiveTool(ToolType.CIRCLE);
    if (e.key === 't') setActiveTool(ToolType.TRIANGLE);
    if (e.key === 'p') setActiveTool(ToolType.PENCIL);
    if (e.key === 'a') setActiveTool(ToolType.ARROW);
    if (e.key === 'e') setActiveTool(ToolType.ERASER);
  };

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // --- Rendering Elements ---
  const renderElement = (el: WhiteboardElement) => {
    const isSelected = selectedIds.has(el.id);
    const isCreating = currentElement?.id === el.id;
    // For single selection, we show math + handles. For multi, we show just a box later (rendered separately).
    const showMeasurements = (isSelected && selectedIds.size === 1) || isCreating;

    let dx = 0, dy = 0;
    if (isSelected && isDragging) {
        dx = dragOffset.x;
        dy = dragOffset.y;
    }

    const commonProps = {
        key: el.id,
        stroke: el.strokeColor || 'black',
        strokeWidth: el.strokeWidth || 2,
        fill: el.fillColor || 'transparent',
    };

    let elementNode: React.ReactNode = null;
    let statsNode: React.ReactNode = null;
    let handlesNode: React.ReactNode = null;

    if (el.type === 'rectangle') {
      const rect = el as RectangleElement;
      const x = rect.x + dx;
      const y = rect.y + dy;
      const w = rect.width;
      const h = rect.height;
      
      elementNode = (
        <rect
          {...commonProps}
          x={x} y={y} width={w} height={h}
          className={`${isSelected && selectedIds.size === 1 ? 'stroke-blue-500 stroke-[3px] opacity-90' : ''}`}
        />
      );

      if (showMeasurements) {
          const area = Math.round(w * h);
          const perim = Math.round(2 * (w + h));
          statsNode = (
              <>
                <MathLabel x={x + w/2 - 20} y={y - 10}>{Math.round(w)}</MathLabel>
                <MathLabel x={x - 45} y={y + h/2 + 5}>{Math.round(h)}</MathLabel>
                <InfoBox x={x + w + 10} y={y} lines={[`Perim: ${perim}`, `Area: ${area}`]} />
              </>
          );
      }
      
      if (isSelected && selectedIds.size === 1) {
          handlesNode = (
             <rect x={x + w - 4} y={y + h - 4} width={8} height={8} fill="white" stroke="#3b82f6" strokeWidth={2} style={{cursor: 'nwse-resize'}} />
          );
      }

    } else if (el.type === 'circle') {
      const circ = el as CircleElement;
      const cx = circ.x + dx;
      const cy = circ.y + dy;
      const r = circ.radius;
      
      elementNode = (
        <circle
          {...commonProps}
          cx={cx} cy={cy} r={r}
          className={`${isSelected && selectedIds.size === 1 ? 'stroke-blue-500 stroke-[3px] opacity-90' : ''}`}
        />
      );
      
      if (showMeasurements && r > 0) {
        const d = r * 2;
        const c = 2 * Math.PI * r;
        const a = Math.PI * r * r;
        statsNode = (
            <InfoBox x={cx + r + 10} y={cy - 40} lines={[
                `r: ${r.toFixed(1)}`,
                `d: ${d.toFixed(1)}`,
                `circ: ${c.toFixed(1)}`,
                `area: ${a.toFixed(0)}`
            ]} />
        );
      }

      if (isSelected && selectedIds.size === 1) {
        handlesNode = (
           <circle cx={cx + r} cy={cy} r={4} fill="white" stroke="#3b82f6" strokeWidth={2} style={{cursor: 'ew-resize'}} />
        );
      }

    } else if (el.type === 'triangle') {
        const tri = el as TriangleElement;
        const p1 = { x: tri.p1.x + dx, y: tri.p1.y + dy };
        const p2 = { x: tri.p2.x + dx, y: tri.p2.y + dy };
        const p3 = { x: tri.p3.x + dx, y: tri.p3.y + dy };

        elementNode = (
            <path
                {...commonProps}
                d={`M ${p1.x} ${p1.y} L ${p2.x} ${p2.y} L ${p3.x} ${p3.y} Z`}
                className={`${isSelected && selectedIds.size === 1 ? 'stroke-blue-500 stroke-[3px] opacity-90' : ''}`}
            />
        );

        if (showMeasurements) {
            const { A, B, C, a, b, c } = getTriangleAngles(p1, p2, p3);
            const area = getTriangleArea(p1, p2, p3);
            const centroid = { x: (p1.x + p2.x + p3.x) / 3, y: (p1.y + p2.y + p3.y) / 3 };

            const m12 = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
            const m23 = { x: (p2.x + p3.x) / 2, y: (p2.y + p3.y) / 2 };
            const m31 = { x: (p3.x + p1.x) / 2, y: (p3.y + p1.y) / 2 };

            statsNode = (
                <>
                    <text x={p1.x + 10} y={p1.y} fontSize="10" fill="red">{A.toFixed(0)}°</text>
                    <text x={p2.x - 10} y={p2.y + 15} fontSize="10" fill="red">{B.toFixed(0)}°</text>
                    <text x={p3.x + 10} y={p3.y + 15} fontSize="10" fill="red">{C.toFixed(0)}°</text>

                    <MathLabel x={m12.x} y={m12.y}>{c.toFixed(0)}</MathLabel>
                    <MathLabel x={m23.x} y={m23.y}>{a.toFixed(0)}</MathLabel>
                    <MathLabel x={m31.x} y={m31.y}>{b.toFixed(0)}</MathLabel>

                    <InfoBox x={centroid.x} y={centroid.y} lines={[`Area: ${area.toFixed(0)}`]} />
                </>
            );
        }

        if (isSelected && selectedIds.size === 1) {
            handlesNode = (
                <>
                    <circle cx={p1.x} cy={p1.y} r={4} fill="white" stroke="#3b82f6" strokeWidth={2} style={{cursor: 'move'}} />
                    <circle cx={p2.x} cy={p2.y} r={4} fill="white" stroke="#3b82f6" strokeWidth={2} style={{cursor: 'move'}} />
                    <circle cx={p3.x} cy={p3.y} r={4} fill="white" stroke="#3b82f6" strokeWidth={2} style={{cursor: 'move'}} />
                </>
            );
        }

    } else if (el.type === 'arrow') {
      const arrow = el as ArrowElement;
      const startX = arrow.x + dx;
      const startY = arrow.y + dy;
      const endX = arrow.endX + dx;
      const endY = arrow.endY + dy;
      
      elementNode = (
        <g key={el.id} className={`${isSelected ? 'opacity-80' : ''}`}>
             {isSelected && selectedIds.size === 1 && (
                <line x1={startX} y1={startY} x2={endX} y2={endY} stroke="#3b82f6" strokeWidth={(arrow.strokeWidth || 2) + 6} opacity="0.3" />
            )}
            <line x1={startX} y1={startY} x2={endX} y2={endY} stroke={arrow.strokeColor} strokeWidth={arrow.strokeWidth} markerEnd="url(#arrowhead)" />
        </g>
      );

      if (showMeasurements) {
          const len = distance({x: startX, y: startY}, {x: endX, y: endY});
          if (len > 0) {
            const midX = (startX + endX) / 2;
            const midY = (startY + endY) / 2;
            statsNode = <InfoBox x={midX} y={midY - 10} lines={[`L: ${len.toFixed(1)}`]} />;
          }
      }

      if (isSelected && selectedIds.size === 1) {
        handlesNode = (
           <>
             <circle cx={startX} cy={startY} r={4} fill="white" stroke="#3b82f6" strokeWidth={2} style={{cursor: 'move'}} />
             <circle cx={endX} cy={endY} r={4} fill="white" stroke="#3b82f6" strokeWidth={2} style={{cursor: 'move'}} />
           </>
        );
      }

    } else if (el.type === 'pencil') {
      const pencil = el as PencilElement;
      const offsetPoints = pencil.points.map(p => ({ x: p.x + dx, y: p.y + dy }));
      const d = getSvgPathFromPoints(offsetPoints);
      elementNode = (
        <g key={el.id}>
             {isSelected && selectedIds.size === 1 && (
                <path d={d} stroke="#3b82f6" strokeWidth={(pencil.strokeWidth || 2) + 6} fill="none" opacity="0.3" strokeLinecap="round" strokeLinejoin="round" />
             )}
            <path d={d} stroke={pencil.strokeColor} strokeWidth={pencil.strokeWidth} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      );
    }

    if (!elementNode) return null;

    return (
        <React.Fragment key={el.id}>
            {elementNode}
            {statsNode}
            {handlesNode}
        </React.Fragment>
    );
  };

  const gridSize = 40 * view.scale;
  const elementsToRender = tempElements || elements;

  // Calculate Selection Bounds for Multi-Select Box
  let selectionBoundsRect = null;
  let miniToolbarPos = null;

  if (selectedIds.size > 0) {
      const selectedElements = elementsToRender
          .filter(el => selectedIds.has(el.id))
          .map(el => {
            // Apply current drag offset if dragging
            if (isDragging && dragOffset && (dragOffset.x !== 0 || dragOffset.y !== 0)) {
                // Return a mock element with offset for bounds calc
                if(el.type === 'rectangle') { const r=el as RectangleElement; return {...r, x:r.x+dragOffset.x, y:r.y+dragOffset.y}; }
                if(el.type === 'circle') { const c=el as CircleElement; return {...c, x:c.x+dragOffset.x, y:c.y+dragOffset.y}; }
                if(el.type === 'triangle') { const t=el as TriangleElement; return {...t, p1:{x:t.p1.x+dragOffset.x, y:t.p1.y+dragOffset.y}, p2:{x:t.p2.x+dragOffset.x, y:t.p2.y+dragOffset.y}, p3:{x:t.p3.x+dragOffset.x, y:t.p3.y+dragOffset.y} }; }
                if(el.type === 'arrow') { const a=el as ArrowElement; return {...a, x:a.x+dragOffset.x, y:a.y+dragOffset.y, endX:a.endX+dragOffset.x, endY:a.endY+dragOffset.y}; }
                if(el.type === 'pencil') { const p=el as PencilElement; return {...p, points:p.points.map(pt=>({x:pt.x+dragOffset.x, y:pt.y+dragOffset.y}))}; }
            }
            return el;
          });
      
      const bounds = getCommonBounds(selectedElements);
      if (bounds) {
          selectionBoundsRect = (
              <rect 
                  x={bounds.minX - 5} 
                  y={bounds.minY - 5} 
                  width={bounds.maxX - bounds.minX + 10} 
                  height={bounds.maxY - bounds.minY + 10} 
                  fill="none" 
                  stroke="#3b82f6" 
                  strokeWidth={1.5} 
                  strokeDasharray="4 2"
                  pointerEvents="none"
              />
          );
          
          // Calculate screen position for mini toolbar
          const topCenterWorld = { x: (bounds.minX + bounds.maxX) / 2, y: bounds.minY };
          miniToolbarPos = worldToScreen(topCenterWorld, view);
      }
  }

  const cursorStyle = activeTool === ToolType.ERASER ? 'none' 
    : activeTool === ToolType.HAND ? (isDragging ? 'grabbing' : 'grab')
    : activeTool === ToolType.SELECT ? 'default'
    : 'crosshair';

  return (
    <div className="w-full h-full relative overflow-hidden bg-[#f9f9f9]">
      <Toolbar 
        activeTool={activeTool} 
        setActiveTool={(t) => { setActiveTool(t); setCurrentElement(null); setTriangleStep(0); }} 
        activeColor={activeColor}
        setActiveColor={setActiveColor}
        activeStrokeWidth={activeStrokeWidth}
        setActiveStrokeWidth={setActiveStrokeWidth}
        undo={undo}
        redo={redo}
        canUndo={canUndo}
        canRedo={canRedo}
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
        // Disable context menu
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
          </defs>

          <rect x="0" y="0" width="100%" height="100%" fill="url(#grid-pattern)" />

          <g transform={`translate(${view.x}, ${view.y}) scale(${view.scale})`}>
            {elementsToRender.map(renderElement)}
            {currentElement && renderElement(currentElement)}
            
            {/* Multi-selection Bounding Box */}
            {selectionBoundsRect}

            {/* Drag Selection Box */}
            {selectionBox && (
                 <rect
                    x={Math.min(selectionBox.start.x, selectionBox.end.x)}
                    y={Math.min(selectionBox.start.y, selectionBox.end.y)}
                    width={Math.abs(selectionBox.end.x - selectionBox.start.x)}
                    height={Math.abs(selectionBox.end.y - selectionBox.start.y)}
                    fill="rgba(59, 130, 246, 0.1)"
                    stroke="#3b82f6"
                    strokeWidth={1}
                    rx={4}
                 />
            )}
          </g>
        </svg>

        {/* Custom Eraser Cursor */}
        {activeTool === ToolType.ERASER && cursorPos && (
            <div 
                className="fixed pointer-events-none rounded-full border-2 border-gray-400 bg-white/50 z-50 flex items-center justify-center shadow-sm"
                style={{
                    left: cursorPos.x,
                    top: cursorPos.y,
                    width: ERASER_RADIUS * 2,
                    height: ERASER_RADIUS * 2,
                    transform: 'translate(-50%, -50%)',
                }}
            >
                <div className="w-1 h-1 bg-gray-600 rounded-full" />
            </div>
        )}
      </div>
      
      {/* Mini Toolbar for Delete */}
      {miniToolbarPos && selectedIds.size > 0 && !isDragging && (
          <MiniToolbar x={miniToolbarPos.x} y={miniToolbarPos.y} onDelete={deleteSelected} />
      )}

      {/* Bottom Right Controls Container */}
      <div className="fixed right-4 bottom-4 flex flex-col-reverse items-end gap-3 sm:flex-row sm:items-center z-50 pointer-events-none select-none">
         {/* Branding */}
         <div className="pointer-events-auto bg-white/90 backdrop-blur-sm px-3 py-1.5 rounded-full shadow-sm border border-gray-200 flex items-center gap-1 transition-all opacity-70 hover:opacity-100">
             <span className="text-[10px] text-gray-400 font-medium">Powered by</span>
             <span className="text-[10px] font-bold text-gray-700 tracking-tight">Al-Xorazmiy School</span>
         </div>

         {/* Zoom Controls */}
         <div className="pointer-events-auto bg-white p-1.5 rounded-lg shadow-lg border border-gray-200 flex gap-1 items-center text-sm text-gray-600">
             <button onClick={() => setView(v => ({...v, scale: Math.max(v.scale - 0.2, ZOOM_MIN)}))} className="w-7 h-7 flex items-center justify-center hover:bg-gray-100 rounded text-lg text-gray-500" title="Zoom Out">-</button>
             <span className="w-10 text-center text-xs font-medium tabular-nums">{Math.round(view.scale * 100)}%</span>
             <button onClick={() => setView(v => ({...v, scale: Math.min(v.scale + 0.2, ZOOM_MAX)}))} className="w-7 h-7 flex items-center justify-center hover:bg-gray-100 rounded text-lg text-gray-500" title="Zoom In">+</button>
         </div>
      </div>

      {activeTool === ToolType.TRIANGLE && (
          <div className="fixed top-4 left-1/2 -translate-x-1/2 bg-blue-600 text-white px-4 py-2 rounded-full shadow-lg text-sm font-medium animate-fade-in pointer-events-none select-none">
              {triangleStep === 0 ? "Click to place 1st point" : triangleStep === 1 ? "Click to place 2nd point" : "Click to place 3rd point"}
          </div>
      )}
    </div>
  );
};