// Brands sold by 67MOTO that advertise on the city's roofs. Logos are the shop site's own
// files (67moto.ru/img/site/brands/<id>-color.webp, copied to public/brands); a click on a
// billboard opens that brand's selection in the 67moto.ru catalogue.

export interface Brand {
  id: string; // file name and key
  name: string; // the brand as the catalogue spells it (its ?brand= filter)
  dark?: boolean; // the logo file has its own dark background
}

export const BRANDS: Brand[] = [
  { id: "bse", name: "BSE" },
  { id: "oxo", name: "OXO" },
  { id: "leatt", name: "LEATT" },
  { id: "acerbis", name: "Acerbis", dark: true },
  { id: "kayo", name: "KAYO" },
  { id: "regulmoto", name: "Regulmoto" },
  { id: "progasi", name: "PROGASI" },
  { id: "dayun", name: "DAYUN" },
  { id: "motoland", name: "Motoland" },
  { id: "motul", name: "MOTUL" },
  { id: "shark", name: "Shark" },
  { id: "roqvi", name: "ROQVI" },
  { id: "fx-moto", name: "FX MOTO" },
  { id: "zuumav", name: "ZUUMAV" },
  { id: "ajerra", name: "Ajerra" },
  { id: "benda", name: "BENDA", dark: true },
];
export const BRAND_BY_ID = Object.fromEntries(BRANDS.map((b) => [b.id, b])) as Record<string, Brand>;

// The roofs to put up: BSE three times as often as each of the others.
export const BILLBOARDS = BRANDS.flatMap((b) => (b.id === "bse" ? [b.id, b.id, b.id] : [b.id]));

export const brandUrl = (b: Brand) => `https://67moto.ru/?brand=${encodeURIComponent(b.name)}#catalog`;
