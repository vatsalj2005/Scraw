import { useEffect, useRef } from 'react';
import { useStore } from './store';
import { MsgType } from './protocol';

const CANVAS_W = 1200;
const CANVAS_H = 700;
const STROKE_COLOR = '#ff0055';
const STROKE_WIDTH = 3;

export const Canvas = () => {
  const canvasRef = useRef(null);
  const roomId = useStore((state) => state.roomId);
  const sessionId = useStore((state) => state.sessionId);
  const ctxRef = useRef(null);

  const isDrawing = useRef(false);
  const currentPath = useRef([]);

  const getCoords = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return [0, 0];
    }

    const rect = canvas.getBoundingClientRect();
    const scaleX = CANVAS_W / rect.width;
    const scaleY = CANVAS_H / rect.height;
    return [
      (e.clientX - rect.left) * scaleX,
      (e.clientY - rect.top) * scaleY,
    ];
  };

  const drawStroke = (ctx, points, color, width) => {
    if (!Array.isArray(points) || points.length === 0) {
      return;
    }

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);

    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i][0], points[i][1]);
    }

    if (points.length === 1) {
      ctx.lineTo(points[0][0] + 0.1, points[0][1] + 0.1);
    }

    ctx.stroke();
    ctx.restore();
  };

  const handlePointerDown = (e) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    canvas.setPointerCapture(e.pointerId);

    const [x, y] = getCoords(e);
    isDrawing.current = true;
    currentPath.current = [[x, y]];

    const ctx = ctxRef.current;
    if (ctx) {
      ctx.save();
      ctx.strokeStyle = STROKE_COLOR;
      ctx.lineWidth = STROKE_WIDTH;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.restore();
    }
  };

  const handlePointerMove = (e) => {
    if (!isDrawing.current) {
      return;
    }

    e.preventDefault();
    const [x, y] = getCoords(e);
    const path = currentPath.current;
    const prev = path[path.length - 1];
    path.push([x, y]);

    const ctx = ctxRef.current;
    if (ctx && prev) {
      ctx.save();
      ctx.strokeStyle = STROKE_COLOR;
      ctx.lineWidth = STROKE_WIDTH;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(prev[0], prev[1]);
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.restore();
    }
  };

  const handlePointerEnd = (e) => {
    if (!isDrawing.current) {
      return;
    }

    isDrawing.current = false;
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.releasePointerCapture(e.pointerId);
    }

    const path = currentPath.current;
    if (path.length === 0) {
      return;
    }

    useStore.getState().sendBatch([MsgType.STROKE, STROKE_COLOR, STROKE_WIDTH, path]);
    currentPath.current = [];
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return undefined;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return undefined;
    }

    isDrawing.current = false;
    currentPath.current = [];

    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    ctxRef.current = ctx;

    let animId = 0;
    const renderLoop = () => {
      const queue = useStore.getState().remoteStrokesQueue;
      while (queue.length > 0) {
        const msg = queue.shift();
        if (!Array.isArray(msg) || msg[0] !== MsgType.STROKE) {
          continue;
        }

        const color = msg[1];
        const width = msg[2];
        const points = msg[3];
        drawStroke(ctx, points, color, width);
      }

      animId = requestAnimationFrame(renderLoop);
    };

    renderLoop();
    return () => cancelAnimationFrame(animId);
  }, [roomId, sessionId]);

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        background: '#0a0a0a',
        overflow: 'hidden',
        boxSizing: 'border-box',
        padding: '20px',
      }}
    >
      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerLeave={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        style={{
          aspectRatio: `${CANVAS_W} / ${CANVAS_H}`,
          width: '100%',
          height: 'auto',
          maxWidth: `${CANVAS_W}px`,
          maxHeight: `${CANVAS_H}px`,
          background: '#1c1c1c',
          cursor: 'crosshair',
          touchAction: 'none',
          boxShadow: '0 0 40px rgba(0,0,0,0.5)',
          display: 'block',
          border: '2px solid #333',
        }}
      />
    </div>
  );
};
