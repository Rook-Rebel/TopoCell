// გამარტივებული (ერთიანი, 0D) ელექტროლიზური მოდელი.
// დადასტურებული კანონები: ფარადეის კანონი, იდეალური აირის განტოლება, P = U·I.
// საინჟინრო მოდელი: U = E_rev + η_a + |η_c| + I·R, Butler–Volmer კინეტიკა საშუალო დენის სიმკვრივეზე.
import { F, R_GAS, M_H2, M_O2, T_NORMAL, P_NORMAL, P_REF, U_TN } from './constants';

/** ელექტროდის კინეტიკა. alphaF — გადატანის კოეფიციენტი ძირითადი რეაქციის მიმართულებით, alphaR — უკუმიმართულებით. */
export interface Kinetics {
  j0: number; // A/m² (რეალურ, ელექტროქიმიურად აქტიურ ფართობზე)
  alphaF: number;
  alphaR: number;
}

/**
 * შექცევადი ძაბვა 1 atm-ზე, თხევადი წყალი. კორელაცია: LeRoy, Bowen, LeRoy, J. Electrochem. Soc. 127 (1980) 1954.
 * შემოწმება: 25 °C → 1.229 V; 200 °C → 1.088 V.
 */
export function eRevStd(T: number): number {
  return 1.5184 - 1.5421e-3 * T + 9.523e-5 * T * Math.log(T) + 9.84e-8 * T * T;
}

/**
 * შექცევადი ძაბვა წნევის ნერნსტის შესწორებით.
 * დაშვება: H₂ და O₂ გამოიყოფა სრული წნევით p (სუფთა აირები), a(H₂O)=1, წყლის ორთქლი უგულებელყოფილია.
 * E = E°(T) + (RT/2F)·ln(p_H2·p_O2^0.5) = E°(T) + (3RT/4F)·ln(p/p_ref)
 */
export function eRev(T: number, p: number): number {
  return eRevStd(T) + ((3 * R_GAS * T) / (4 * F)) * Math.log(p / P_REF);
}

/** Butler–Volmer: j = j0·[exp(αF·f·η) − exp(−αR·f·η)], f = F/(RT). η ≥ 0 ძირითადი მიმართულებით. */
export function bvCurrent(eta: number, k: Kinetics, T: number): number {
  const f = F / (R_GAS * T);
  return k.j0 * (Math.exp(k.alphaF * f * eta) - Math.exp(-k.alphaR * f * eta));
}

export function bvSlope(eta: number, k: Kinetics, T: number): number {
  const f = F / (R_GAS * T);
  return k.j0 * f * (k.alphaF * Math.exp(k.alphaF * f * eta) + k.alphaR * Math.exp(-k.alphaR * f * eta));
}

/** BV-ის შებრუნება: მოცემული |j| (რეალურ ფართობზე) → გადაძაბვის სიდიდე η ≥ 0. ნიუტონი დაცული ბისექციით. */
export function overpotential(j: number, k: Kinetics, T: number): number {
  if (!(j > 0)) return 0;
  const f = F / (R_GAS * T);
  // ზედა ზღვარი: exp(αF f η) = 1 + j/j0  ⇒  g(η) ≥ 0
  let hi = Math.log1p(j / k.j0) / (k.alphaF * f);
  let lo = 0;
  let eta = hi;
  for (let it = 0; it < 80; it++) {
    const g = bvCurrent(eta, k, T) - j;
    if (g > 0) hi = eta;
    else lo = eta;
    const d = bvSlope(eta, k, T);
    let next = eta - g / d;
    if (!(next > lo && next < hi)) next = 0.5 * (lo + hi);
    if (Math.abs(next - eta) < 1e-13) {
      eta = next;
      break;
    }
    eta = next;
  }
  return eta;
}

/** ტაფელის დახრა b = ln(10)·RT/(αF), V/დეკადა. */
export function tafelSlope(alpha: number, T: number): number {
  return (Math.LN10 * R_GAS * T) / (alpha * F);
}

/** ტაფელის მიახლოება η = b·log10(j/j0). ვარგისია მხოლოდ j ≫ j0 არეში; სხვაგან აბრუნებს NaN. */
export function tafelOverpotential(j: number, k: Kinetics, T: number): number {
  if (!(j > k.j0)) return NaN;
  return tafelSlope(k.alphaF, T) * Math.log10(j / k.j0);
}

/** Bruggeman-ის შესწორება: κ_eff = κ·(1−ε)^1.5 (სფერული ბუშტუკები, ერთგვაროვანი აირშემცველობა). */
export function bruggeman(kappa: number, eps: number): number {
  return kappa * Math.pow(1 - eps, 1.5);
}

/**
 * KOH ხსნარის კუთრი გამტარობა (S/m). კორელაცია: Gilliam et al., Int. J. Hydrogen Energy 32 (2007) 359–364.
 * M — მოლარობა (0–12 mol/L), T — K (273–373). შემოწმება: 6.9 M, 353.15 K → 1.38 S/cm.
 */
export function kohConductivity(M: number, T: number): number {
  const sCm =
    -2.041 * M - 0.0028 * M * M + 0.005332 * M * T + (207.2 * M) / T + 0.001043 * M * M * M - 0.0000003 * M * M * T * T;
  return sCm * 100;
}

export interface CellModel {
  T: number; // K
  p: number; // Pa (აბსოლუტური)
  kappa: number; // S/m
  voidFraction: number; // ε — აირის მოცულობითი წილი ელექტროლიტში (დაშვება)
  areaA: number; // ანოდის გეომეტრიული დასველებული ფართობი, m²
  areaC: number;
  roughness: number; // f_r = ECSA / გეომეტრიული ფართობი
  thetaA: number; // ბუშტუკებით დაფარვის წილი
  thetaC: number;
  kinA: Kinetics;
  kinC: Kinetics;
  K: number; // უჯრედის მუდმივა, 1/m (R_el = K/κ_eff)
  extraR: number; // დამატებითი მიმდევრობითი წინაღობა, Ω
  faradaicH2: number;
  faradaicO2: number;
}

export interface Breakdown {
  I: number;
  U: number;
  P: number;
  eRev: number;
  etaA: number;
  etaC: number; // სიდიდე |η_c|
  ohmic: number; // I·R (სრული)
  R: number; // სრული ომური წინაღობა, Ω
  Rel: number; // ელექტროლიტის წინაღობა, Ω
  jA: number; // საშუალო გეომეტრიული დენის სიმკვრივე, A/m²
  jC: number;
  jAreal: number; // დენის სიმკვრივე აქტიურ ფართობზე
  jCreal: number;
  areaEffA: number;
  areaEffC: number;
  kappaEff: number;
}

/** A_eff = A_wet · f_r · (1 − θ). ეფექტი მხოლოდ კინეტიკაში შედის; ომურ წევრში θ მეორედ არ ითვლება. */
export function effectiveArea(area: number, roughness: number, theta: number): number {
  return area * roughness * (1 - theta);
}

export function voltageAt(I: number, m: CellModel): Breakdown {
  const kappaEff = bruggeman(m.kappa, m.voidFraction);
  const areaEffA = effectiveArea(m.areaA, m.roughness, m.thetaA);
  const areaEffC = effectiveArea(m.areaC, m.roughness, m.thetaC);
  const jAreal = I / areaEffA;
  const jCreal = I / areaEffC;
  const etaA = overpotential(jAreal, m.kinA, m.T);
  const etaC = overpotential(jCreal, m.kinC, m.T);
  const Rel = m.K / kappaEff;
  const R = Rel + m.extraR;
  const E = eRev(m.T, m.p);
  const U = I > 0 ? E + etaA + etaC + I * R : E;
  return {
    I,
    U,
    P: U * I,
    eRev: E,
    etaA,
    etaC,
    ohmic: I * R,
    R,
    Rel,
    jA: I / m.areaA,
    jC: I / m.areaC,
    jAreal,
    jCreal,
    areaEffA,
    areaEffC,
    kappaEff,
  };
}

export type ElectricalMode = 'I' | 'U' | 'P';

export interface Operating {
  ok: boolean;
  note?: string;
  b: Breakdown;
}

/** სამუშაო წერტილის პოვნა: ფიქსირებული I, U ან P. შეუძლებელი რეჟიმი ფარულად არ იცვლება — ბრუნდება შენიშვნა. */
export function solveOperating(mode: ElectricalMode, value: number, m: CellModel): Operating {
  if (!(value >= 0) || !Number.isFinite(value)) {
    return { ok: false, note: 'დაუშვებელი სამიზნე მნიშვნელობა', b: voltageAt(0, m) };
  }
  if (mode === 'I') return { ok: true, b: voltageAt(value, m) };
  const E = eRev(m.T, m.p);
  if (mode === 'U') {
    if (value <= E) {
      return {
        ok: true,
        note: `U ≤ E_rev (${E.toFixed(3)} V): ელექტროლიზი არ მიმდინარეობს, I = 0`,
        b: { ...voltageAt(0, m), U: value },
      };
    }
    const f = (I: number) => voltageAt(I, m).U - value;
    const I = bisectUp(f);
    return { ok: true, b: voltageAt(I, m) };
  }
  // mode === 'P'
  if (value === 0) return { ok: true, b: voltageAt(0, m) };
  const f = (I: number) => voltageAt(I, m).P - value;
  const I = bisectUp(f);
  return { ok: true, b: voltageAt(I, m) };
}

/** მონოტონურად ზრდადი f(I), f(0) < 0: ფესვის პოვნა გაორმაგებით და ბისექციით. */
function bisectUp(f: (x: number) => number): number {
  let lo = 0;
  let hi = 1e-6;
  let guard = 0;
  while (f(hi) < 0 && guard++ < 200) {
    lo = hi;
    hi *= 2;
  }
  for (let i = 0; i < 100; i++) {
    const mid = 0.5 * (lo + hi);
    if (f(mid) < 0) lo = mid;
    else hi = mid;
    if (hi - lo <= 1e-13 * Math.max(1, hi)) break;
  }
  return 0.5 * (lo + hi);
}

export interface Production {
  nH2: number; // mol/s
  nO2: number;
  mH2: number; // kg/s
  mO2: number;
  vH2op: number; // m³/s სამუშაო T, p-ზე
  vO2op: number;
  vH2n: number; // m³/s ნორმალურ პირობებში (0 °C, 101 325 Pa)
  vO2n: number;
  duration: number; // s
  molH2: number;
  molO2: number;
  massH2: number; // kg
  volH2op: number; // m³
  volO2op: number;
  volH2n: number;
  volO2n: number;
  energyWh: number;
  whPerMol: number; // Wh/mol H₂
  kwhPerKg: number; // kWh/kg H₂
  litersPerWhOp: number; // L H₂ / Wh სამუშაო პირობებში
  nlPerWh: number; // Nl H₂ / Wh
  effHHV: number; // ენერგეტიკული ეფექტიანობა HHV-ის მიმართ
  heatW: number; // I·(U − U_tn), თუ დადებითია
}

/** ფარადეის კანონი და იდეალური აირი. ṅ_H2 = η_F·I/(2F); ṅ_O2 = η_F·I/(4F); V̇ = ṅRT/p. */
export function production(b: Breakdown, m: CellModel, duration: number): Production {
  const nH2 = (m.faradaicH2 * b.I) / (2 * F);
  const nO2 = (m.faradaicO2 * b.I) / (4 * F);
  const vm = (R_GAS * m.T) / m.p;
  const vmN = (R_GAS * T_NORMAL) / P_NORMAL;
  const energyWh = (b.P * duration) / 3600;
  const whPerMol = nH2 > 0 ? b.P / (nH2 * 3600) : NaN;
  return {
    nH2,
    nO2,
    mH2: nH2 * M_H2,
    mO2: nO2 * M_O2,
    vH2op: nH2 * vm,
    vO2op: nO2 * vm,
    vH2n: nH2 * vmN,
    vO2n: nO2 * vmN,
    duration,
    molH2: nH2 * duration,
    molO2: nO2 * duration,
    massH2: nH2 * M_H2 * duration,
    volH2op: nH2 * vm * duration,
    volO2op: nO2 * vm * duration,
    volH2n: nH2 * vmN * duration,
    volO2n: nO2 * vmN * duration,
    energyWh,
    whPerMol,
    kwhPerKg: nH2 > 0 ? whPerMol / M_H2 / 1000 : NaN,
    litersPerWhOp: b.P > 0 ? (nH2 * vm * 1000 * 3600) / b.P : NaN,
    nlPerWh: b.P > 0 ? (nH2 * vmN * 1000 * 3600) / b.P : NaN,
    effHHV: b.U > 0 && b.I > 0 ? (m.faradaicH2 * U_TN) / b.U : NaN,
    heatW: Math.max(0, b.I * (b.U - U_TN)),
  };
}

/** ერთეულების გარდაქმნები (ვალიდაციისთვისაც გამოიყენება). */
export const units = {
  cToK: (c: number) => c + 273.15,
  kToC: (k: number) => k - 273.15,
  barToPa: (bar: number) => bar * 1e5,
  paToBar: (pa: number) => pa / 1e5,
  mmToM: (mm: number) => mm / 1000,
  m2ToCm2: (m2: number) => m2 * 1e4,
  m3ToL: (m3: number) => m3 * 1000,
  aM2ToMaCm2: (j: number) => j / 10,
};
