"use client";

import { Activity, Camera, History, Pause, Maximize2 } from 'lucide-react';
import { useEffect, useState } from 'react';

export default function Home() {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame(f => (f + 1) % 4);
    }, 500);
    return () => clearInterval(timer);
  }, []);

  const idleFrames = ['👀', '👁️', '👀', '😌'];

  return (
    <div className="flex flex-col h-screen w-full bg-slate-900/80 backdrop-blur-xl text-slate-100 font-sans border border-slate-700/50 rounded-2xl overflow-hidden shadow-2xl p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-full bg-slate-800/80 border border-slate-700 flex items-center justify-center text-xl shadow-inner">
            {idleFrames[frame]}
          </div>
          <div className="flex flex-col">
            <h1 className="text-sm font-bold tracking-wide text-slate-100 flex items-center gap-2">
              groundhog-monorepo
              <span className="bg-cyan-500/20 text-cyan-400 text-[10px] px-1.5 py-0.5 rounded-full uppercase font-bold tracking-wider border border-cyan-500/30">
                watching
              </span>
            </h1>
            <span className="text-xs text-slate-400 font-medium">feat/masterpiece-cli</span>
          </div>
        </div>
      </div>

      {/* Context Card */}
      <div className="flex flex-col flex-grow bg-slate-800/50 rounded-xl border border-slate-700/50 p-3 mb-4 shadow-inner relative overflow-hidden">
        {/* Glow effect */}
        <div className="absolute -top-10 -right-10 w-32 h-32 bg-cyan-500/10 blur-3xl rounded-full"></div>
        <div className="absolute -bottom-10 -left-10 w-32 h-32 bg-fuchsia-500/10 blur-3xl rounded-full"></div>

        <div className="z-10 flex flex-col gap-3">
          <div>
            <div className="text-[10px] uppercase font-bold text-slate-500 mb-1 flex items-center gap-1">
              <Activity size={10} className="text-fuchsia-400" /> Current Task
            </div>
            <p className="text-sm text-slate-200 font-medium leading-snug">
              Implementing the glassmorphism Tray UI with TailwindCSS and Lucide React.
            </p>
          </div>

          <div>
            <div className="flex items-center justify-between text-[10px] uppercase font-bold text-slate-500 mb-1">
              <span>Context Confidence</span>
              <span className="text-cyan-400">87%</span>
            </div>
            <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden border border-slate-700/50">
              <div className="h-full bg-gradient-to-r from-cyan-500 to-fuchsia-500 w-[87%] rounded-full shadow-[0_0_10px_rgba(6,182,212,0.5)]"></div>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Actions Grid */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        <button className="flex flex-col items-center justify-center gap-1.5 bg-gradient-to-br from-cyan-600/90 to-blue-600/90 hover:from-cyan-500 hover:to-blue-500 transition-all border border-cyan-400/30 rounded-xl p-3 shadow-lg shadow-cyan-900/20 group">
          <Camera size={18} className="text-white group-hover:scale-110 transition-transform" />
          <span className="text-xs font-bold text-white shadow-sm">Snap & Copy</span>
        </button>
        <button className="flex flex-col items-center justify-center gap-1.5 bg-slate-800/80 hover:bg-slate-700/80 transition-all border border-slate-700 rounded-xl p-3 group">
          <Pause size={18} className="text-amber-400 group-hover:scale-110 transition-transform" />
          <span className="text-xs font-medium text-slate-300">Pause</span>
        </button>
        <button className="flex flex-col items-center justify-center gap-1.5 bg-slate-800/80 hover:bg-slate-700/80 transition-all border border-slate-700 rounded-xl p-3 group">
          <History size={18} className="text-fuchsia-400 group-hover:scale-110 transition-transform" />
          <span className="text-xs font-medium text-slate-300">History</span>
        </button>
        <button className="flex flex-col items-center justify-center gap-1.5 bg-slate-800/80 hover:bg-slate-700/80 transition-all border border-slate-700 rounded-xl p-3 group">
          <Maximize2 size={18} className="text-emerald-400 group-hover:scale-110 transition-transform" />
          <span className="text-xs font-medium text-slate-300">Open App</span>
        </button>
      </div>

      {/* Footer */}
      <div className="mt-auto text-center">
        <span className="text-[10px] text-slate-500 font-medium">
          Encrypted Cloud Sync • <span className="text-emerald-500">Last synced 2m ago</span>
        </span>
      </div>
    </div>
  );
}
