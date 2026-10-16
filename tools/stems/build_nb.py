import nbformat as nbf
code = open('analisis.py', encoding='utf-8').read()
nb = nbf.v4.new_notebook()
C = []
md = lambda s: C.append(nbf.v4.new_markdown_cell(s))
cc = lambda s: C.append(nbf.v4.new_code_cell(s))

md("""# 🐱🎷 Gato Swing — Preparar canciones con STEMS

Este cuaderno toma tus MP3, los separa en **4 STEMS** (batería, bajo, voz y otros) con **Demucs** y genera el **mapa de la canción** (`chart.json`) que leerá Gato Swing:

- 🥁 **beat, tempo y compases**
- 🎼 **notas de cada STEM** (golpes de batería, notas largas para patinar, altura → carril)
- 🧩 **secciones** de la canción (intro, estrofa, coro…) con el **modo del gato**: `tambor`, `serpiente` o `pista`

### Antes de empezar
1. Menú **Entorno de ejecución → Cambiar tipo de entorno → GPU (T4)** → Guardar.
2. Ejecuta las celdas **en orden** con ▶ (o *Entorno de ejecución → Ejecutar todo*).
3. Con GPU tarda **1–2 minutos por canción**.""")

md("## 1 · Instalar")
cc("""!pip -q install demucs
import torch
print('GPU lista ✅' if torch.cuda.is_available() else '⚠️ Sin GPU: funciona, pero MUY lento. Cambia el entorno a GPU (T4).')""")

md("## 2 · Código del análisis\n*(no hace falta tocar nada aquí)*")
cc("%%writefile gato_stems.py\n" + code)

md("## 3 · Subir canciones\nPuedes subir **varias a la vez** (MP3, WAV, M4A…).")
cc("""import os, shutil, subprocess
from google.colab import files
os.makedirs('entrada', exist_ok=True)
subidos = files.upload()
CANCIONES = []
for nombre, datos in subidos.items():
    ruta = os.path.join('entrada', nombre)
    with open(ruta, 'wb') as f: f.write(datos)
    CANCIONES.append(ruta)
print('Canciones:', *[f'  [{i}] {os.path.basename(c)}' for i, c in enumerate(CANCIONES)], sep='\\n')""")

md("""## 4 · Separar en STEMS y analizar
Si quieres, cambia el **título** que se verá en el juego (por defecto usa el nombre del archivo).""")
cc("""import importlib, numpy as np, librosa, soundfile as sf, torch
import gato_stems as G; importlib.reload(G)
from demucs.pretrained import get_model
from demucs.apply import apply_model

TITULOS = {
    # 0: 'Mi canción favorita',
}

dev = 'cuda' if torch.cuda.is_available() else 'cpu'
modelo = get_model('htdemucs'); modelo.to(dev).eval()
RES = []   # resultados por canción

for i, ruta in enumerate(CANCIONES):
    nombre = os.path.basename(ruta); sl = G.slug(nombre)
    print(f'\\n▶ [{i}] {nombre}')
    carpeta = os.path.join('salida', sl); os.makedirs(carpeta, exist_ok=True)
    # 1) audio final del juego (MP3 44.1 kHz). Se analiza ESTE archivo para que todo quede sincronizado.
    mp3 = os.path.join(carpeta, 'song.mp3')
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', ruta, '-vn', '-ar', '44100', '-ac', '2', '-b:a', '160k', mp3], check=True)
    y, sr = librosa.load(mp3, sr=modelo.samplerate, mono=False)
    if y.ndim == 1: y = np.stack([y, y])
    # 2) separar con Demucs
    wav = torch.tensor(y, dtype=torch.float32)
    ref = wav.mean(0); m, s = ref.mean(), ref.std() + 1e-8
    with torch.no_grad():
        out = apply_model(modelo, ((wav - m) / s)[None].to(dev), device=dev, shifts=1, split=True, overlap=0.25, progress=True)[0]
    out = (out * s + m).cpu().numpy()
    stems44 = {n: out[k] for k, n in enumerate(modelo.sources)}
    # 3) analizar (mono, 22 kHz)
    a22 = lambda x: librosa.resample(x.mean(0), orig_sr=sr, target_sr=G.SR)
    mix = a22(y); stems = {n: a22(stems44[n]) for n in G.STEMS}
    titulo = TITULOS.get(i, os.path.splitext(nombre)[0])
    chart = G.analizar(mix, stems, titulo, 'song.mp3')
    RES.append({'slug': sl, 'carpeta': carpeta, 'chart': chart, 'mix': mix, 'stems44': stems44, 'sr': sr})
    G.resumen(chart)
print('\\n✅ Listo')""")

md("""## 5 · Revisar
La gráfica muestra las secciones con su modo (🔴 **tambor** · 🟢 **serpiente** · 🔵 **pista**) y las notas que encontró en cada STEM.  
Las **líneas gruesas** son notas largas → barandas para patinar.""")
cc("""for i, r in enumerate(RES):
    G.dibujar(r['chart'], f"[{i}] {r['chart']['title']}")""")

md("""### 🎧 Escuchar lo que detectó
Suena la canción con un **clic en cada nota** del STEM elegido. Úsalo para comprobar que los obstáculos caerán donde deben.

- `stem`: `'drums'` (batería), `'bass'` (bajo), `'vocals'` (voz) u `'other'` (otros)
- en batería puedes filtrar con `tipo='kick'` (bombo), `'snare'` (caja) o `'hat'` (platillo)""")
cc("""CANCION = 0      # número de la canción
STEM = 'drums'
DESDE = 30       # segundo donde empieza
SEGUNDOS = 20

r = RES[CANCION]
G.escuchar(r['chart'], r['mix'], STEM, DESDE, SEGUNDOS)""")

md("""## 6 · Ajustar los modos (opcional)
Si una sección no te convence, cámbiala aquí: `{número_de_canción: {número_de_sección: 'modo'}}`  
Modos: `'tambor'`, `'serpiente'`, `'pista'`. Los números de sección salen en la gráfica y en el resumen (`[0]`, `[1]`…).""")
cc("""CAMBIOS = {
    # 0: {0: 'tambor', 3: 'pista'},
}

for i, cambios in CAMBIOS.items():
    G.cambiar_modos(RES[i]['chart'], cambios)
    G.resumen(RES[i]['chart'])""")

md("""## 7 · Exportar y descargar
Genera **`gato-swing-canciones.zip`** con una carpeta por canción:

```
canciones/
  index.json            ← lista de canciones para el juego
  mi-cancion/
    chart.json          ← el mapa
    song.mp3            ← el audio
    stems/*.mp3         ← los 4 STEMS (opcional: para silenciar la voz si fallas, efectos, etc.)
```""")
cc("""GUARDAR_STEMS = True   # False = zip mucho más liviano

import json
indice = []
for r in RES:
    ch = r['chart']
    if GUARDAR_STEMS:
        os.makedirs(os.path.join(r['carpeta'], 'stems'), exist_ok=True)
        ch['stemsAudio'] = {}
        for n in G.STEMS:
            wav = os.path.join(r['carpeta'], 'stems', n + '.wav'); dst = wav[:-4] + '.mp3'
            sf.write(wav, r['stems44'][n].T, r['sr'])
            subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', wav, '-b:a', '96k', dst], check=True)
            os.remove(wav); ch['stemsAudio'][n] = 'stems/' + n + '.mp3'
    G.guardar_json(ch, os.path.join(r['carpeta'], 'chart.json'))
    indice.append({'id': r['slug'], 'title': ch['title'], 'bpm': ch['bpm'], 'duration': ch['duration'],
                   'chart': r['slug'] + '/chart.json', 'audio': r['slug'] + '/song.mp3',
                   'modes': sorted({s['mode'] for s in ch['sections']})})

# conservar canciones que ya estaban en el índice (si se ejecuta varias veces)
ruta_idx = 'salida/index.json'
viejo = json.load(open(ruta_idx)) if os.path.exists(ruta_idx) else {'songs': []}
ids = {x['id'] for x in indice}
canciones = [x for x in viejo['songs'] if x['id'] not in ids] + indice
json.dump({'format': 'gato-swing-songs', 'version': 1, 'songs': canciones}, open(ruta_idx, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)

if os.path.exists('canciones'): shutil.rmtree('canciones')
shutil.copytree('salida', 'canciones')
shutil.make_archive('gato-swing-canciones', 'zip', '.', 'canciones')
print('📦', len(canciones), 'canciones:', ', '.join(x['title'] for x in canciones))
files.download('gato-swing-canciones.zip')""")

md("""---
### Formato de `chart.json` (para referencia)
| Campo | Qué es |
|---|---|
| `bpm`, `beats`, `downbeats` | tempo, cada beat y el tiempo 1 de cada compás (segundos) |
| `sections[]` | `start`, `end`, `label` (A, B… iguales = misma parte, ej. el coro), `energy` 0–1, `mode` |
| `stems.drums.notes[]` | `t` tiempo, `s` fuerza 0–1, `k` = `kick` / `snare` / `hat` |
| `stems.bass/vocals/other.notes[]` | `t` tiempo, `d` duración, `s` fuerza, `p` altura 0–1 (→ carril), `m` nota MIDI, `l` = nota larga |
| `energy` | volumen de la mezcla y de cada STEM, 10 veces por segundo (para animar al gato) |

Las notas que caen cerca de una semicorchea se alinean a la cuadrícula del beat.""")

nb['cells'] = C
nb['metadata'] = {'accelerator': 'GPU', 'colab': {'provenance': [], 'gpuType': 'T4', 'name': 'Gato Swing - STEMS'},
                  'kernelspec': {'name': 'python3', 'display_name': 'Python 3'}, 'language_info': {'name': 'python'}}
nbf.write(nb, '/mnt/user-data/outputs/GatoSwing_STEMS.ipynb')
print('ok', len(C))
