// ── Fragmented-MP4 inspection for the live HLS path ───────────
//
// The broadcaster records H.264 in fragmented MP4 (Chrome MediaRecorder)
// and the server re-serves those exact bytes as HLS for iPhone Safari
// and the mobile app. HLS is stricter than MediaSource about two things,
// and both need a look inside the boxes:
//
//   1. #EXT-X-MAP must point at ftyp+moov ONLY. Chrome 152 emits that as
//      a blob on its own, but nothing guarantees every version does, so
//      split it out rather than trusting the blob boundary.
//   2. #EXTINF must be the segment's real duration, and no segment may
//      exceed #EXT-X-TARGETDURATION. MediaRecorder's 2s timeslice is
//      approximate (2.4s is normal, a backgrounded tab can produce 40s),
//      so the playlist reads durations out of the moof/trun boxes.
//
// Read-only and defensive: every function returns null on anything it
// doesn't understand, and callers fall back to the old behaviour.

function _boxes(buf, start, end) {
  const out = [];
  let o = start;
  while (o + 8 <= end) {
    let size = buf.readUInt32BE(o);
    const type = buf.toString('latin1', o + 4, o + 8);
    let hdr = 8;
    if (size === 1) {
      if (o + 16 > end) break;
      size = Number(buf.readBigUInt64BE(o + 8));
      hdr = 16;
    } else if (size === 0) {
      size = end - o;
    }
    if (size < hdr || o + size > end) break;
    out.push({ type, off: o, size, body: o + hdr });
    o += size;
  }
  return out;
}

// Split a blob that starts with ftyp+moov into the init segment and the
// offset where media (the first moof) begins. Returns null when the blob
// doesn't start with an init segment.
function splitInit(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 16) return null;
  const top = _boxes(buf, 0, buf.length);
  if (!top.length || top[0].type !== 'ftyp') return null;
  if (!top.some((b) => b.type === 'moov')) return null;
  const firstMoof = top.find((b) => b.type === 'moof');
  const mediaOffset = firstMoof ? firstMoof.off : buf.length;
  return { init: buf.subarray(0, mediaOffset), mediaOffset };
}

// Track ids, timescales and trex defaults from an init segment.
function parseInit(init) {
  try {
    const moov = _boxes(init, 0, init.length).find((b) => b.type === 'moov');
    if (!moov) return null;
    const kids = _boxes(init, moov.body, moov.off + moov.size);
    const tracks = {};
    let videoTrackId = null;
    for (const trak of kids.filter((b) => b.type === 'trak')) {
      const tk = _boxes(init, trak.body, trak.off + trak.size);
      const tkhd = tk.find((b) => b.type === 'tkhd');
      const mdia = tk.find((b) => b.type === 'mdia');
      if (!tkhd || !mdia) continue;
      const v = init[tkhd.body];
      const id = init.readUInt32BE(tkhd.body + (v === 1 ? 20 : 12));
      const mk = _boxes(init, mdia.body, mdia.off + mdia.size);
      const mdhd = mk.find((b) => b.type === 'mdhd');
      const hdlr = mk.find((b) => b.type === 'hdlr');
      if (!mdhd || !hdlr) continue;
      const mv = init[mdhd.body];
      const timescale = init.readUInt32BE(mdhd.body + (mv === 1 ? 20 : 12));
      const handler = init.toString('latin1', hdlr.body + 8, hdlr.body + 12);
      tracks[id] = { timescale, handler, defaultDuration: 0 };
      if (handler === 'vide' && videoTrackId === null) videoTrackId = id;
    }
    const mvex = kids.find((b) => b.type === 'mvex');
    if (mvex) {
      for (const trex of _boxes(init, mvex.body, mvex.off + mvex.size).filter((b) => b.type === 'trex')) {
        const id = init.readUInt32BE(trex.body + 4);
        if (tracks[id]) tracks[id].defaultDuration = init.readUInt32BE(trex.body + 12);
      }
    }
    const ids = Object.keys(tracks).map(Number);
    if (!ids.length) return null;
    return { tracks, timingTrackId: videoTrackId !== null ? videoTrackId : ids[0] };
  } catch (_) {
    return null;
  }
}

// Seconds of media in buf[offset..] for the timing track (video when
// there is one), summed from every moof's trun sample durations.
function mediaDuration(buf, offset, info) {
  try {
    if (!info) return null;
    const track = info.tracks[info.timingTrackId];
    if (!track || !track.timescale) return null;
    let ticks = 0;
    let sawMoof = false;
    for (const moof of _boxes(buf, offset || 0, buf.length).filter((b) => b.type === 'moof')) {
      sawMoof = true;
      for (const traf of _boxes(buf, moof.body, moof.off + moof.size).filter((b) => b.type === 'traf')) {
        const tk = _boxes(buf, traf.body, traf.off + traf.size);
        const tfhd = tk.find((b) => b.type === 'tfhd');
        if (!tfhd) continue;
        const tfFlags = buf.readUInt32BE(tfhd.body) & 0xffffff;
        if (buf.readUInt32BE(tfhd.body + 4) !== info.timingTrackId) continue;
        let p = tfhd.body + 8;
        if (tfFlags & 0x01) p += 8;          // base_data_offset
        if (tfFlags & 0x02) p += 4;          // sample_description_index
        let defDur = track.defaultDuration;
        if (tfFlags & 0x08) defDur = buf.readUInt32BE(p);
        for (const trun of tk.filter((b) => b.type === 'trun')) {
          const fl = buf.readUInt32BE(trun.body) & 0xffffff;
          const n = buf.readUInt32BE(trun.body + 4);
          let q = trun.body + 8;
          if (fl & 0x001) q += 4;            // data_offset
          if (fl & 0x004) q += 4;            // first_sample_flags
          if (!(fl & 0x100)) { ticks += defDur * n; continue; }
          const stride = 4 * [0x100, 0x200, 0x400, 0x800].filter((f) => fl & f).length;
          for (let s = 0; s < n; s++, q += stride) ticks += buf.readUInt32BE(q);
        }
      }
    }
    if (!sawMoof) return 0;
    return ticks / track.timescale;
  } catch (_) {
    return null;
  }
}

module.exports = { splitInit, parseInit, mediaDuration };
