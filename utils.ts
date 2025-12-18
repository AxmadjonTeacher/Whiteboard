import { 
  Point, 
  ViewState, 
  WhiteboardElement, 
  RectangleElement, 
  CircleElement, 
  TriangleElement, 
  ArrowElement, 
  PencilElement,
  ImageElement
} from './types';

export const generateId = (): string => {
  return Math.random().toString(36).substr(2, 9);
};

export const screenToWorld = (point: Point, view: ViewState): Point => {
  return {
    x: (point.x - view.x) / view.scale,
    y: (point.y - view.y) / view.scale,
  };
};

export const worldToScreen = (point: Point, view: ViewState): Point => {
  return {
    x: point.x * view.scale + view.x,
    y: point.y * view.scale + view.y,
  };
};

export const distance = (a: Point, b: Point): number => {
  return Math.sqrt(Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2));
};

export const getSvgPathFromPoints = (points: Point[]): string => {
  if (points.length === 0) return '';
  const first = points[0];
  let d = `M ${first.x} ${first.y}`;
  for (let i = 1; i < points.length; i++) {
    d += ` L ${points[i].x} ${points[i].y}`;
  }
  return d;
};

// Basic hit detection
export const isPointNearLine = (p: Point, a: Point, b: Point, threshold: number): boolean => {
  const len = distance(a, b);
  if (len === 0) return distance(p, a) < threshold;
  
  const dist = Math.abs((b.y - a.y) * p.x - (b.x - a.x) * p.y + b.x * a.y - b.y * a.x) / len;
  
  // Check if point is within the segment bounds
  const minX = Math.min(a.x, b.x) - threshold;
  const maxX = Math.max(a.x, b.x) + threshold;
  const minY = Math.min(a.y, b.y) - threshold;
  const maxY = Math.max(a.y, b.y) + threshold;
  
  return dist < threshold && p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY;
};

// Triangle Math Helpers
export const getTriangleArea = (p1: Point, p2: Point, p3: Point): number => {
  return 0.5 * Math.abs(p1.x * (p2.y - p3.y) + p2.x * (p3.y - p1.y) + p3.x * (p1.y - p2.y));
};

export const getTriangleAngles = (p1: Point, p2: Point, p3: Point) => {
  const a2 = Math.pow(distance(p2, p3), 2);
  const b2 = Math.pow(distance(p1, p3), 2);
  const c2 = Math.pow(distance(p1, p2), 2);
  
  const a = Math.sqrt(a2);
  const b = Math.sqrt(b2);
  const c = Math.sqrt(c2);

  const radToDeg = (rad: number) => rad * (180 / Math.PI);

  // Law of Cosines
  const A = radToDeg(Math.acos((b2 + c2 - a2) / (2 * b * c))) || 0;
  const B = radToDeg(Math.acos((a2 + c2 - b2) / (2 * a * c))) || 0;
  const C = radToDeg(Math.acos((a2 + b2 - c2) / (2 * a * b))) || 0;

  return { A, B, C, a, b, c };
};

export const isPointInTriangle = (p: Point, p1: Point, p2: Point, p3: Point): boolean => {
    const areaOrig = getTriangleArea(p1, p2, p3);
    const area1 = getTriangleArea(p, p2, p3);
    const area2 = getTriangleArea(p1, p, p3);
    const area3 = getTriangleArea(p1, p2, p);
    return Math.abs(areaOrig - (area1 + area2 + area3)) < 1; 
};

const interpolatePoints = (p1: Point, p2: Point, spacing: number): Point[] => {
    const dist = distance(p1, p2);
    const steps = Math.ceil(dist / spacing);
    const points: Point[] = [];
    for (let i = 0; i < steps; i++) {
        const t = i / steps;
        points.push({
            x: p1.x + (p2.x - p1.x) * t,
            y: p1.y + (p2.y - p1.y) * t
        });
    }
    return points;
};

// Convert any shape to a dense array of points (Polyline)
export const convertShapeToPoints = (el: WhiteboardElement, spacing: number = 5): Point[] => {
    const points: Point[] = [];
    
    if (el.type === 'pencil') {
        const pencil = el as PencilElement;
        for (let i = 0; i < pencil.points.length - 1; i++) {
            points.push(...interpolatePoints(pencil.points[i], pencil.points[i+1], spacing));
        }
        points.push(pencil.points[pencil.points.length - 1]);
    } else if (el.type === 'rectangle' || el.type === 'image') {
        const r = el as (RectangleElement | ImageElement);
        const p1 = { x: r.x, y: r.y };
        const p2 = { x: r.x + r.width, y: r.y };
        const p3 = { x: r.x + r.width, y: r.y + r.height };
        const p4 = { x: r.x, y: r.y + r.height };
        points.push(...interpolatePoints(p1, p2, spacing));
        points.push(...interpolatePoints(p2, p3, spacing));
        points.push(...interpolatePoints(p3, p4, spacing));
        points.push(...interpolatePoints(p4, p1, spacing));
        points.push(p1);
    } else if (el.type === 'triangle') {
        const t = el as TriangleElement;
        points.push(...interpolatePoints(t.p1, t.p2, spacing));
        points.push(...interpolatePoints(t.p2, t.p3, spacing));
        points.push(...interpolatePoints(t.p3, t.p1, spacing));
        points.push(t.p1);
    } else if (el.type === 'circle') {
        const c = el as CircleElement;
        const steps = Math.ceil((2 * Math.PI * c.radius) / spacing);
        for (let i = 0; i <= steps; i++) {
            const angle = (i / steps) * 2 * Math.PI;
            points.push({ x: c.x + c.radius * Math.cos(angle), y: c.y + c.radius * Math.sin(angle) });
        }
    } else if (el.type === 'arrow') {
        const a = el as ArrowElement;
        points.push(...interpolatePoints({x: a.x, y: a.y}, {x: a.endX, y: a.endY}, spacing));
        points.push({x: a.endX, y: a.endY});
    }

    return points;
};

// Check if an element bounds overlap with eraser roughly
export const isElementRoughlyIntersecting = (el: WhiteboardElement, eraser: Point, radius: number): boolean => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    
    const updateBounds = (x: number, y: number) => {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
    };

    if (el.type === 'pencil') {
        (el as PencilElement).points.forEach(p => updateBounds(p.x, p.y));
    } else if (el.type === 'rectangle' || el.type === 'image') {
        const r = el as (RectangleElement | ImageElement);
        updateBounds(r.x, r.y);
        updateBounds(r.x + r.width, r.y + r.height);
    } else if (el.type === 'circle') {
        const c = el as CircleElement;
        updateBounds(c.x - c.radius, c.y - c.radius);
        updateBounds(c.x + c.radius, c.y + c.radius);
    } else if (el.type === 'triangle') {
        const t = el as TriangleElement;
        updateBounds(t.p1.x, t.p1.y);
        updateBounds(t.p2.x, t.p2.y);
        updateBounds(t.p3.x, t.p3.y);
    } else if (el.type === 'arrow') {
        const a = el as ArrowElement;
        updateBounds(a.x, a.y);
        updateBounds(a.endX, a.endY);
    }

    const padding = (el.strokeWidth || 2) + radius;
    return (
        eraser.x >= minX - padding &&
        eraser.x <= maxX + padding &&
        eraser.y >= minY - padding &&
        eraser.y <= maxY + padding
    );
};