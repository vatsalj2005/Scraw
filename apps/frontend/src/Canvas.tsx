import { useEffect, useRef } from 'react';
import { useStore } from './store';
import { MsgType } from '@scraw/shared';

export const Canvas = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const roomId = useStore(state => state.roomId);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const isDrawing = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });
  const localBatch = useRef<number[]>([]);

  // Internal resolution constant (16:9)
  const INTERNAL_W = 1920;
  const INTERNAL_H = 1080;

  const getCoordinates = (e: React.PointerEvent) => {
    if (!canvasRef.current) return { x: 0, y: 0 };
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    
    // (MousePos - ElementOffset) * (InternalPixels / DisplayedCSSPixels)
    const x = (e.clientX - rect.left) * (INTERNAL_W / rect.width);
    const y = (e.clientY - rect.top) * (INTERNAL_H / rect.height);
    
    return { x, y };
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    const { x, y } = getCoordinates(e);
    isDrawing.current = true;
    lastPos.current = { x, y };
    
    const ctx = ctxRef.current;
    if (ctx) {
        ctx.strokeStyle = '#ff0055';
        ctx.lineWidth = 10;
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

  useEffect(() => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Fixed Internal resolution guarantees perfect cross-device sync
    canvas.width = INTERNAL_W;
    canvas.height = INTERNAL_H;
    
    ctx.clearRect(0, 0, INTERNAL_W, INTERNAL_H);
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
            const deltas = msg[1] as number[];
            const pState = remoteStates.get(playerId);
            if (pState && deltas.length > 0) {
              ctx.strokeStyle = pState.color;
              ctx.lineWidth = pState.width;
              ctx.beginPath();
              ctx.moveTo(pState.x, pState.y);
              for (let i = 0; i < deltas.length; i += 2) {
                  pState.x += deltas[i];
                  pState.y += deltas[i+1];
                  ctx.lineTo(pState.x, pState.y);
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
  }, [roomId]);

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center', background: '#0a0a0a' }}>
      <canvas 
        ref={canvasRef} 
        onPointerDown={handlePointerDown} 
        onPointerMove={handlePointerMove} 
        onPointerUp={() => isDrawing.current = false}
        onPointerLeave={() => isDrawing.current = false}
        style={{ 
          maxWidth: '100%', 
          maxHeight: '100%', 
          aspectRatio: '16/9',
          background: '#1c1c1c', 
          cursor: 'crosshair', 
          touchAction: 'none',
          boxShadow: '0 0 40px rgba(0,0,0,0.5)'
        }}
      />
    </div>
  );
};
