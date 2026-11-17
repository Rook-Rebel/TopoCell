// ფიზიკური მუდმივები. წყარო: NIST CODATA 2022 (F და R ზუსტი მნიშვნელობებია SI-2019 განსაზღვრებით).
export const F = 96485.33212; // C/mol — ფარადეის მუდმივა
export const R_GAS = 8.314462618; // J/(mol·K) — აირის უნივერსალური მუდმივა
export const M_H2 = 2.01588e-3; // kg/mol
export const M_O2 = 31.9988e-3; // kg/mol

/** ნორმალური პირობები (DIN 1343): 0 °C, 101 325 Pa — „ნორმალური ლიტრი“ (Nl). */
export const T_NORMAL = 273.15;
export const P_NORMAL = 101325;

/** E_rev(T) კორელაციის საყრდენი წნევა: 1 atm. */
export const P_REF = 101325;

/** წყლის წარმოქმნის ენთალპია 25 °C-ზე (თხევადი წყალი, HHV): 285.83 kJ/mol. */
export const HHV_H2 = 285.83e3; // J/mol
/** თერმონეიტრალური ძაბვა 25 °C-ზე: ΔH/(2F) ≈ 1.481 V. */
export const U_TN = HHV_H2 / (2 * F);

export const APP_VERSION = '1.0.0';
