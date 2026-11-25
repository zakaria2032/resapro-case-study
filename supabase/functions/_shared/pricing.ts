// Règle commerciale unique : l'acompte vaut 30 % du prix du créneau, arrondi au centime supérieur.
export const DEPOSIT_RATE = 0.3;

export function depositFor(priceCents: number): number {
  return Math.ceil(priceCents * DEPOSIT_RATE);
}
