import { useEffect, useRef } from 'react';

export function CollidingBlobsCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
 
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
 
    const setSize = () => {
      const rect = canvas.parentElement!.getBoundingClientRect();
      canvas.width = rect.width || window.innerWidth;
      canvas.height = rect.height || 500;
    };
 
    const sizeTimer = setTimeout(setSize, 50);
    window.addEventListener('resize', setSize);
 
    const isDark = () => document.documentElement.classList.contains('dark');
 
    const getCSSVar = (name: string) =>
      getComputedStyle(document.documentElement).getPropertyValue(name).trim();
 
    const toRgba = (color: string, alpha: number): string => {
      if (color.startsWith('rgb')) {
        const parts = color.replace(/rgba?\(/, '').replace(')', '').split(',').slice(0, 3).join(',');
        return `rgba(${parts}, ${alpha})`;
      }
      if (color.startsWith('#')) {
        const h = color.replace('#', '');
        const r = parseInt(h.slice(0, 2), 16);
        const g = parseInt(h.slice(2, 4), 16);
        const b = parseInt(h.slice(4, 6), 16);
        return `rgba(${r},${g},${b},${alpha})`;
      }
      return `rgba(128,128,128,${alpha})`;
    };
 
    const buildPalette = () => {
      const primary = getCSSVar('--primary') || '#073a40';
      const accent = getCSSVar('--accent') || '#79654e';
      const hover = getCSSVar('--primary-hover') || primary;
      return [primary, accent, primary, hover, accent, primary];
    };
 
    let COLORS = buildPalette();
 
    const themeObserver = new MutationObserver(() => {
      COLORS = buildPalette();
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
 
    type Particle = {
      x: number; y: number;
      vx: number; vy: number;
      alpha: number; radius: number; color: string;
      decay: number;
    };
 
    type Blob = {
      x: number; y: number;
      vx: number; vy: number;
      radius: number;
      color: string;
      alive: boolean;
      respawnTimer: number;
    };
 
    const particles: Particle[] = [];
    let blobs: Blob[] = [];
 
    const spawnBlob = (): Blob => {
      const w = canvas.width || 800;
      const h = canvas.height || 500;
      const side = Math.floor(Math.random() * 4);
      const r = 55 + Math.random() * 35;
      const speed = 0.9 + Math.random() * 0.8;
 
      const tx = w * 0.3 + Math.random() * w * 0.4;
      const ty = h * 0.3 + Math.random() * h * 0.4;
 
      let x = 0, y = 0;
      if (side === 0) { x = Math.random() * w; y = -r; }
      else if (side === 1) { x = Math.random() * w; y = h + r; }
      else if (side === 2) { x = -r; y = Math.random() * h; }
      else { x = w + r; y = Math.random() * h; }
 
      const angle = Math.atan2(ty - y, tx - x);
      return {
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        radius: r,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        alive: true,
        respawnTimer: 0,
      };
    };
 
    const explode = (x: number, y: number, color: string) => {
      const count = 50 + Math.floor(Math.random() * 30);
      for (let i = 0; i < count; i++) {
        const angle = (Math.PI * 2 * i) / count + Math.random() * 0.4;
        const speed = 2 + Math.random() * 5;
        particles.push({
          x, y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          alpha: 1,
          radius: 2.5 + Math.random() * 4,
          color,
          decay: 0.01 + Math.random() * 0.015,
        });
      }
    };
 
    const blobTimer = setTimeout(() => {
      blobs = Array.from({ length: 8 }, spawnBlob);
    }, 60);
 
    let animId: number;
 
    const draw = () => {
      animId = requestAnimationFrame(draw);
 
      if (!canvas.width || !canvas.height) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
 
      const dark = isDark();
 
      for (let i = 0; i < blobs.length; i++) {
        const b = blobs[i];
 
        if (!b.alive) {
          b.respawnTimer--;
          if (b.respawnTimer <= 0) Object.assign(b, spawnBlob());
          continue;
        }
 
        b.x += b.vx;
        b.y += b.vy;
 
        if (b.x - b.radius < 0) { b.x = b.radius; b.vx *= -1; }
        if (b.x + b.radius > canvas.width) { b.x = canvas.width - b.radius; b.vx *= -1; }
        if (b.y - b.radius < 0) { b.y = b.radius; b.vy *= -1; }
        if (b.y + b.radius > canvas.height) { b.y = canvas.height - b.radius; b.vy *= -1; }
 
        for (let j = i + 1; j < blobs.length; j++) {
          const b2 = blobs[j];
          if (!b2.alive) continue;
          const dx = b2.x - b.x;
          const dy = b2.y - b.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < b.radius + b2.radius) {
            explode((b.x + b2.x) / 2, (b.y + b2.y) / 2, b.color);
            explode((b.x + b2.x) / 2, (b.y + b2.y) / 2, b2.color);
            b.alive = false;
            b2.alive = false;
            b.respawnTimer = 80 + Math.floor(Math.random() * 60);
            b2.respawnTimer = 80 + Math.floor(Math.random() * 60);
          }
        }
 
        if (!b.alive) continue;
 
        const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.radius);
        g.addColorStop(0, toRgba(b.color, dark ? 0.86 : 1.0));
        g.addColorStop(0.4, toRgba(b.color, dark ? 0.6 : 0.73));
        g.addColorStop(1, toRgba(b.color, 0));
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
        ctx.fillStyle = g;
        ctx.shadowBlur = 25;
        ctx.shadowColor = b.color;
        ctx.fill();
        ctx.shadowBlur = 0;
      }
 
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vx *= 0.96;
        p.vy *= 0.96;
        p.vy += 0.05;
        p.alpha -= p.decay;
        if (p.alpha <= 0) { particles.splice(i, 1); continue; }
 
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius * p.alpha, 0, Math.PI * 2);
        ctx.fillStyle = toRgba(p.color, p.alpha);
        ctx.shadowBlur = 8;
        ctx.shadowColor = p.color;
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    };
 
    draw();
 
    return () => {
      cancelAnimationFrame(animId);
      clearTimeout(sizeTimer);
      clearTimeout(blobTimer);
      window.removeEventListener('resize', setSize);
      themeObserver.disconnect();
    };
  }, []);
 
  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 3,
        opacity: 0.45,
        display: 'block',
      }}
    />
  );
}

export default CollidingBlobsCanvas;
