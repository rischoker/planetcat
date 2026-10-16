# =====================================================================
#  Gato Swing — análisis de STEMS → chart.json
#  (este mismo código va dentro del cuaderno de Colab)
# =====================================================================
import json, math, re
import numpy as np
import librosa
import scipy.signal as sps
import scipy.ndimage as ndi

SR = 22050          # frecuencia para el análisis
HOP = 256           # ~11.6 ms por cuadro
STEMS = ['drums', 'bass', 'vocals', 'other']
MODOS = ['tambor', 'serpiente', 'pista']
NOMBRE_STEM = {'drums': 'batería', 'bass': 'bajo', 'vocals': 'voz', 'other': 'otros'}


def _t(frames):
    return librosa.frames_to_time(frames, sr=SR, hop_length=HOP)


def _norm(x, q=95):
    ref = np.percentile(x, q) if len(x) else 1.0
    return np.clip(x / (ref + 1e-9), 0, 1.5)


# ------------------------------------------------------------- beat y compás
def analizar_beat(mix, drums, bass):
    env = librosa.onset.onset_strength(y=mix, sr=SR, hop_length=HOP)
    tempo, beats = librosa.beat.beat_track(onset_envelope=env, sr=SR, hop_length=HOP, start_bpm=120, tightness=120, trim=False)
    tempo = float(np.atleast_1d(tempo)[0])
    bt = _t(beats)
    if len(bt) > 8:  # tempo real a partir de los beats encontrados
        tempo = 60.0 / float(np.median(np.diff(bt)))
    # tiempo 1 de cada compás (4/4): la fase donde más pegan bombo + bajo
    low = librosa.onset.onset_strength(y=drums, sr=SR, hop_length=HOP, fmax=160, n_mels=32)
    lb = librosa.onset.onset_strength(y=bass, sr=SR, hop_length=HOP)
    score = low / (low.max() + 1e-9) + 0.6 * lb / (lb.max() + 1e-9)
    fases = [float(np.sum(score[np.clip(beats[k::4], 0, len(score) - 1)])) for k in range(4)]
    fase = int(np.argmax(fases)) if len(beats) >= 8 else 0
    downbeats = bt[fase::4]
    return tempo, bt, downbeats


def cuadricula(beats, sub=4):
    """Subdivisiones de beat (semicorcheas) para alinear las notas."""
    if len(beats) < 2:
        return np.array(beats)
    g = []
    for a, b in zip(beats[:-1], beats[1:]):
        g.extend(a + (b - a) * np.arange(sub) / sub)
    g.append(beats[-1])
    return np.array(g)


def alinear(t, grid, tol=0.045):
    if len(grid) == 0:
        return t
    i = np.searchsorted(grid, t)
    cand = [grid[j] for j in (i - 1, i) if 0 <= j < len(grid)]
    best = min(cand, key=lambda g: abs(g - t))
    return float(best) if abs(best - t) <= tol else float(t)


# ------------------------------------------------------------- notas por STEM
def _rms(y):
    return librosa.feature.rms(y=y, frame_length=1024, hop_length=HOP)[0]


def _onsets(y, delta=0.08, wait_s=0.07):
    env = librosa.onset.onset_strength(y=y, sr=SR, hop_length=HOP)
    envn = env / (np.percentile(env, 99) + 1e-9)
    fr = librosa.onset.onset_detect(onset_envelope=envn, sr=SR, hop_length=HOP, units='frames',
                                    pre_max=3, post_max=3, pre_avg=12, post_avg=12,
                                    delta=delta, wait=max(1, int(wait_s * SR / HOP)))
    return fr, envn


def notas_bateria(y, grid):
    fr, envn = _onsets(y, delta=0.07, wait_s=0.06)
    rms = _rms(y); gate = rms.max() * 10 ** (-38 / 20)
    S = np.abs(librosa.stft(y, n_fft=1024, hop_length=HOP))
    f = librosa.fft_frequencies(sr=SR, n_fft=1024)
    bands = {'kick': (f >= 30) & (f < 160), 'snare': (f >= 180) & (f < 2500), 'hat': f >= 6000}
    E = {k: S[m].sum(0) for k, m in bands.items()}
    ref = {k: np.median(v[fr]) + 1e-9 if len(fr) else 1 for k, v in E.items()}
    out = []
    for i in fr:
        if rms[min(i, len(rms) - 1)] < gate:
            continue
        w = slice(i, min(i + 5, S.shape[1]))
        rel = {k: float(E[k][w].mean() / ref[k]) for k in E}
        # el bombo y la caja mandan sobre el platillo si están cerca
        rel['hat'] *= 0.75
        kind = max(rel, key=rel.get)
        out.append({'t': round(alinear(float(_t(i)), grid), 3), 's': round(float(min(1, envn[i])), 2), 'k': kind})
    return out


def notas_tonales(y, grid, beat_len, nombre):
    """Notas con duración y altura (bajo, voz, otros)."""
    delta = {'bass': 0.09, 'vocals': 0.10, 'other': 0.10}[nombre]
    fr, envn = _onsets(y, delta=delta, wait_s=0.09)
    rms = _rms(y); n = len(rms)
    gate = rms.max() * 10 ** (-34 / 20)
    rms_s = ndi.uniform_filter1d(rms, 3)
    # altura: f0 (bajo, voz) o centroide espectral (otros, polifónico)
    if nombre in ('bass', 'vocals'):
        fmin, fmax = (35, 350) if nombre == 'bass' else (80, 1000)
        f0 = librosa.yin(y, fmin=fmin, fmax=fmax, sr=SR, frame_length=2048, hop_length=HOP)
        alt = librosa.hz_to_midi(f0)
        voiced = rms_s > gate * 2
    else:
        cen = librosa.feature.spectral_centroid(y=y, sr=SR, n_fft=2048, hop_length=HOP)[0]
        alt = librosa.hz_to_midi(np.maximum(cen, 30))
        voiced = rms_s > gate * 2
    alt = alt[:n]
    notas = []
    fr = [i for i in fr if i < n and rms_s[i] >= gate]
    for j, i in enumerate(fr):
        fin_max = fr[j + 1] if j + 1 < len(fr) else min(n, i + int(4 * beat_len * SR / HOP))
        pico_i = i + int(np.argmax(rms_s[i:min(fin_max, i + 8)])) if fin_max > i else i
        pico = rms_s[pico_i]
        k = pico_i
        while k < fin_max and rms_s[k] > pico * 0.45 and rms_s[k] > gate * 1.5:
            k += 1
        d = float(_t(k) - _t(i))
        seg = alt[i:max(i + 1, k)]
        v = voiced[i:max(i + 1, k)]
        h = float(np.nanmedian(seg[v])) if v.any() and np.isfinite(seg[v]).any() else float('nan')
        notas.append({'t': round(alinear(float(_t(i)), grid), 3), 'd': round(max(0.05, d), 3),
                      's': round(float(min(1, envn[i])), 2), 'h': h})
    # altura → carril 0..1 dentro del rango de este STEM
    hs = np.array([x['h'] for x in notas if np.isfinite(x['h'])])
    lo, hi = (np.percentile(hs, 5), np.percentile(hs, 95)) if len(hs) > 4 else (0, 1)
    for x in notas:
        x['p'] = round(float(np.clip((x['h'] - lo) / (hi - lo + 1e-9), 0, 1)), 2) if np.isfinite(x['h']) else 0.5
        x['m'] = int(round(x['h'])) if np.isfinite(x['h']) else None  # nota MIDI aprox.
        x['l'] = bool(x['d'] >= max(0.35, beat_len * 0.9))           # nota larga (patinar)
        del x['h']
    return notas


def curva(y, fps=10):
    r = librosa.feature.rms(y=y, frame_length=2048, hop_length=SR // fps)[0]
    r = r / (np.percentile(r, 98) + 1e-9)
    return [round(float(v), 2) for v in np.clip(r, 0, 1)]


# ------------------------------------------------------------- secciones
def secciones(mix, stems, beats, downbeats, duracion, k=None):
    bars = list(downbeats)
    if len(bars) < 4:
        return [{'start': 0.0, 'end': round(duracion, 3), 'label': 'A', 'energy': 1.0, 'mode': 'tambor'}]
    if bars[0] > 0.5:
        bars = [0.0] + bars
    bars.append(duracion)
    bf = librosa.time_to_frames(bars, sr=SR, hop_length=HOP)
    yh = librosa.effects.harmonic(mix, margin=2)
    chroma = librosa.feature.chroma_cqt(y=yh, sr=SR, hop_length=HOP)
    mfcc = librosa.feature.mfcc(y=mix, sr=SR, hop_length=HOP, n_mfcc=13)
    rmss = np.vstack([_rms(stems[s]) for s in STEMS])
    rmss = rmss / (rmss.max(1, keepdims=True) + 1e-9)
    n = min(chroma.shape[1], mfcc.shape[1], rmss.shape[1])
    F = np.vstack([chroma[:, :n], (mfcc[:, :n] - mfcc[:, :n].mean(1, keepdims=True)) / (mfcc[:, :n].std(1, keepdims=True) + 1e-9) * 0.5, rmss[:, :n] * 2])
    bf = np.clip(bf, 0, n - 1)
    Fb = librosa.util.sync(F, bf, aggregate=np.mean)[:, :len(bars) - 1]
    nb = Fb.shape[1]
    if k is None:
        k = int(np.clip(round(duracion / 22), 3, 10))
    k = max(2, min(k, nb // 4 if nb >= 8 else 2))
    bounds = librosa.segment.agglomerative(Fb, k)  # índices de compás
    # las frases musicales suelen ir de 4 en 4 compases: ajustar si está a 1 compás
    bounds = [int(4 * round(x / 4)) if abs(x - 4 * round(x / 4)) <= 1 else int(x) for x in bounds]
    bounds = sorted(set([0] + [x for x in bounds if 0 < x < nb] + [nb]))
    # fusionar secciones de menos de 4 compases
    limpio = [bounds[0]]
    for b in bounds[1:]:
        if b - limpio[-1] < 4 and b != nb:
            continue
        limpio.append(b)
    if len(limpio) > 2 and limpio[-1] - limpio[-2] < 4:
        limpio.pop(-2)
    secs = []
    for a, b in zip(limpio[:-1], limpio[1:]):
        v = Fb[:, a:b].mean(1)
        e = float(rmss[:, bf[a]:bf[min(b, len(bf) - 1)]].mean()) if bf[min(b, len(bf) - 1)] > bf[a] else 0.0
        largas = float(rmss[2:, bf[a]:max(bf[a] + 1, bf[min(b, len(bf) - 1)])].mean())
        secs.append({'start': round(float(bars[a]), 3), 'end': round(float(bars[b]), 3), 'bars': int(b - a), 'vec': v, 'energy': e, 'mel': largas})
    # etiquetas A, B, C… por parecido (coseno)
    etiquetas = []
    centro = np.mean([s['vec'] for s in secs], axis=0)
    for s in secs:
        s['vec'] = s['vec'] - centro
    for s in secs:
        lab = None
        for t, ref in etiquetas:
            c = float(np.dot(s['vec'], ref) / (np.linalg.norm(s['vec']) * np.linalg.norm(ref) + 1e-9))
            if c > 0.8:
                lab = t; break
        if lab is None:
            lab = chr(ord('A') + len(etiquetas)); etiquetas.append((lab, s['vec']))
        s['label'] = lab
    emax = max(s['energy'] for s in secs) + 1e-9
    for s in secs:
        s['energy'] = round(s['energy'] / emax, 2)
    asignar_modos(secs)
    for s in secs:
        del s['vec']; del s['mel']
    return secs


def asignar_modos(secs):
    """Reglas: lo más intenso (coros) → pista; lo suave (intro/puentes) → serpiente; el resto → tambor."""
    E = np.array([s['energy'] for s in secs])
    alto, bajo = np.quantile(E, 0.7), np.quantile(E, 0.3)
    for s in secs:
        if s['energy'] >= alto and s['energy'] >= 0.75:
            s['mode'] = 'pista'
        elif s['energy'] <= bajo or s['energy'] < 0.45:
            s['mode'] = 'serpiente'
        else:
            s['mode'] = 'tambor'
    # misma etiqueta → mismo modo (el coro siempre es coro)
    por = {}
    for s in secs:
        por.setdefault(s['label'], []).append(s['mode'])
    for s in secs:
        modos = por[s['label']]
        s['mode'] = max(set(modos), key=modos.count)
    # que aparezcan los tres modos si hay con qué
    if len(secs) >= 3:
        usados = {s['mode'] for s in secs}
        if 'pista' not in usados:
            max(secs, key=lambda s: s['energy'])['mode'] = 'pista'
        if 'serpiente' not in {s['mode'] for s in secs}:
            cand = [s for s in secs if s['mode'] != 'pista']
            if cand: min(cand, key=lambda s: s['energy'])['mode'] = 'serpiente'
        if 'tambor' not in {s['mode'] for s in secs}:
            cand = sorted([s for s in secs if s['mode'] != 'pista'], key=lambda s: -s['energy'])
            if cand: cand[0]['mode'] = 'tambor'
    # la primera sección arranca en tambor si es corta y no es intro suave
    return secs


# ------------------------------------------------------------- todo junto
def slug(nombre):
    s = re.sub(r'\.[^.]+$', '', nombre)
    s = re.sub(r'[^a-zA-Z0-9]+', '-', s).strip('-').lower()
    return s or 'cancion'


def analizar(mix, stems, titulo, archivo='song.mp3', k_secciones=None):
    """mix y stems: arrays mono a SR (22050)."""
    dur = len(mix) / SR
    tempo, beats, downbeats = analizar_beat(mix, stems['drums'], stems['bass'])
    grid = cuadricula(beats, 4)
    beat_len = 60.0 / tempo
    notas = {'drums': notas_bateria(stems['drums'], grid)}
    for s in ('bass', 'vocals', 'other'):
        notas[s] = notas_tonales(stems[s], grid, beat_len, s)
    secs = secciones(mix, stems, beats, downbeats, dur, k_secciones)
    chart = {
        'format': 'gato-swing-chart', 'version': 1,
        'title': titulo, 'audio': archivo,
        'duration': round(dur, 3), 'bpm': round(tempo, 2),
        'offset': round(float(beats[0]) if len(beats) else 0.0, 3),
        'beats': [round(float(b), 3) for b in beats],
        'downbeats': [round(float(b), 3) for b in downbeats],
        'sections': secs,
        'stems': {s: {'notes': notas[s]} for s in STEMS},
        'energy': {'fps': 10, 'mix': curva(mix), **{s: curva(stems[s]) for s in STEMS}},
    }
    return chart


def resumen(chart):
    print(f"🎵 {chart['title']} — {chart['duration']:.0f} s · {chart['bpm']:.1f} BPM · {len(chart['downbeats'])} compases")
    for s in STEMS:
        ns = chart['stems'][s]['notes']
        largas = sum(1 for x in ns if x.get('l'))
        extra = ''
        if s == 'drums':
            from collections import Counter
            c = Counter(x['k'] for x in ns); extra = f"  (bombo {c['kick']}, caja {c['snare']}, platillo {c['hat']})"
        elif largas:
            extra = f"  ({largas} largas)"
        print(f"   {NOMBRE_STEM[s]:8s} {len(ns):5d} notas{extra}")
    print('   Secciones:')
    for i, s in enumerate(chart['sections']):
        m, ss = divmod(int(s['start']), 60)
        print(f"   [{i}] {m}:{ss:02d}  {s['label']}  {s['bars']:3d} compases  energía {s['energy']:.2f}  →  {s['mode'].upper()}")


def guardar_json(chart, ruta):
    with open(ruta, 'w', encoding='utf-8') as f:
        json.dump(chart, f, ensure_ascii=False, separators=(',', ':'))


# ------------------------------------------------------------- revisar
COLOR_MODO = {'tambor': '#e3262f', 'serpiente': '#2e9e4f', 'pista': '#3e46c9'}


def dibujar(chart, titulo=None):
    import matplotlib.pyplot as plt
    fig, ax = plt.subplots(5, 1, figsize=(17, 8.5), sharex=True, gridspec_kw={'height_ratios': [1.6, 1, 1, 1, 1]})
    fps = chart['energy']['fps']
    e = np.array(chart['energy']['mix']); t = np.arange(len(e)) / fps
    ax[0].fill_between(t, e, color='#141414')
    for i, s in enumerate(chart['sections']):
        for a in ax:
            a.axvspan(s['start'], s['end'], color=COLOR_MODO[s['mode']], alpha=0.13, lw=0)
            a.axvline(s['start'], color='#141414', lw=0.8, alpha=0.5)
        ax[0].text(s['start'] + 0.5, 1.05, f"[{i}] {s['label']} · {s['mode'].upper()}", fontsize=9, fontweight='bold', color=COLOR_MODO[s['mode']])
    ax[0].set_ylim(0, 1.25); ax[0].set_ylabel('mezcla')
    for b in chart['downbeats']:
        ax[0].axvline(b, color='#999', lw=0.3, alpha=0.5)
    # batería: bombo / caja / platillo
    fila = {'kick': 0, 'snare': 1, 'hat': 2}; col = {'kick': '#8a0a22', 'snare': '#e3262f', 'hat': '#d9a400'}
    d = chart['stems']['drums']['notes']
    ax[1].scatter([x['t'] for x in d], [fila[x['k']] for x in d], s=[6 + 20 * x['s'] for x in d], c=[col[x['k']] for x in d], marker='|')
    ax[1].set_yticks([0, 1, 2]); ax[1].set_yticklabels(['bombo', 'caja', 'platillo']); ax[1].set_ylim(-0.6, 2.6)
    for a, s, c in ((ax[2], 'bass', '#5a3d1e'), (ax[3], 'vocals', '#c2185b'), (ax[4], 'other', '#2c339d')):
        ns = chart['stems'][s]['notes']
        for x in ns:
            a.plot([x['t'], x['t'] + x['d']], [x['p'], x['p']], color=c, lw=3.2 if x['l'] else 1.4, solid_capstyle='butt', alpha=0.9 if x['l'] else 0.6)
        a.set_ylim(-0.1, 1.1); a.set_ylabel(NOMBRE_STEM[s]); a.set_yticks([])
    ax[-1].set_xlabel('segundos  (rojo = TAMBOR · verde = SERPIENTE · azul = PISTA · líneas gruesas = notas largas para patinar)')
    ax[0].set_title(titulo or chart['title'], fontsize=14, fontweight='bold', loc='left')
    plt.tight_layout(); plt.show()


def escuchar(chart, mix, stem='drums', desde=0, segundos=25, tipo=None):
    """Mezcla + un clic en cada nota detectada del STEM elegido."""
    from IPython.display import Audio, display
    a, b = int(desde * SR), int(min(len(mix), (desde + segundos) * SR))
    seg = mix[a:b]
    ns = [x for x in chart['stems'][stem]['notes'] if desde <= x['t'] < desde + segundos and (tipo is None or x.get('k') == tipo)]
    clics = np.zeros_like(seg)
    for x in ns:
        f = 1600 if stem != 'drums' else {'kick': 900, 'snare': 1500, 'hat': 3000}[x['k']]
        n = int(0.06 * SR) if not x.get('l') else int(min(x['d'], 1.5) * SR)
        i = int((x['t'] - desde) * SR)
        tt = np.arange(min(n, len(seg) - i)) / SR
        if len(tt) <= 0:
            continue
        env = np.exp(-tt * (40 if not x.get('l') else 3))
        clics[i:i + len(tt)] += 0.35 * np.sin(2 * np.pi * f * tt) * env
    display(Audio(0.6 * seg / (np.abs(seg).max() + 1e-9) + clics, rate=SR))


def cambiar_modos(chart, cambios):
    for i, m in cambios.items():
        if m not in MODOS:
            raise ValueError(f"Modo '{m}' no existe. Usa: {MODOS}")
        chart['sections'][int(i)]['mode'] = m
    return chart
