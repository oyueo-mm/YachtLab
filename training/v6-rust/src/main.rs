// YachtLab v6: Rust port of training/v6-wasm/pmf_wasm.c (same kernel tables from JS, same
// floating-point operation order) -> expected bit-identical DP Expert PMF bank.
// Usage: pmf_bank_rs kernel.bin dp.f64 out.f64bank
use std::{env, fs, time::Instant};
const FULL: usize = 252; const OFFSET: usize = 210; const PARTIAL: usize = 462;
fn rd_i16(b: &[u8], n: usize, o: &mut usize) -> Vec<i16> { let v = (0..n).map(|i| i16::from_le_bytes([b[*o + 2 * i], b[*o + 2 * i + 1]])).collect(); *o += 2 * n; v }
fn rd_i32(b: &[u8], n: usize, o: &mut usize) -> Vec<i32> { let v = (0..n).map(|i| i32::from_le_bytes(b[*o + 4 * i..*o + 4 * i + 4].try_into().unwrap())).collect(); *o += 4 * n; v }
fn rd_f64(b: &[u8], n: usize, o: &mut usize) -> Vec<f64> { let v = (0..n).map(|i| f64::from_le_bytes(b[*o + 8 * i..*o + 8 * i + 8].try_into().unwrap())).collect(); *o += 8 * n; v }
fn headroom(m: usize) -> i32 { (0..6).filter(|c| m >> c & 1 == 1).map(|c| 5 * (c as i32 + 1)).sum() }
fn canon(m: usize, u: i32) -> i32 { let um = u.min(63); if m & 63 == 0 { 0 } else if um >= 63 { 63 } else if um + headroom(m) < 63 { 0 } else { um } }
fn next_upper(c: usize, p: i32, u: i32) -> i32 { if c >= 6 { u } else { (u + p).min(63) } }
fn main() {
  let a: Vec<String> = env::args().collect();
  let kb = fs::read(&a[1]).unwrap(); let mut o = 0;
  let nhl = i32::from_le_bytes(kb[0..4].try_into().unwrap()) as usize; o += 4;
  let points = rd_i16(&kb, FULL * 12, &mut o); let prob = rd_f64(&kb, FULL, &mut o); let child = rd_i16(&kb, OFFSET * 6, &mut o);
  let hs = rd_i32(&kb, FULL + 1, &mut o); let hl = rd_i16(&kb, nhl, &mut o);
  let tb = fs::read(&a[2]).unwrap(); let mut o2 = 0; let t = rd_f64(&tb, 4096 * 64, &mut o2);
  let t0 = Instant::now();
  let mut data: Vec<f64> = Vec::with_capacity(37_256_480); let mut index = vec![(0usize, 0usize); 4096 * 64];
  let (mut stop, mut v1, mut v2, mut mass) = ([0f64; FULL], [0f64; FULL], [0f64; FULL], [0f64; FULL]);
  let (mut e, mut part, mut out, mut cont) = ([0f64; PARTIAL], [0f64; PARTIAL], [0f64; 768], [0f64; 768]);
  let (mut stopc, mut act1, mut act2) = ([0i16; FULL], [0i16; FULL], [0i16; FULL]);
  let mut keys = vec![];
  let mut masks: Vec<usize> = (0..4096).collect(); masks.sort_by_key(|&m| (m.count_ones(), m));
  for &mask in &masks { for u in 0..64i32 {
    if canon(mask, u) != u { continue; }
    let key = mask * 64 + u as usize;
    if mask == 0 { index[key] = (data.len(), 1); data.push(1.0); keys.push(key); continue; }
    for c in 0..12 { if mask >> c & 1 == 0 { continue; } let next = mask ^ (1 << c);
      for p in 0..=50 { cont[c * 64 + p] = f64::NAN; }
      for d in 0..FULL { let p = points[d * 12 + c] as usize; if cont[c * 64 + p].is_nan() { cont[c * 64 + p] = t[next * 64 + canon(next, next_upper(c, p as i32, u)) as usize]; } } }
    for d in 0..FULL { let (mut best, mut bc) = (f64::NEG_INFINITY, -1i16);
      for c in 0..12 { if mask >> c & 1 == 0 { continue; } let p = points[d * 12 + c] as i32;
        let v = (p + if c < 6 && u < 63 && u + p >= 63 { 35 } else { 0 }) as f64 + cont[c * 64 + p as usize];
        if v > best { best = v; bc = c as i16; } }
      stop[d] = best; stopc[d] = bc; }
    let chance = |full: &[f64; FULL], e: &mut [f64; PARTIAL]| { for d in 0..FULL { e[OFFSET + d] = full[d]; }
      for h in (0..OFFSET).rev() { let b = &child[h * 6..h * 6 + 6]; e[h] = (e[b[0] as usize] + e[b[1] as usize] + e[b[2] as usize] + e[b[3] as usize] + e[b[4] as usize] + e[b[5] as usize]) / 6.0; } };
    let backup = |prev: &[f64; FULL], dst: &mut [f64; FULL], act: &mut [i16; FULL], e: &mut [f64; PARTIAL]| { chance(prev, e);
      for d in 0..FULL { let (mut best, mut ac) = (stop[d], -1i16);
        for i in hs[d] as usize..(hs[d + 1] - 1) as usize { let h = hl[i] as usize; if e[h] > best { best = e[h]; ac = h as i16; } }
        dst[d] = best; act[d] = ac; } };
    backup(&stop, &mut v1, &mut act1, &mut e); backup(&v1, &mut v2, &mut act2, &mut e);
    out.iter_mut().for_each(|x| *x = 0.0); mass.copy_from_slice(&prob);
    for pass in 0..2 { let act = if pass == 0 { &act2 } else { &act1 }; part.iter_mut().for_each(|x| *x = 0.0);
      for d in 0..FULL { let m = mass[d]; if m == 0.0 { continue; } let ac = act[d];
        if ac < 0 { let c = stopc[d] as usize; out[c * 64 + points[d * 12 + c] as usize] += m; continue; } part[ac as usize] += m; }
      for h in 0..OFFSET { let m = part[h]; if m == 0.0 { continue; } let q = m / 6.0; for k in 0..6 { part[child[h * 6 + k] as usize] += q; } }
      for d in 0..FULL { mass[d] = part[OFFSET + d]; } }
    for d in 0..FULL { let m = mass[d]; if m == 0.0 { continue; } let c = stopc[d] as usize; out[c * 64 + points[d * 12 + c] as usize] += m; }
    let mut len = 1; let mut parts = vec![];
    for k in 0..768 { if out[k] > 0.0 { let (c, raw) = (k >> 6, (k & 63) as i32); let next = mask ^ (1 << c);
      let ck = next * 64 + canon(next, next_upper(c, raw, u)) as usize; let shift = (raw + if c < 6 && u < 63 && u + raw >= 63 { 35 } else { 0 }) as usize;
      len = len.max(shift + index[ck].1); parts.push((index[ck], shift, out[k])); } }
    let mut acc = vec![0f64; len];
    for ((off, cl), shift, p) in parts { for g in 0..cl { acc[shift + g] += p * data[off + g]; } }
    index[key] = (data.len(), len); data.extend_from_slice(&acc); keys.push(key);
  } }
  let secs = t0.elapsed().as_secs_f64();
  let mut f = format!("{{\"format\":\"yachtlab-policy-pmf-1\",\"name\":\"DP Expert (rust)\",\"states\":{},\"floats\":{}}}\n", keys.len(), data.len()).into_bytes();
  let mut ord: Vec<usize> = keys.clone(); ord.sort();
  for &k in &ord { f.extend_from_slice(&(k as i32).to_le_bytes()); f.extend_from_slice(&(index[k].1 as i32).to_le_bytes()); }
  for &k in &ord { for g in 0..index[k].1 { f.extend_from_slice(&data[index[k].0 + g].to_le_bytes()); } }
  fs::write(&a[3], f).unwrap();
  println!("{{\"seconds\":{:.3},\"states\":{},\"floats\":{}}}", secs, keys.len(), data.len());
}
