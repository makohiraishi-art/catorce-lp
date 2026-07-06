/**
 * sofa.js — パラメトリック・ソファ3Dモデル
 *
 * 写真4枚(正面・斜め・側面・背面)から採寸・分析した2人掛けコーデュロイソファ。
 *   - 全体寸法: W1760 × D880 × H850 mm(座面高 約450mm)
 *   - スリップカバー仕様 / 角型トラックアーム
 *   - 座クッション×2、背クッション×2、アーム上の傾斜ピロー×2
 *   - くすんだブルーグリーンのコーデュロイ生地(畝は縦方向)
 *   - 黒のテーパード角脚×4
 *
 * three.js の ES モジュールとして viewer.html / build/page.html の両方から
 * 利用される。THREE インスタンスを引数で受け取る(多重ロード回避のため)。
 */

// ------------------------------------------------------------------
// 主要寸法 (メートル)
// ------------------------------------------------------------------
export const DIM = {
  width: 1.76,        // 全幅
  depth: 0.88,        // 奥行
  legH: 0.09,         // 脚高
  baseTop: 0.30,      // 座枠(前框)上端
  armW: 0.17,         // アーム幅
  armTop: 0.60,       // アーム上端
  backT: 0.16,        // 背枠厚
  backFrameTop: 0.64, // 背枠上端(背面パネル上端)
  seatCushionH: 0.16, // 座クッション厚
  seatCushionD: 0.58, // 座クッション奥行
  backCushionH: 0.46, // 背クッション高
  backCushionT: 0.18, // 背クッション厚
  armPillowW: 0.55,   // アームピロー長辺
  armPillowH: 0.13,   // アームピロー厚
  armPillowD: 0.32,   // アームピロー奥行
};

// 生地色(写真から採色): くすんだブルーグリーン
export const FABRIC = {
  base: '#5f7876',
  groove: '#57706e', // 畝の谷(影)
  ridge: '#6a8480',  // 畝の山(ハイライト)
  sheen: '#93a8a5',  // 起毛の光沢色
  waleTile: 0.05,    // テクスチャ1タイルが表す実寸(5cm)
  walesPerTile: 12,  // 1タイルあたりの畝数 → 畝ピッチ約4.2mm
};

// ------------------------------------------------------------------
// ジオメトリ: ソフトボックス(布張り・クッション用の変形ボックス)
// ------------------------------------------------------------------
// BoxGeometry の重複頂点を溶接(面境界の法線の折れ=カクつきを解消)した上で
// キューブ→球 写像とブレンドして角を丸め、bulge で中央部を膨らませ
// (パンパンに詰まった羽毛クッションの張り)、wrinkle で滑らかなシワを加える。

// BoxGeometry は面ごとに頂点が分かれており、そのまま法線を計算すると
// 面境界に硬いエッジ(クリース)が出る。位置が一致する頂点を単一化して
// 全体をスムーズシェーディングにする。
function weldGeometry(THREE, g) {
  const pos = g.attributes.position;
  const idx = g.index;
  const map = new Map();
  const remap = new Uint32Array(pos.count);
  const outPos = [];
  for (let i = 0; i < pos.count; i++) {
    const key = pos.getX(i).toFixed(5) + ',' + pos.getY(i).toFixed(5) + ',' + pos.getZ(i).toFixed(5);
    let j = map.get(key);
    if (j === undefined) {
      j = outPos.length / 3;
      map.set(key, j);
      outPos.push(pos.getX(i), pos.getY(i), pos.getZ(i));
    }
    remap[i] = j;
  }
  const outIdx = new Uint32Array(idx.count);
  for (let i = 0; i < idx.count; i++) outIdx[i] = remap[idx.getX(i)];
  const ng = new THREE.BufferGeometry();
  ng.setAttribute('position', new THREE.Float32BufferAttribute(outPos, 3));
  ng.setIndex(new THREE.BufferAttribute(outIdx, 1));
  return ng;
}

function softBoxGeometry(THREE, w, h, d, { seg = 48, round = 0.5, bulge = 0, bulgeAxis = 'y', wrinkle = 0, seed = 1 } = {}) {
  const g = weldGeometry(THREE, new THREE.BoxGeometry(w, h, d, seg, seg, seg));
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    // [-1,1] 正規化座標
    const u = v.x / (w / 2), t = v.y / (h / 2), s = v.z / (d / 2);
    // キューブ→球 写像(Philip Nowell の式)
    const sx = u * Math.sqrt(Math.max(0, 1 - (t * t) / 2 - (s * s) / 2 + (t * t * s * s) / 3));
    const sy = t * Math.sqrt(Math.max(0, 1 - (u * u) / 2 - (s * s) / 2 + (u * u * s * s) / 3));
    const sz = s * Math.sqrt(Math.max(0, 1 - (u * u) / 2 - (t * t) / 2 + (u * u * t * t) / 3));
    let nx = u + (sx - u) * round;
    let ny = t + (sy - t) * round;
    let nz = s + (sz - s) * round;
    // 中央膨らみ(クッションの張り)。bulgeAxis で膨らむ方向を指定
    if (bulge) {
      if (bulgeAxis === 'z') {
        const fx = 1 - Math.min(1, nx * nx);
        const fy = 1 - Math.min(1, ny * ny);
        nz *= 1 + bulge * fx * fy;
      } else {
        const fx = 1 - Math.min(1, nx * nx);
        const fz = 1 - Math.min(1, nz * nz);
        ny *= 1 + bulge * fx * fz;
      }
    }
    let X = nx * (w / 2), Y = ny * (h / 2), Z = nz * (d / 2);
    // 布のシワ: 低周波2オクターブの滑らかなうねりを外向きに加算
    if (wrinkle) {
      const n = 0.6 * Math.sin(X * 12 + Z * 9 + seed * 7) * Math.sin(Y * 11 - X * 6 + seed * 3) +
                0.4 * Math.sin(X * 21 - Y * 14 + seed * 5) * Math.sin(Z * 17 + Y * 8 + seed * 11);
      const len = Math.hypot(nx, ny, nz) || 1;
      X += (nx / len) * n * wrinkle;
      Y += (ny / len) * n * wrinkle;
      Z += (nz / len) * n * wrinkle;
    }
    pos.setXYZ(i, X, Y, Z);
  }
  g.computeVertexNormals();
  boxProjectUV(THREE, g, 1 / FABRIC.waleTile);
  return g;
}

// ボックス投影UV: 法線の支配軸ごとにワールド(ローカル)座標からUVを生成。
// 生地の畝密度が面の大きさによらず一定(実寸ベース)になる。
function boxProjectUV(THREE, geometry, scale) {
  const pos = geometry.attributes.position;
  const nor = geometry.attributes.normal;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const nx = Math.abs(nor.getX(i)), ny = Math.abs(nor.getY(i)), nz = Math.abs(nor.getZ(i));
    let u, v2;
    if (nx >= ny && nx >= nz)      { u = z; v2 = y; } // 側面: 畝は縦
    else if (nz >= nx && nz >= ny) { u = x; v2 = y; } // 前後面: 畝は縦
    else                           { u = x; v2 = z; } // 上下面: 畝は前後方向
    uv[i * 2] = u * scale;
    uv[i * 2 + 1] = v2 * scale;
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

// ------------------------------------------------------------------
// コーデュロイ生地テクスチャ(プロシージャル生成)
// ------------------------------------------------------------------
export function createCorduroyMaterial(THREE) {
  const S = 1024;
  const period = S / FABRIC.walesPerTile;

  // 乱数(シード固定で再現性を保つ)
  let rnd = 987654321;
  const rand = () => (rnd = (rnd * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

  const baseC = new THREE.Color(FABRIC.base);
  const grooveC = new THREE.Color(FABRIC.groove);
  const ridgeC = new THREE.Color(FABRIC.ridge);

  // 畝ごとの色ムラ(染めムラ・毛並みの向きの違い)
  const waleJitter = [];
  for (let i = 0; i < FABRIC.walesPerTile + 1; i++) waleJitter.push((rand() - 0.5) * 0.10);
  // 横方向の緩やかな起毛ムラ(ベルベット特有の帯状の濃淡)
  const bandCount = 5;
  const bands = [];
  for (let i = 0; i < bandCount; i++) bands.push({ f: 1 + Math.floor(rand() * 2), p: rand() * Math.PI * 2, a: 0.006 + rand() * 0.006 });

  // --- カラーマップ / ラフネスマップ / ノーマルマップを一括生成 ---
  const cc = document.createElement('canvas');
  cc.width = cc.height = S;
  const cg = cc.getContext('2d');
  const cimg = cg.createImageData(S, S);

  const rc = document.createElement('canvas');
  rc.width = rc.height = S;
  const rg = rc.getContext('2d');
  const rimg = rg.createImageData(S, S);

  const nc = document.createElement('canvas');
  nc.width = nc.height = S;
  const ng = nc.getContext('2d');
  const nimg = ng.createImageData(S, S);

  // 4pxブロック単位の緩いノイズ(ピクセルノイズはモアレ・シマー源になるため使わない)
  const BW = S >> 2;
  const blockNoise = new Float32Array(BW * BW);
  for (let i = 0; i < blockNoise.length; i++) blockNoise[i] = (rand() - 0.5) * 0.05;

  // 繊維の縦スジ(列ごとの微小ノイズ)を先に生成
  const columnNoise = new Float32Array(S);
  for (let x = 0; x < S; x++) columnNoise[x] = (rand() - 0.5) * 0.035;

  const tmp = new THREE.Color();
  const waleAmp = 1.4; // 畝の高さ係数(ノーマルマップ)
  for (let y = 0; y < S; y++) {
    // 行単位の緩い横ムラ
    let band = 0;
    for (const b of bands) band += Math.sin((y / S) * Math.PI * 2 * b.f + b.p) * b.a;
    for (let x = 0; x < S; x++) {
      const waleIdx = Math.floor(x / period);
      const ph = ((x % period) / period); // 畝内位置 0..1
      const ridge = Math.pow(Math.max(0, Math.sin(ph * Math.PI)), 1.4); // 山=1 谷=0
      // --- 色: 谷→山のグラデーション + 畝ムラ + 横帯 + 微細ノイズ ---
      tmp.copy(grooveC).lerp(ridgeC, ridge);
      const light = 1 + waleJitter[waleIdx] + band + columnNoise[x] * ridge + blockNoise[(y >> 2) * BW + (x >> 2)];
      const o = (y * S + x) * 4;
      cimg.data[o]     = Math.min(255, Math.max(0, tmp.r * 255 * light));
      cimg.data[o + 1] = Math.min(255, Math.max(0, tmp.g * 255 * light));
      cimg.data[o + 2] = Math.min(255, Math.max(0, tmp.b * 255 * light));
      cimg.data[o + 3] = 255;
      // --- ラフネス: 山(起毛の先端)はやや艶、谷は粗い ---
      const rough = 0.92 - ridge * 0.12 + blockNoise[(y >> 2) * BW + (x >> 2)] * 0.6;
      const rv = Math.min(255, Math.max(0, rough * 255));
      rimg.data[o] = rimg.data[o + 1] = rimg.data[o + 2] = rv;
      rimg.data[o + 3] = 255;
      // --- ノーマル: 畝断面の勾配 + 繊維の微細凹凸 ---
      const bn = blockNoise[(y >> 2) * BW + (x >> 2)];
      const dhdx = Math.sin(ph * Math.PI * 2) * waleAmp + bn * 3;
      const dhdy = bn * 2;
      const inv = 1 / Math.hypot(dhdx, dhdy, 1);
      nimg.data[o]     = Math.round((-dhdx * inv * 0.5 + 0.5) * 255);
      nimg.data[o + 1] = Math.round((-dhdy * inv * 0.5 + 0.5) * 255);
      nimg.data[o + 2] = Math.round((inv * 0.5 + 0.5) * 255);
      nimg.data[o + 3] = 255;
    }
  }
  cg.putImageData(cimg, 0, 0);
  rg.putImageData(rimg, 0, 0);
  ng.putImageData(nimg, 0, 0);

  const map = new THREE.CanvasTexture(cc);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;

  const roughnessMap = new THREE.CanvasTexture(rc);
  roughnessMap.wrapS = roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.anisotropy = 8;

  const normalMap = new THREE.CanvasTexture(nc);
  normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping;
  normalMap.anisotropy = 8;

  // 起毛感: sheen(KHR_materials_sheen として GLB にも出力される)
  return new THREE.MeshPhysicalMaterial({
    map,
    normalMap,
    normalScale: new THREE.Vector2(0.75, 0.75),
    roughnessMap,
    roughness: 1.0, // roughnessMap と乗算
    metalness: 0,
    sheen: 1.0,
    sheenRoughness: 0.38,
    sheenColor: new THREE.Color(FABRIC.sheen),
  });
}

// ------------------------------------------------------------------
// ソファ本体の組み立て
// ------------------------------------------------------------------
export function createSofa(THREE) {
  const D = DIM;
  const group = new THREE.Group();
  group.name = 'CorduroySofa';

  const fabric = createCorduroyMaterial(THREE);
  const legMat = new THREE.MeshStandardMaterial({ color: '#151412', roughness: 0.45, metalness: 0.05 });
  const tagMat = new THREE.MeshStandardMaterial({ color: '#c9c4bc', roughness: 0.9 });

  const add = (geom, mat, x, y, z, name, rot) => {
    const m = new THREE.Mesh(geom, mat);
    m.position.set(x, y, z);
    if (rot) m.rotation.set(rot[0] || 0, rot[1] || 0, rot[2] || 0);
    m.castShadow = m.receiveShadow = true;
    m.name = name;
    group.add(m);
    return m;
  };

  const innerW = D.width - 2 * D.armW; // アーム間の内寸

  // --- 脚 ×4 (黒・テーパード角脚) ---
  const legGeom = new THREE.CylinderGeometry(0.062, 0.048, D.legH, 4, 1);
  legGeom.rotateY(Math.PI / 4); // 角柱の面を正面に
  const legX = D.width / 2 - 0.10, legZ = D.depth / 2 - 0.09;
  add(legGeom, legMat,  legX, D.legH / 2,  legZ, 'leg_FR');
  add(legGeom, legMat, -legX, D.legH / 2,  legZ, 'leg_FL');
  add(legGeom, legMat,  legX, D.legH / 2, -legZ, 'leg_BR');
  add(legGeom, legMat, -legX, D.legH / 2, -legZ, 'leg_BL');

  // --- 座枠(前框・座受け) ---
  const baseH = D.baseTop - D.legH;
  // アーム内へ 3cm 食い込ませ、アームとの間に影の溝が出ないようにする
  add(
    softBoxGeometry(THREE, innerW + 0.06, baseH, D.depth - 0.02, { seg: 24, round: 0.10, wrinkle: 0.0025, seed: 2 }),
    fabric, 0, D.legH + baseH / 2, 0.005, 'base'
  );

  // --- アーム ×2 (角型トラックアーム / 側面全体を覆うスラブ) ---
  const armH = D.armTop - D.legH;
  const armGeomL = softBoxGeometry(THREE, D.armW, armH, D.depth, { seg: 32, round: 0.14, wrinkle: 0.003, seed: 3 });
  const armGeomR = softBoxGeometry(THREE, D.armW, armH, D.depth, { seg: 32, round: 0.14, wrinkle: 0.003, seed: 4 });
  const armX = D.width / 2 - D.armW / 2;
  add(armGeomL, fabric, -armX, D.legH + armH / 2, 0, 'arm_L');
  add(armGeomR, fabric,  armX, D.legH + armH / 2, 0, 'arm_R');

  // --- 背枠 (背面は全幅一枚のフラットパネル / アーム外面と面一) ---
  const backH = D.backFrameTop - D.legH;
  add(
    softBoxGeometry(THREE, D.width - 0.006, backH, D.backT, { seg: 28, round: 0.10, wrinkle: 0.003, seed: 5 }),
    fabric, 0, D.legH + backH / 2, -(D.depth / 2 - D.backT / 2), 'back_frame'
  );

  // --- 座クッション ×2 (ふっくらした張り + シワ) ---
  const scW = innerW / 2 - 0.006;
  const scY = D.baseTop + D.seatCushionH / 2 - 0.01;
  const scZ = D.depth / 2 - 0.02 - D.seatCushionD / 2;
  const seatOpts = { seg: 56, round: 0.42, bulge: 0.22, wrinkle: 0.005 };
  add(softBoxGeometry(THREE, scW, D.seatCushionH, D.seatCushionD, { ...seatOpts, seed: 6 }),
      fabric, -(scW / 2 + 0.005), scY, scZ, 'seat_cushion_L');
  add(softBoxGeometry(THREE, scW, D.seatCushionH, D.seatCushionD, { ...seatOpts, seed: 7 }),
      fabric,  (scW / 2 + 0.005), scY, scZ, 'seat_cushion_R');

  // --- 背クッション ×2 (背枠にもたれて後傾、上端は背枠より上に覗く) ---
  const bcW = innerW / 2 + 0.005; // 中央で互いに接する(わずかに圧縮)
  const lean = -0.13; // 後傾(rad)
  const bcY = D.baseTop + D.seatCushionH + D.backCushionH / 2 - 0.045;
  const bcZ = -(D.depth / 2) + D.backT + D.backCushionT / 2 - 0.02;
  const backOpts = { seg: 56, round: 0.30, bulge: 0.55, bulgeAxis: 'z', wrinkle: 0.0045 };
  add(softBoxGeometry(THREE, bcW, D.backCushionH, D.backCushionT, { ...backOpts, seed: 8 }),
      fabric, -bcW / 2, bcY, bcZ, 'back_cushion_L', [lean, 0, 0]);
  add(softBoxGeometry(THREE, bcW, D.backCushionH, D.backCushionT, { ...backOpts, seed: 9 }),
      fabric,  bcW / 2, bcY, bcZ, 'back_cushion_R', [lean, 0, 0]);

  // --- アームピロー ×2 (アーム上端に載せ、内側へ傾けて立て掛ける) ---
  const pillowOpts = { seg: 48, round: 0.42, bulge: 0.30, wrinkle: 0.005 };
  const tilt = 0.55;  // 内側への傾き(rad) ≈ 31°
  const pX = D.width / 2 - 0.30;
  const pY = D.armTop; // アーム内側の角を支点に載る
  const pZ = -0.04;
  add(softBoxGeometry(THREE, D.armPillowW, D.armPillowH, D.armPillowD, { ...pillowOpts, seed: 10 }),
      fabric, -pX, pY, pZ, 'arm_pillow_L', [-0.10, 0, -tilt]);
  add(softBoxGeometry(THREE, D.armPillowW, D.armPillowH, D.armPillowD, { ...pillowOpts, seed: 11 }),
      fabric,  pX, pY, pZ, 'arm_pillow_R', [-0.10, 0,  tilt]);

  // --- ブランドタグ (背面左下・側面写真にも写る小さな布タグ) ---
  add(new THREE.BoxGeometry(0.004, 0.035, 0.02), tagMat,
      -(D.width / 2 - 0.001), 0.16, -(D.depth / 2 - 0.06), 'brand_tag');

  return group;
}
