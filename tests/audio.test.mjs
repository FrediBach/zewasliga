import assert from "node:assert/strict";
import test from "node:test";
import { AudioPlayer, tracksFromFiles } from "../src/audio.ts";

class FakeParam {
  value = 1;
  events = [];
  setValueAtTime(value, time) { this.events.push({ type: "set", value, time }); }
  linearRampToValueAtTime(value, time) { this.events.push({ type: "ramp", value, time }); }
  cancelScheduledValues(time) { this.events.push({ type: "cancel", time }); }
}

class FakeNode {
  connect() {}
  disconnect() { this.disconnected = true; }
}

class FakeSource extends FakeNode {
  buffer = null;
  onended = null;
  start(when, offset) {
    assert.equal(this.when, undefined, "one-shot sources must never be reused");
    this.when = when;
    this.offset = offset;
    this.end = when + this.buffer.duration - offset;
  }
  stop(when) { this.stoppedAt = when; }
  finish() { if (!this.ended) { this.ended = true; this.onended?.(); } }
}

class FakeContext {
  currentTime = 0;
  state = "suspended";
  destination = new FakeNode();
  sources = [];
  gains = [];
  decoded = [];
  resumeCalls = 0;
  onstatechange = null;
  failures = new Set();
  gates = new Map();
  durations = new Map();
  resumeError = false;
  async resume() {
    this.resumeCalls += 1;
    if (this.resumeError) throw new Error("blocked");
    this.state = "running";
    this.onstatechange?.();
  }
  async close() { this.state = "closed"; this.onstatechange?.(); }
  createGain() {
    const node = new FakeNode();
    node.gain = new FakeParam();
    this.gains.push(node);
    return node;
  }
  createAnalyser() {
    const node = new FakeNode();
    node.getByteFrequencyData = data => data.fill(128);
    return node;
  }
  createBufferSource() {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  }
  async decodeAudioData(bytes) {
    const id = new Uint8Array(bytes)[0];
    this.decoded.push(id);
    if (this.gates.has(id)) await this.gates.get(id);
    if (this.failures.has(id)) throw new Error("bad audio");
    return { id, duration: this.durations.get(id) ?? 10 };
  }
  advance(time, deliverEvents = true) {
    this.currentTime = time;
    if (deliverEvents) {
      for (const source of [...this.sources]) {
        if (Math.min(source.end, source.stoppedAt ?? Infinity) <= time) source.finish();
      }
    }
  }
}

function track(id, name = `track${id}.mp3`) {
  return new File([new Uint8Array([id])], name, { type: /\.wav$/i.test(name) ? "audio/wav" : "audio/mpeg" });
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

async function flush() { await new Promise(resolve => setImmediate(resolve)); }

function setup(t) {
  const context = new FakeContext();
  const player = new AudioPlayer(() => context);
  t.after(() => player.dispose());
  return { context, player };
}

test("mixed MP3/WAV playlist filters other media and orders filenames naturally", () => {
  const tracks = tracksFromFiles([track(10), new File(["photo"], "photo.jpg"), track(2, "track2.WAV"), track(1, "track1.MP3")]);
  assert.deepEqual(tracks.map(item => item.name), ["track1.MP3", "track2.WAV", "track10.mp3"]);
});

test("paused folders warm two tracks; unlocking alone never starts music", async t => {
  const { context, player } = setup(t);
  player.setFiles([track(1), track(2), track(3)]);
  await flush();
  assert.deepEqual(context.decoded, [1, 2]);
  assert.equal(context.sources.length, 0);
  assert.equal(player.getSnapshot().playing, false);
  await player.unlock();
  assert.equal(context.resumeCalls, 1);
  assert.equal(context.sources.length, 0);
  await player.play();
  assert.equal(player.getSnapshot().playing, true);
  assert.deepEqual(context.decoded, [1, 2, 3]);
  assert.equal(context.sources.length, 2);
});

test("mixed MP3/WAV playback waits for the next decoded track, then schedules an exact audio-clock handoff", async t => {
  const { context, player } = setup(t);
  const pending = deferred();
  context.gates.set(2, pending.promise);
  await player.unlock();
  player.setFiles([track(1), track(2, "track2.wav"), track(3)]);
  await flush();
  assert.equal(player.getSnapshot().loading, true);
  assert.equal(context.sources.length, 0, "do not start until the first handoff is ready");
  pending.resolve();
  await flush();
  const [first, second] = context.sources;
  assert.equal(second.when, first.end);
  assert.equal(first.ended, undefined, "next track is scheduled before any ended event");
  assert.equal(player.getSnapshot().loading, false);
  assert.deepEqual(context.decoded, [1, 2, 3]);
});

test("rolling preload replenishes already scheduled playback and does not decode the whole folder", async t => {
  const { context, player } = setup(t);
  await player.unlock();
  player.setFiles([1, 2, 3, 4, 5].map(id => track(id)));
  await flush();
  assert.deepEqual(context.decoded, [1, 2, 3]);
  const [first, second] = context.sources;
  context.advance(first.end + 1); // Deliberately deliver the ended event late.
  await flush();
  assert.equal(context.sources[2].buffer.id, 3);
  assert.equal(context.sources[2].when, second.end);
  assert.equal(player.getSnapshot().trackIndex, 1);
  assert.deepEqual(context.decoded, [1, 2, 3, 4]);
  context.advance(second.end);
  await flush();
  context.advance(context.sources[2].end);
  await flush();
  assert.deepEqual(context.decoded, [1, 2, 3, 4, 5, 1], "released earlier tracks are decoded again when approaching the loop");
});

test("WAV-only folders loop on the audio clock without decoding the same track again", async t => {
  const { context, player } = setup(t);
  await player.unlock();
  player.setFiles([track(1, "track1.wav")]);
  await flush();
  assert.equal(context.sources[1].when, context.sources[0].end);
  context.advance(context.sources[0].end);
  await flush();
  assert.equal(context.sources[2].when, context.sources[1].end);
  assert.deepEqual(context.decoded, [1]);
});

test("pause fades the current source, cancels future sources and resumes from the stopped offset", async t => {
  const { context, player } = setup(t);
  await player.unlock();
  player.setFiles([track(1), track(2)]);
  await flush();
  const [first, second] = context.sources;
  context.advance(first.when + 3);
  player.pause();
  assert.equal(player.getSnapshot().playing, false);
  assert.ok(first.stoppedAt > context.currentTime);
  assert.equal(second.stoppedAt, context.currentTime);
  const fade = context.gains[1].gain.events.at(-1);
  assert.deepEqual(fade, { type: "ramp", value: 0, time: first.stoppedAt });
  await player.unlock();
  assert.equal(context.sources.length, 2, "opening a folder picker must not resume paused music");
  context.advance(context.currentTime + 2);
  await player.play();
  assert.ok(Math.abs(context.sources[2].offset - 3.015) < 1e-9);
  assert.equal(context.sources[3].when, context.sources[2].end);
});

test("rapid pause/resume cancels stale pending starts", async t => {
  const { context, player } = setup(t);
  const pending = deferred();
  context.gates.set(1, pending.promise);
  await player.unlock();
  player.setFiles([track(1), track(2)]);
  await flush();
  player.pause();
  const resumed = player.play();
  player.pause();
  pending.resolve();
  await resumed;
  await flush();
  assert.equal(player.getSnapshot().playing, false);
  assert.equal(context.sources.length, 0);
  await player.play();
  assert.equal(context.sources.length, 2);
});

test("folder changes discard old decode completions and preserve only the new playlist", async t => {
  const { context, player } = setup(t);
  const pending = deferred();
  context.gates.set(1, pending.promise);
  await player.unlock();
  player.setFiles([track(1), track(2)]);
  await flush();
  player.setFiles([track(8), track(9)]);
  await flush();
  pending.resolve();
  await flush();
  assert.deepEqual(context.sources.map(source => source.buffer.id), [8, 9]);
  assert.equal(player.getSnapshot().tracks[0].name, "track8.mp3");
});

test("bad MP3s are skipped finitely and all-bad folders produce a recoverable error", async t => {
  const { context, player } = setup(t);
  context.failures = new Set([1, 2]);
  await player.unlock();
  player.setFiles([track(1), track(2), track(3)]);
  await flush();
  assert.deepEqual(context.decoded, [1, 2, 3]);
  assert.deepEqual(context.sources.map(source => source.buffer.id), [3, 3]);
  assert.match(player.getSnapshot().error, /skipping/);
  player.setFiles([track(1), track(2)]);
  await flush();
  assert.equal(player.getSnapshot().playing, false);
  assert.equal(player.getSnapshot().loading, false);
  assert.match(player.getSnapshot().error, /None of the audio/);
  player.setFiles([track(4)]);
  await flush();
  assert.equal(player.getSnapshot().playing, true);
  assert.equal(player.getSnapshot().error, null);
});

test("next and previous preserve pause and skip damaged tracks in the requested direction", async t => {
  const { context, player } = setup(t);
  context.failures.add(2);
  player.setFiles([track(1), track(2), track(3)]);
  await flush();
  player.previous();
  await flush();
  assert.equal(player.getSnapshot().trackIndex, 2);
  player.previous();
  await flush();
  assert.equal(player.getSnapshot().trackIndex, 0);
  player.next();
  await flush();
  assert.equal(player.getSnapshot().trackIndex, 2);
  assert.equal(player.getSnapshot().playing, false);
  assert.equal(context.sources.length, 0);
});

test("volume and mute use smooth continuous ramps, including volume chosen before audio initialization", async t => {
  const { context, player } = setup(t);
  player.setVolume(0.3);
  await player.unlock();
  const master = context.gains[0].gain;
  assert.equal(master.value, 0.3);
  player.setVolume(0.8);
  assert.deepEqual(master.events.at(-2), { type: "set", value: 0.3, time: 0 });
  context.currentTime = 0.0075;
  player.toggleMute();
  assert.ok(Math.abs(master.events.at(-2).value - 0.55) < 1e-9, "ramp starts at the in-flight gain, with no discontinuity");
  assert.equal(master.events.at(-1).value, 0);
  assert.equal(player.getSnapshot().muted, true);
  player.setVolume(0.4);
  assert.equal(player.getSnapshot().muted, false);
  assert.equal(master.events.at(-1).value, 0.4);
  player.setVolume(Infinity);
  assert.equal(player.getSnapshot().volume, 0.4);
  player.setVolume(8);
  assert.equal(player.getSnapshot().volume, 1);
});

test("resume failures and browser interruptions allow a later play gesture to recover", async t => {
  const { context, player } = setup(t);
  player.setFiles([track(1)]);
  await flush();
  context.resumeError = true;
  await player.play();
  assert.equal(player.getSnapshot().playing, false);
  assert.match(player.getSnapshot().error, /Press play/);
  context.resumeError = false;
  await player.play();
  context.currentTime = 2;
  context.state = "suspended";
  context.onstatechange();
  assert.equal(player.getSnapshot().playing, false);
  assert.match(player.getSnapshot().error, /interrupted/);
  await player.play();
  assert.equal(player.getSnapshot().playing, true);
});

test("disposing during a decode prevents playback and further subscription notifications", async t => {
  const { context, player } = setup(t);
  const pending = deferred();
  context.gates.set(1, pending.promise);
  await player.unlock();
  let notifications = 0;
  player.subscribe(() => { notifications += 1; });
  player.setFiles([track(1)]);
  await flush();
  player.dispose();
  const atDispose = notifications;
  pending.resolve();
  await flush();
  assert.equal(context.state, "closed");
  assert.equal(context.sources.length, 0);
  assert.equal(notifications, atDispose);
  player.setFiles([track(2)]);
  player.toggle();
  assert.equal(notifications, atDispose);
});

test("browser suspension while the first tracks are decoding cancels the pending start", async t => {
  const { context, player } = setup(t);
  const pending = deferred();
  context.gates.set(1, pending.promise);
  await player.unlock();
  player.setFiles([track(1), track(2)]);
  await flush();
  context.state = "suspended";
  context.onstatechange();
  pending.resolve();
  await flush();
  assert.equal(player.getSnapshot().playing, false);
  assert.equal(context.sources.length, 0);
  await player.play();
  assert.equal(player.getSnapshot().playing, true);
  assert.equal(context.sources.length, 2);
});
