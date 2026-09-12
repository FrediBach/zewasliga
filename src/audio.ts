import { compareMediaFiles, isAudioFile, mediaPath } from "./media.ts";

export type AudioTrack = { file: File; name: string; path: string };
export type AudioPlayerState = {
  tracks: AudioTrack[];
  trackIndex: number;
  playing: boolean;
  loading: boolean;
  volume: number;
  muted: boolean;
  error: string | null;
};

type Segment = {
  index: number;
  source: AudioBufferSourceNode;
  gain: GainNode;
  start: number;
  end: number;
  offset: number;
  edge: number;
};
type ReadyTrack = { index: number; buffer: AudioBuffer };

const EDGE_SECONDS = 0.004;
const CONTROL_FADE_SECONDS = 0.015;
const START_LEAD_SECONDS = 0.025;

export function tracksFromFiles(files: File[]): AudioTrack[] {
  return files.filter(isAudioFile).sort(compareMediaFiles).map(file => ({ file, name: file.name, path: mediaPath(file) }));
}

/** Local, decoded playback: the next source starts on the audio clock, never from an ended handler. */
export class AudioPlayer {
  private state: AudioPlayerState = {
    tracks: [], trackIndex: 0, playing: false, loading: false, volume: 0.65, muted: false, error: null,
  };
  private readonly listeners = new Set<() => void>();
  private readonly createContext: () => AudioContext;
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private frequencies = new Uint8Array(128);
  private volumeRamp = { from: 0.65, to: 0.65, start: 0, end: 0 };
  private buffers = new Map<number, AudioBuffer>();
  private decodes = new Map<number, Promise<AudioBuffer | null>>();
  private failed = new Set<number>();
  private queue: Segment[] = [];
  private offset = 0;
  private seekDirection = 1;
  private readyAt = 0;
  private libraryVersion = 0;
  private playbackVersion = 0;
  private fillTask: { version: number; promise: Promise<void> } | null = null;
  private disposed = false;

  constructor(createContext: () => AudioContext = () => new AudioContext({ latencyHint: "playback" })) {
    this.createContext = createContext;
  }

  getSnapshot = (): AudioPlayerState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private update(patch: Partial<AudioPlayerState>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  private getContext(): AudioContext {
    if (!this.context) {
      this.context = this.createContext();
      this.master = this.context.createGain();
      this.master.gain.value = this.state.muted ? 0 : this.state.volume;
      const volume = this.master.gain.value;
      this.volumeRamp = { from: volume, to: volume, start: 0, end: 0 };
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.78;
      this.master.connect(this.analyser);
      this.analyser.connect(this.context.destination);
      let wasRunning = this.context.state === "running";
      this.context.onstatechange = () => {
        const interrupted = wasRunning && this.context?.state !== "running";
        wasRunning = this.context?.state === "running";
        if (!this.disposed && interrupted && this.state.playing) {
          this.pause();
          this.update({ error: "Audio was interrupted. Press play to continue." });
        }
      };
    }
    return this.context;
  }

  /** Call in a user gesture, before opening an asynchronous directory picker. */
  async unlock(): Promise<void> {
    if (this.disposed) return;
    try {
      const context = this.getContext();
      // resume() is invoked synchronously, while the gesture is still active.
      if (context.state !== "running") await context.resume();
    } catch {
      // A second gesture may have successfully resumed while this older request was pending.
      if (this.context?.state !== "running") {
        this.update({ playing: false, loading: false, error: "Audio could not start. Press play to try again." });
      }
    }
  }

  setFiles(files: File[]): void {
    if (this.disposed) return;
    this.stopQueue();
    this.libraryVersion += 1;
    const version = ++this.playbackVersion;
    this.buffers.clear();
    this.decodes.clear();
    this.failed.clear();
    this.offset = 0;
    this.seekDirection = 1;
    const tracks = tracksFromFiles(files);
    const playing = tracks.length > 0 && this.context?.state === "running";
    this.update({ tracks, trackIndex: 0, playing, loading: tracks.length > 0, error: null });
    if (!tracks.length) return;
    if (playing) void this.requestFill(version);
    else void this.warmPaused(version);
  }

  async play(): Promise<void> {
    if (this.disposed || !this.state.tracks.length || this.state.playing) return;
    const version = ++this.playbackVersion;
    this.update({ playing: true, loading: true, error: null });
    await this.unlock();
    if (!this.isCurrent(version)) return;
    if (this.context?.state !== "running") {
      this.update({ playing: false, loading: false, error: "Audio could not start. Press play to try again." });
      return;
    }
    await this.requestFill(version);
  }

  pause(): void {
    if (this.disposed || !this.state.playing) return;
    const position = this.positionAt((this.context?.currentTime ?? 0) + CONTROL_FADE_SECONDS);
    this.playbackVersion += 1;
    this.offset = position.offset;
    this.stopQueue();
    this.update({ playing: false, loading: false, trackIndex: position.index });
    this.trimBuffers([position.index, this.wrap(position.index + 1)]);
  }

  toggle(): void {
    if (this.state.playing) this.pause();
    else void this.play();
  }

  next(): void { this.skip(1); }
  previous(): void { this.skip(-1); }

  private skip(direction: number) {
    if (this.disposed || !this.state.tracks.length) return;
    const index = this.wrap(this.positionAt(this.context?.currentTime ?? 0).index + direction);
    const version = ++this.playbackVersion;
    this.stopQueue();
    this.offset = 0;
    this.seekDirection = direction;
    this.update({ trackIndex: index, loading: true, error: null });
    if (this.state.playing) void this.requestFill(version);
    else void this.warmPaused(version);
  }

  setVolume(value: number): void {
    if (this.disposed || !Number.isFinite(value)) return;
    const volume = Math.max(0, Math.min(1, value));
    this.update({ volume, muted: volume > 0 ? false : this.state.muted });
    this.applyVolume();
  }

  toggleMute(): void {
    if (this.disposed) return;
    this.update({ muted: !this.state.muted });
    this.applyVolume();
  }

  private applyVolume() {
    if (!this.context || !this.master) return;
    const now = this.context.currentTime;
    const ramp = this.volumeRamp;
    const progress = ramp.end <= ramp.start ? 1 : Math.max(0, Math.min(1, (now - ramp.start) / (ramp.end - ramp.start)));
    const from = ramp.from + (ramp.to - ramp.from) * progress;
    const to = this.state.muted ? 0 : this.state.volume;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(from, now);
    this.master.gain.linearRampToValueAtTime(to, now + CONTROL_FADE_SECONDS);
    this.volumeRamp = { from, to, start: now, end: now + CONTROL_FADE_SECONDS };
  }

  getLevels(): number[] {
    if (!this.analyser || !this.state.playing || this.context?.state !== "running") return [0, 0, 0];
    this.analyser.getByteFrequencyData(this.frequencies);
    return [[1, 6], [6, 24], [24, 80]].map(([start, end]) => {
      let energy = 0;
      for (let index = start; index < end; index += 1) energy += (this.frequencies[index] / 255) ** 2;
      return Math.sqrt(energy / (end - start));
    });
  }

  private wrap(index: number): number {
    return (index + this.state.tracks.length) % this.state.tracks.length;
  }

  private isCurrent(version: number): boolean {
    return !this.disposed && version === this.playbackVersion;
  }

  private async decode(index: number): Promise<AudioBuffer | null> {
    if (this.buffers.has(index)) return this.buffers.get(index)!;
    if (this.failed.has(index)) return null;
    const existing = this.decodes.get(index);
    if (existing) return existing;
    const libraryVersion = this.libraryVersion;
    const file = this.state.tracks[index].file;
    const promise = (async () => {
      try {
        const context = this.getContext();
        const bytes = await file.arrayBuffer();
        if (this.disposed || libraryVersion !== this.libraryVersion) return null;
        const buffer = await context.decodeAudioData(bytes);
        if (this.disposed || libraryVersion !== this.libraryVersion) return null;
        if (!Number.isFinite(buffer.duration) || buffer.duration <= 0) throw new Error("Empty audio");
        this.buffers.set(index, buffer);
        // A decode from a cancelled play/skip can still finish. Keep those completions bounded too.
        if (this.buffers.size > 3) {
          const keep = [...new Set([...this.queue.map(segment => segment.index), this.state.trackIndex, index])].slice(0, 3);
          this.trimBuffers(keep);
        }
        return buffer;
      } catch {
        if (!this.disposed && libraryVersion === this.libraryVersion) {
          this.failed.add(index);
          this.update({ error: `Could not play ${file.name}; skipping this track.` });
        }
        return null;
      } finally {
        if (libraryVersion === this.libraryVersion) this.decodes.delete(index);
      }
    })();
    this.decodes.set(index, promise);
    return promise;
  }

  private async findPlayable(index: number, version: number, direction = 1): Promise<ReadyTrack | null> {
    for (let attempt = 0; attempt < this.state.tracks.length && this.isCurrent(version); attempt += 1) {
      const candidate = this.wrap(index + attempt * direction);
      const buffer = await this.decode(candidate);
      if (!this.isCurrent(version)) return null;
      if (buffer) return { index: candidate, buffer };
    }
    return null;
  }

  private noPlayableTracks() {
    this.update({ playing: false, loading: false, error: "None of the audio files could be played. Try another folder." });
  }

  private async warmPaused(version: number) {
    const first = await this.findPlayable(this.state.trackIndex, version, this.seekDirection);
    if (!this.isCurrent(version)) return;
    if (!first) { this.noPlayableTracks(); return; }
    this.update({ trackIndex: first.index, loading: false });
    const next = await this.findPlayable(first.index + 1, version);
    if (this.isCurrent(version)) this.trimBuffers([first.index, ...(next ? [next.index] : [])]);
  }

  private requestFill(version: number): Promise<void> {
    if (!this.isCurrent(version) || !this.state.playing) return Promise.resolve();
    if (this.fillTask?.version === version) return this.fillTask.promise;
    const promise = this.fill(version).catch(() => {
      if (!this.isCurrent(version)) return;
      this.stopQueue();
      this.update({ playing: false, loading: false, error: "Audio playback stopped. Press play to try again." });
    }).finally(() => {
      if (this.fillTask?.version === version) this.fillTask = null;
    });
    this.fillTask = { version, promise };
    return promise;
  }

  private async fill(version: number) {
    if (!this.queue.length) {
      const first = await this.findPlayable(this.state.trackIndex, version, this.seekDirection);
      if (!this.isCurrent(version)) return;
      if (!first) { this.noPlayableTracks(); return; }
      // The first handoff is decoded before playback starts, even for very short tracks.
      const next = await this.findPlayable(first.index + 1, version);
      if (!this.isCurrent(version) || !next) return;
      const offset = first.index === this.state.trackIndex ? Math.min(this.offset, Math.max(0, first.buffer.duration - 0.001)) : 0;
      const when = Math.max(this.getContext().currentTime + START_LEAD_SECONDS, this.readyAt);
      const current = this.schedule(first, when, offset, version);
      this.schedule(next, current.end, 0, version);
      this.offset = 0;
      this.update({ trackIndex: first.index, loading: false });
    }

    while (this.isCurrent(version) && this.state.playing) {
      while (this.queue.length < 2) {
        const tail = this.queue.at(-1);
        const next = await this.findPlayable(tail ? tail.index + 1 : this.state.trackIndex, version);
        if (!this.isCurrent(version) || !next) return;
        const when = Math.max(tail?.end ?? 0, this.getContext().currentTime + START_LEAD_SECONDS);
        this.schedule(next, when, 0, version);
        if (this.queue.length === 1) this.update({ trackIndex: next.index, loading: false });
      }
      // Keep a third track decoded so replenishing the queue does not wait on disk/decoder.
      const tail = this.queue.at(-1)!;
      const reserve = await this.findPlayable(tail.index + 1, version);
      if (!this.isCurrent(version)) return;
      this.trimBuffers([...this.queue.map(segment => segment.index), ...(reserve ? [reserve.index] : [])]);
      if (this.queue.length >= 2) return;
    }
  }

  private schedule(track: ReadyTrack, start: number, offset: number, version: number): Segment {
    const context = this.getContext();
    const source = context.createBufferSource();
    source.buffer = track.buffer;
    const gain = context.createGain();
    source.connect(gain);
    gain.connect(this.master!);
    const duration = track.buffer.duration - offset;
    const end = start + duration;
    const edge = Math.min(EDGE_SECONDS, duration / 2);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(1, start + edge);
    gain.gain.setValueAtTime(1, end - edge);
    gain.gain.linearRampToValueAtTime(0, end);
    const segment = { index: track.index, source, gain, start, end, offset, edge };
    this.queue.push(segment);
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
      if (!this.isCurrent(version)) return;
      this.queue = this.queue.filter(item => item !== segment);
      if (!this.state.playing) return;
      const first = this.queue[0];
      this.update({ trackIndex: first?.index ?? this.wrap(segment.index + 1), loading: !first });
      void this.requestFill(version);
    };
    source.start(start, offset);
    return segment;
  }

  private positionAt(time: number): { index: number; offset: number } {
    for (const segment of this.queue) {
      if (time < segment.end) return { index: segment.index, offset: segment.offset + Math.max(0, time - segment.start) };
    }
    const last = this.queue.at(-1);
    return { index: last ? this.wrap(last.index + 1) : this.state.trackIndex, offset: last ? 0 : this.offset };
  }

  private stopQueue() {
    if (!this.context) return;
    const now = this.context.currentTime;
    this.readyAt = now + CONTROL_FADE_SECONDS;
    for (const segment of this.queue) {
      const { source, gain, start, end, edge } = segment;
      source.onended = () => { source.disconnect(); gain.disconnect(); };
      gain.gain.cancelScheduledValues(now);
      if (start > now || end <= now) {
        gain.gain.setValueAtTime(0, now);
        source.stop(now);
      } else {
        const level = Math.min(1, (now - start) / edge, (end - now) / edge);
        gain.gain.setValueAtTime(Math.max(0, level), now);
        gain.gain.linearRampToValueAtTime(0, this.readyAt);
        source.stop(this.readyAt);
      }
    }
    this.queue = [];
  }

  private trimBuffers(keep: number[]) {
    for (const index of this.buffers.keys()) if (!keep.includes(index)) this.buffers.delete(index);
  }

  dispose(): void {
    if (this.disposed) return;
    this.stopQueue();
    this.disposed = true;
    this.libraryVersion += 1;
    this.playbackVersion += 1;
    this.listeners.clear();
    this.buffers.clear();
    this.decodes.clear();
    if (this.context) void this.context.close().catch(() => {});
  }
}
