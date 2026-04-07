import { useEffect, useRef, useState } from 'react';
import { useStore } from './store';
import { MsgType } from '@scraw/shared';

const VIRTUAL_SIZE = 2000;

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
        const p = canvasRef.current.parentElement;
        let w = p.clientWidth;
        let h = w * (9 / 16);
        
        // If 16:9 is too tall for container
        if (h > p.clientHeight) {
            h = p.clientHeight;
            w = h * (16 / 9);
        }
        setSize({ w, h });
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
    
    // Wipe and reset styles
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctxRef.current = ctx;

    let animationFrameId: number;
    
    // Per-player tracking for smooth multi-user drawing
    const remoteStates = new Map<string, { x: number, y: number, color: string, width: number }>();
    
    const renderLoop = () => {
      const state = useStore.getState();
      const queue = state.remoteStrokesQueue;
      while (queue.length > 0) {
        const msg = queue.shift();
        const type = msg[0];
        const playerId = msg[msg.length - 1]; // Sender ID is always last

        if (type === MsgType.DRAW_START) {
            const x = msg[1];
            const y = msg[2];
            const color = msg[3];
            const width = msg[4];
            
            remoteStates.set(playerId, { x, y, color, width });

            const lx = (x / VIRTUAL_SIZE) * canvas.width;
            const ly = (y / VIRTUAL_SIZE) * canvas.height;

            ctx.strokeStyle = color;
            ctx.lineWidth = (width / VIRTUAL_SIZE) * canvas.width;
            ctx.beginPath();
            ctx.moveTo(lx, ly);
            ctx.lineTo(lx, ly);
            ctx.stroke();
        } else if (type === MsgType.DRAW_MOVE) {
            const deltas = msg[1] as number[];
            const pState = remoteStates.get(playerId);
            
            if (pState && deltas.length > 0) {
              ctx.strokeStyle = pState.color;
              ctx.lineWidth = (pState.width / VIRTUAL_SIZE) * canvas.width;
              
              let lx1 = (pState.x / VIRTUAL_SIZE) * canvas.width;
              let ly1 = (pState.y / VIRTUAL_SIZE) * canvas.height;
              
              ctx.beginPath();
              ctx.moveTo(lx1, ly1);
              for (let i = 0; i < deltas.length; i += 2) {
                  pState.x += deltas[i];
                  pState.y += deltas[i+1];
                  const lx2 = (pState.x / VIRTUAL_SIZE) * canvas.width;
                  const ly2 = (pState.y / VIRTUAL_SIZE) * canvas.height;
                  ctx.lineTo(lx2, ly2);
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

  const getCoordinates = (e: React.PointerEvent) => {
    if (!canvasRef.current) return { x: 0, y: 0 };
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    
    // This formula is foolproof: (MousePos - ElementOffset) * (InternalPixels / CSSPixels)
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);
    
    return { x, y };
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    const { x, y } = getCoordinates(e);
    isDrawing.current = true;
    lastPos.current = { x, y };
    
    const ctx = ctxRef.current;
    if (ctx) {
        ctx.strokeStyle = '#ff0055';
        ctx.lineWidth = 10; // Slightly larger for better visibility
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, y);
        ctx.stroke();
    }
    useStore.getState().sendBatch([MsgType.DRAW_START, x, y, '#ff0055', 10]);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDrawing.current) return;
    
    const { x, y } = getCoordinates(e);
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
      style={{ 
        display: 'block', 
        background: '#1c1c1c', 
        cursor: 'crosshair', 
        touchAction: 'none',
        width: `${size.w}px`,
        height: `${size.h}px`
      }}
    />
  );
};
