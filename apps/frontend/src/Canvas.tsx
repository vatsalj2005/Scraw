import { useEffect, useRef } from 'react';
import { useStore } from './store';
import { MsgType } from '@scraw/shared';

export const Canvas = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const roomId = useStore(state => state.roomId);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const isDrawing = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });

  // Fixed canvas size - same for all devices
  const CANVAS_W = 1200;
  const CANVAS_H = 700;

  const getCoordinates = (e: React.PointerEvent) => {
    if (!canvasRef.current) return { x: 0, y: 0 };
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    
    const clientX = e.clientX - rect.left;
    const clientY = e.clientY - rect.top;
    
    const x = (clientX / rect.width) * CANVAS_W;
    const y = (clientY / rect.height) * CANVAS_H;
    
    return { x, y };
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const { x, y } = getCoordinates(e);
    isDrawing.current = true;
    lastPos.current = { x, y };
    
    const ctx = ctxRef.current;
    if (ctx) {
        ctx.strokeStyle = '#ff0055';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(x, y);
    }
    useStore.getState().sendBatch([MsgType.DRAW_START, x, y, '#ff0055', 3]);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDrawing.current) return;
    e.preventDefault();
    
    const { x, y } = getCoordinates(e);
    const ctx = ctxRef.current;
    if (ctx) {
        ctx.lineTo(x, y);
        ctx.stroke();
    }

    lastPos.current = { x, y };
    useStore.getState().sendBatch([MsgType.DRAW_MOVE, x, y]);
  };

  const handlePointerEnd = () => {
    isDrawing.current = false;
  };

  useEffect(() => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Fixed canvas resolution
    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;
    
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctxRef.current = ctx;

    let animationFrameId: number;
    const remoteStates = new Map<string, { x: number, y: number, color: string, width: number }>();
    
    const renderLoop = () => {
      const state = useStore.getState();
      const queue = state.remoteStrokesQueue;
      while (queue.length > 0) {
        const msg = queue.shift();
        const type = msg[0];
        const playerId = msg[msg.length - 1];

        if (type === MsgType.DRAW_START) {
            const x = msg[1];
            const y = msg[2];
            const color = msg[3];
            const width = msg[4];
            remoteStates.set(playerId, { x, y, color, width });

            ctx.strokeStyle = color;
            ctx.lineWidth = width;
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x, y);
            ctx.stroke();
        } else if (type === MsgType.DRAW_MOVE) {
            const x = msg[1];
            const y = msg[2];
            const pState = remoteStates.get(playerId);
            if (pState) {
              ctx.strokeStyle = pState.color;
              ctx.lineWidth = pState.width;
              ctx.beginPath();
              ctx.moveTo(pState.x, pState.y);
              ctx.lineTo(x, y);
              ctx.stroke();
              pState.x = x;
              pState.y = y;
            }
        }
      }

      animationFrameId = requestAnimationFrame(renderLoop);
    };
    renderLoop();

    return () => cancelAnimationFrame(animationFrameId);
  }, [roomId]);

  return (
    <div style={{ 
      width: '100%', 
      height: '100%', 
      display: 'flex', 
      justifyContent: 'center', 
      alignItems: 'center', 
      background: '#0a0a0a',
      overflow: 'auto',
      padding: '20px'
    }}>
      <canvas 
        ref={canvasRef} 
        onPointerDown={handlePointerDown} 
        onPointerMove={handlePointerMove} 
        onPointerUp={handlePointerEnd}
        onPointerLeave={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        style={{ 
          width: `${CANVAS_W}px`,
          height: `${CANVAS_H}px`,
          maxWidth: '100%',
          maxHeight: '100%',
          background: '#1c1c1c', 
          cursor: 'crosshair', 
          touchAction: 'none',
          boxShadow: '0 0 40px rgba(0,0,0,0.5)',
          display: 'block',
          border: '2px solid #333'
        }}
      />
    </div>
  );
};
