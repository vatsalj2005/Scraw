import { useEffect, useState } from 'react';
import { useStore } from './store';
import { Canvas } from './Canvas';

function App() {
  const connect = useStore(state => state.connect);
  const [roomId, setRoomId] = useState('room1');

  useEffect(() => {
    connect(roomId);
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw' }}>
      <div style={{ padding: '20px', background: 'linear-gradient(to right, #111, #333)', color: 'white', display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: '0 4px 6px rgba(0,0,0,0.3)' }}>
        <h1 style={{ margin: 0, fontSize: '24px', letterSpacing: '1px', fontWeight: 'bold' }}>Scraw</h1>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
           <span style={{ fontSize: '14px', color: '#aaa'}}>Room</span>
           <input style={{ padding: '8px 12px', borderRadius: '4px', border: '1px solid #444', background: '#222', color: '#fff' }} value={roomId} onChange={e => setRoomId(e.target.value)} />
           <button style={{ padding: '8px 16px', borderRadius: '4px', border: 'none', background: '#ff0055', color: '#fff', cursor: 'pointer', fontWeight: 'bold' }} onClick={() => connect(roomId)}>Join</button>
        </div>
      </div>
      <div style={{ flex: 1 }}>
         <Canvas />
      </div>
    </div>
  );
}

export default App;
