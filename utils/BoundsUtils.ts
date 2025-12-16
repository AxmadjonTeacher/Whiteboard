import { 
  Point, 
  WhiteboardElement, 
  RectangleElement, 
  CircleElement, 
  TriangleElement, 
  ArrowElement, 
  PencilElement,
  ImageElement
} from '../types';
import { distance, isPointNearLine, isPointInTriangle } from '../utils';

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export const getElementBounds = (el: WhiteboardElement): Bounds => {
  if (el.type === 'rectangle' || el.type === 'image') {
    const r = el as (RectangleElement | ImageElement);
    const x = Math.min(r.x, r.x + r.width);
    const y = Math.min(r.y, r.y + r.height);
    const w = Math.abs(r.width);
    const h = Math.abs(r.height);
    return { minX: x, minY: y, maxX: x + w, maxY: y + h };
  } 
  else if (el.type === 'circle') {
    const c = el as CircleElement;
    return { 
      minX: c.x - c.radius, 
      minY: c.y - c.radius, 
      maxX: c.x + c.radius, 
      maxY: c.y + c.radius 
    };
  } 
  else if (el.type === 'triangle') {
    const t = el as TriangleElement;
    const xs = [t.p1.x, t.p2.x, t.p3.x];
    const ys = [t.p1.y, t.p2.y, t.p3.y];
    return {
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      maxX: Math.max(...xs),
      maxY: Math.max(...ys)
    };
  } 
  else if (el.type === 'arrow') {
    const a = el as ArrowElement;
    return {
      minX: Math.min(a.x, a.endX),
      minY: Math.min(a.y, a.endY),
      maxX: Math.max(a.x, a.endX),
      maxY: Math.max(a.y, a.endY)
    };
  } 
  else if (el.type === 'pencil') {
    const p = el as PencilElement;
    if (p.points.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    const xs = p.points.map(pt => pt.x);
    const ys = p.points.map(pt => pt.y);
    return {
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      maxX: Math.max(...xs),
      maxY: Math.max(...ys)
    };
  }
  return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
};

export const getCommonBounds = (elements: WhiteboardElement[]): Bounds | null => {
  if (elements.length === 0) return null;
  
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  elements.forEach(el => {
    const b = getElementBounds(el);
    minX = Math.min(minX, b.minX);
    minY = Math.min(minY, b.minY);
    maxX = Math.max(maxX, b.maxX);
    maxY = Math.max(maxY, b.maxY);
  });

  return { minX, minY, maxX, maxY };
};

export const isPointInBounds = (p: Point, b: Bounds, padding = 0): boolean => {
  return p.x >= b.minX - padding && p.x <= b.maxX + padding && 
         p.y >= b.minY - padding && p.y <= b.maxY + padding;
};

export const doBoundsIntersect = (b1: Bounds, b2: Bounds): boolean => {
  return !(b2.minX > b1.maxX || 
           b2.maxX < b1.minX || 
           b2.minY > b1.maxY || 
           b2.maxY < b1.minY);
};

export const hitTestElement = (el: WhiteboardElement, pos: Point, zoom: number): boolean => {
  const threshold = 10 / zoom;

  if (el.type === 'rectangle' || el.type === 'image') {
      const r = el as (RectangleElement | ImageElement);
      const x = Math.min(r.x, r.x + r.width);
      const y = Math.min(r.y, r.y + r.height);
      const w = Math.abs(r.width);
      const h = Math.abs(r.height);
      return pos.x >= x && pos.x <= x + w && pos.y >= y && pos.y <= y + h;
  } 
  else if (el.type === 'circle') {
      const c = el as CircleElement;
      return distance(pos, { x: c.x, y: c.y }) <= c.radius;
  } 
  else if (el.type === 'triangle') {
      const t = el as TriangleElement;
      return isPointInTriangle(pos, t.p1, t.p2, t.p3);
  } 
  else if (el.type === 'arrow') {
      const a = el as ArrowElement;
      return isPointNearLine(pos, {x: a.x, y: a.y}, {x: a.endX, y: a.endY}, threshold);
  } 
  else if (el.type === 'pencil') {
      const p = el as PencilElement;
      const bounds = getElementBounds(p);
      if (!isPointInBounds(pos, bounds, threshold)) return false;
      for(let k = 0; k < p.points.length - 1; k++) {
         if (isPointNearLine(pos, p.points[k], p.points[k+1], threshold)) return true;
      }
      return false;
  }
  return false;
};