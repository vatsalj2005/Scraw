import { useEffect, useRef, useState } from 'react';
import { useStore } from './store';
import { MsgType } from '@scraw/shared';

export const Canvas = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const roomId = useStore(state => state.roomId);
  const isDrawing = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });
  const localBatch = useRef<number[]>([]);
  const [size, setSize] = useState({ w: 800, h: 600 });
  
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);

  useEffect(() => {
    const onResize = () => {
      if (canvasRef.current?.parentElement) {
        setSize({
          w: canvasRef.current.parentElement.clientWidth,
          h: canvasRef.current.parentElement.clientHeight
        });
      }
    };
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Handle high-DPI scaling (Retina displays)
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size.w * dpr;
    canvas.height = size.h * dpr;
    ctx.scale(dpr, dpr);
    
    // Wipe and reset styles
    ctx.clearRect(0, 0, size.w, size.h);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctxRef.current = ctx;

    let animationFrameId: number;
    let remotePos = { x: 0, y: 0 };
    let remoteColor = '#fff';
    let remoteWidth = 5;
    
    const renderLoop = () => {
      const state = useStore.getState();
      const queue = state.remoteStrokesQueue;
      while (queue.length > 0) {
        const msg = queue.shift();
        if (msg[0] === MsgType.DRAW_START) {
            remotePos = { x: msg[1], y: msg[2] };
            remoteColor = msg[3];
            remoteWidth = msg[4];
            
            ctx.strokeStyle = remoteColor;
            ctx.lineWidth = remoteWidth;
            ctx.beginPath();
            ctx.moveTo(remotePos.x, remotePos.y);
            ctx.lineTo(remotePos.x, remotePos.y);
            ctx.stroke();
        } else if (msg[0] === MsgType.DRAW_MOVE) {
            const deltas = msg[1] as number[];
            if (deltas.length > 0) {
              ctx.strokeStyle = remoteColor;
              ctx.lineWidth = remoteWidth;
              ctx.beginPath();
              ctx.moveTo(remotePos.x, remotePos.y);
              for (let i = 0; i < deltas.length; i += 2) {
                  remotePos.x += deltas[i];
                  remotePos.y += deltas[i+1];
                  ctx.lineTo(remotePos.x, remotePos.y);
              }
              ctx.stroke();
            }
        }
      }

      if (localBatch.current.length > 0) {
        useStore.getState().sendBatch([MsgType.DRAW_MOVE, localBatch.current]);
        localBatch.current = [];
      }

      animationFrameId = requestAnimationFrame(renderLoop);
    };
    renderLoop();

    return () => cancelAnimationFrame(animationFrameId);
  }, [size, roomId]);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    
    isDrawing.current = true;
    lastPos.current = { 
      x: e.clientX - rect.left, 
      y: e.clientY - rect.top 
    };
    
    const ctx = ctxRef.current;
    if (ctx) {
        ctx.strokeStyle = '#ff0055';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(lastPos.current.x, lastPos.current.y);
        ctx.lineTo(lastPos.current.x, lastPos.current.y);
        ctx.stroke();
    }
    useStore.getState().sendBatch([MsgType.DRAW_START, lastPos.current.x, lastPos.current.y, '#ff0055', 5]);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDrawing.current || !canvasRef.current) return;
    
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    const ctx = ctxRef.current;
    if (ctx) {
        ctx.beginPath();
        ctx.moveTo(lastPos.current.x, lastPos.current.y);
        ctx.lineTo(x, y);
        ctx.stroke();
    }

    const dx = x - lastPos.current.x;
    const dy = y - lastPos.current.y;
    localBatch.current.push(dx, dy);

    lastPos.current = { x, y };
  };

  return (
    <canvas 
      ref={canvasRef} 
      width={size.w} 
      height={size.h} 
      onPointerDown={handlePointerDown} 
      onPointerMove={handlePointerMove} 
      onPointerUp={() => isDrawing.current = false}
      style={{ display: 'block', background: '#1c1c1c', cursor: 'crosshair', touchAction: 'none' }}
    />
  );
};
