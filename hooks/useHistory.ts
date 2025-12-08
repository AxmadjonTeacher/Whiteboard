import { useState, useCallback } from 'react';
import { WhiteboardElement } from '../types';

export const useHistory = (initialElements: WhiteboardElement[]) => {
  const [history, setHistory] = useState<WhiteboardElement[][]>([initialElements]);
  const [currentIndex, setCurrentIndex] = useState(0);

  const pushToHistory = useCallback((elements: WhiteboardElement[]) => {
    // If we are not at the end of history, discard future states
    const newHistory = history.slice(0, currentIndex + 1);
    newHistory.push(elements);
    
    // Limit history size if needed (e.g. 50 steps)
    if (newHistory.length > 50) {
      newHistory.shift();
    } else {
        // Only increment if we didn't shift
    }
    
    setHistory(newHistory);
    setCurrentIndex(newHistory.length - 1);
  }, [history, currentIndex]);

  const undo = useCallback(() => {
    if (currentIndex > 0) {
      setCurrentIndex(prev => prev - 1);
      return history[currentIndex - 1];
    }
    return null;
  }, [history, currentIndex]);

  const redo = useCallback(() => {
    if (currentIndex < history.length - 1) {
      setCurrentIndex(prev => prev + 1);
      return history[currentIndex + 1];
    }
    return null;
  }, [history, currentIndex]);

  return {
    elements: history[currentIndex],
    pushToHistory,
    undo,
    redo,
    canUndo: currentIndex > 0,
    canRedo: currentIndex < history.length - 1
  };
};