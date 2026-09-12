import { CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { AudioPlayer } from "./audio";

export function useAudioPlayer() {
  const playerRef = useRef<AudioPlayer | null>(null);
  const [audio, setAudio] = useState(() => new AudioPlayer().getSnapshot());

  useEffect(() => {
    const player = new AudioPlayer();
    playerRef.current = player;
    const unsubscribe = player.subscribe(() => setAudio(player.getSnapshot()));
    setAudio(player.getSnapshot());
    return () => {
      unsubscribe();
      playerRef.current = null;
      player.dispose();
    };
  }, []);

  const player = useMemo(() => ({
    unlock: () => playerRef.current?.unlock(),
    setFiles: (files: File[]) => playerRef.current?.setFiles(files),
    toggle: () => playerRef.current?.toggle(),
    toggleMute: () => playerRef.current?.toggleMute(),
    setVolume: (value: number) => playerRef.current?.setVolume(value),
    changeVolume: (delta: number) => {
      const current = playerRef.current;
      if (current) current.setVolume((current.getSnapshot().muted ? 0 : current.getSnapshot().volume) + delta);
    },
    next: () => playerRef.current?.next(),
    previous: () => playerRef.current?.previous(),
    getLevels: () => playerRef.current?.getLevels() ?? [0, 0, 0],
  }), []);

  return { audio, player };
}

type MusicControlsProps = ReturnType<typeof useAudioPlayer> & { visible: boolean };

export function MusicControls({ audio, player, visible }: MusicControlsProps) {
  const barsRef = useRef<HTMLSpanElement>(null);
  const [focused, setFocused] = useState(false);
  const track = audio.tracks[audio.trackIndex];
  const volume = Math.round((audio.muted ? 0 : audio.volume) * 100);

  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let animationFrame = 0;
    const reset = () => {
      if (!barsRef.current) return;
      for (const bar of barsRef.current.children) (bar as HTMLElement).style.removeProperty("transform");
    };
    const draw = () => {
      if (motion.matches || !audio.playing || (!visible && !focused)) { reset(); return; }
      const levels = player.getLevels();
      if (barsRef.current) {
        Array.from(barsRef.current.children).forEach((bar, index) => {
          (bar as HTMLElement).style.transform = `scaleY(${0.45 + Math.min(1, levels[index]) * 0.75})`;
        });
      }
      animationFrame = requestAnimationFrame(draw);
    };
    const restart = () => { cancelAnimationFrame(animationFrame); draw(); };
    draw();
    motion.addEventListener("change", restart);
    return () => { cancelAnimationFrame(animationFrame); motion.removeEventListener("change", restart); reset(); };
  }, [audio.playing, focused, player, visible]);

  return (
    <div className="music-controls" role="group" aria-label="Music" onFocus={() => setFocused(true)} onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
    }}>
      <button
        type="button"
        className={`icon-button music-button ${audio.playing ? "playing" : ""}`}
        onClick={player.toggle}
        aria-label={audio.playing ? "Pause music" : "Play music"}
        aria-keyshortcuts="A"
        aria-describedby="music-status"
        aria-busy={audio.loading}
        title={`${audio.playing ? "Pause" : "Play"} music (A)${track ? ` · ${track.name}` : ""}`}
      >
        {audio.playing ? <span ref={barsRef} className="music-levels" aria-hidden="true"><i /><i /></span> : (
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16"><path d="M5 3.5 12 8l-7 4.5z" fill="currentColor" /></svg>
        )}
        <span className="music-mark" aria-hidden="true" />
      </button>
      <label className="volume-control" style={{ "--volume": `${volume}%` } as CSSProperties} title={`Music volume: ${volume}% (− / =). M to mute.`}>
        <span className="volume-bar" aria-hidden="true"><span /></span>
        <input
          type="range"
          min="0"
          max="100"
          step="1"
          value={volume}
          onChange={(event) => player.setVolume(Number(event.target.value) / 100)}
          aria-label="Music volume"
          aria-orientation="vertical"
          aria-valuetext={audio.muted ? "Muted" : `${volume}%`}
        />
      </label>
      <span id="music-status" className="sr-only" role="status">{audio.loading ? "Preparing music" : audio.playing ? "Playing" : "Music paused"}{track ? `: ${track.name}` : ""}</span>
    </div>
  );
}
