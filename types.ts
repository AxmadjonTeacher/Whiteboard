export enum ToolType {
  SELECT = 'SELECT',
  HAND = 'HAND',
  RECTANGLE = 'RECTANGLE',
  CIRCLE = 'CIRCLE',
  TRIANGLE = 'TRIANGLE',
  ARROW = 'ARROW',
  PENCIL = 'PENCIL',
  ERASER = 'ERASER',
}

export interface Point {
  x: number;
  y: number;
}

export type ElementType = 'rectangle' | 'circle' | 'triangle' | 'arrow' | 'pencil';

export interface BaseElement {
  id: string;
  type: ElementType;
  x: number;
  y: number;
  rotation?: number;
  strokeColor?: string;
  fillColor?: string;
  strokeWidth?: number;
}

export interface RectangleElement extends BaseElement {
  type: 'rectangle';
  width: number;
  height: number;
}

export interface CircleElement extends BaseElement {
  type: 'circle';
  radius: number;
}

export interface TriangleElement extends BaseElement {
  type: 'triangle';
  p1: Point;
  p2: Point;
  p3: Point;
}

export interface ArrowElement extends BaseElement {
  type: 'arrow';
  endX: number;
  endY: number;
}

export interface PencilElement extends BaseElement {
  type: 'pencil';
  points: Point[];
}

export type WhiteboardElement = 
  | RectangleElement 
  | CircleElement 
  | TriangleElement
  | ArrowElement 
  | PencilElement;

export interface ViewState {
  x: number;
  y: number;
  scale: number;
}

export const COLORS = [
  '#000000', // Black
  '#e03131', // Red
  '#2f9e44', // Green
  '#1971c2', // Blue
  '#f08c00', // Orange
];

export const STROKE_WIDTHS = [2, 4, 6];