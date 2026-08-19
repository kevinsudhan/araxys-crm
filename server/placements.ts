/**
 * Who is actually inside each container, and where.
 *
 * The slot records track totals; this tracks the individual consignments that make those
 * totals up — whose cargo it is, how big each piece is, and where the consignment sits
 * along the container floor. That's what makes a real load plan drawable, and it means
 * the totals are derived from the parts rather than asserted independently of them.
 *
 * Placement model: consignments are loaded back-to-front. Each one occupies a run of
 * floor length starting at `xM`, and within that run its pieces are arranged across the
 * width and stacked to the height exactly as the fit engine computed.
 */
import { checkFit, type CargoPiece, type ContainerDims } from "./spaceEngine";

export interface SeedConsignment {
  slotId: string;
  clientName: string;
  reference: string;
  piece: CargoPiece;
}

export interface PlacedConsignment {
  id: string;
  slotId: string;
  clientName: string;
  reference: string;
  /** Distance from the container's back wall to the start of this consignment, metres. */
  xM: number;
  lengthM: number;
  piecesAcross: number;
  piecesHigh: number;
  rows: number;
  quantity: number;
  pieceLengthM: number;
  pieceWidthM: number;
  pieceHeightM: number;
  weightKg: number;
  colorIndex: number;
  source: "seed" | "crm" | "voice_agent";
}

/** Existing bookings already on the water or committed, per sailing slot. */
export const seedConsignments: SeedConsignment[] = [
  // sl-1 — Chennai -> Jebel Ali, 40GP
  { slotId: "sl-1", clientName: "Meera Textiles", reference: "ARX-MT-4471", piece: { lengthCm: 120, widthCm: 100, heightCm: 110, quantity: 12, weightKgEach: 210 } },
  { slotId: "sl-1", clientName: "Ramesh Spices", reference: "ARX-RS-2210", piece: { lengthCm: 100, widthCm: 80, heightCm: 90, quantity: 16, weightKgEach: 140 } },
  { slotId: "sl-1", clientName: "Sundar Agro", reference: "ARX-SA-0912", piece: { lengthCm: 110, widthCm: 110, heightCm: 100, quantity: 8, weightKgEach: 260 } },

  // sl-2 — Chennai -> Jebel Ali, 20GP (nearly full)
  { slotId: "sl-2", clientName: "Coral Exports", reference: "ARX-CE-1187", piece: { lengthCm: 130, widthCm: 110, heightCm: 115, quantity: 8, weightKgEach: 320 } },
  { slotId: "sl-2", clientName: "Vantage Traders", reference: "ARX-VT-3390", piece: { lengthCm: 100, widthCm: 100, heightCm: 100, quantity: 8, weightKgEach: 280 } },

  // sl-3 — Chennai -> Jebel Ali, 40HC
  { slotId: "sl-3", clientName: "Iyer Marine Foods", reference: "ARX-IM-9021", piece: { lengthCm: 120, widthCm: 100, heightCm: 120, quantity: 10, weightKgEach: 190 } },

  // sl-4 — Tuticorin -> Colombo, 20GP (full)
  { slotId: "sl-4", clientName: "Lanka Ceramics", reference: "ARX-LC-5561", piece: { lengthCm: 118, widthCm: 112, heightCm: 118, quantity: 20, weightKgEach: 420 } },

  // sl-5 — Tuticorin -> Colombo, 40GP
  { slotId: "sl-5", clientName: "Coral Exports", reference: "ARX-CE-2201", piece: { lengthCm: 110, widthCm: 90, heightCm: 95, quantity: 12, weightKgEach: 170 } },

  // sl-6 — Tuticorin -> Colombo, 20GP
  { slotId: "sl-6", clientName: "Deepa Ramesh Foods", reference: "ARX-DR-6602", piece: { lengthCm: 120, widthCm: 100, heightCm: 100, quantity: 4, weightKgEach: 320 } },

  // sl-7 — Chennai -> Singapore, 40HC
  { slotId: "sl-7", clientName: "Vantage Traders", reference: "ARX-VT-5510", piece: { lengthCm: 140, widthCm: 110, heightCm: 120, quantity: 6, weightKgEach: 260 } },

  // sl-9 — Chennai -> Singapore, 40GP
  { slotId: "sl-9", clientName: "Karthik Iyer Exports", reference: "ARX-KI-8814", piece: { lengthCm: 95, widthCm: 95, heightCm: 95, quantity: 8, weightKgEach: 150 } },

  // sl-12 — Tuticorin -> Jeddah, 40HC
  { slotId: "sl-12", clientName: "Sundar Agro", reference: "ARX-SA-1102", piece: { lengthCm: 90, widthCm: 90, heightCm: 90, quantity: 6, weightKgEach: 185 } },
];

/**
 * Lays a consignment out against a container and returns its placement, starting at the
 * given floor offset. Reuses the fit engine so the drawing and the availability answer
 * can never disagree about how something loads.
 */
export function place(
  container: ContainerDims,
  piece: CargoPiece,
  startXM: number,
  meta: { id: string; slotId: string; clientName: string; reference: string; colorIndex: number; source: PlacedConsignment["source"] }
): PlacedConsignment | null {
  const fit = checkFit(
    container,
    { lengthM: container.internalLengthM - startXM, payloadKg: container.maxPayloadKg },
    piece
  );
  if (!fit.fits || !fit.orientation) return null;

  return {
    ...meta,
    xM: Math.round(startXM * 100) / 100,
    lengthM: fit.lengthConsumedM ?? 0,
    piecesAcross: fit.piecesAcrossWidth ?? 1,
    piecesHigh: fit.piecesStackedHigh ?? 1,
    rows: fit.rowsNeeded ?? 1,
    quantity: Math.floor(piece.quantity),
    pieceLengthM: fit.orientation.lengthM,
    pieceWidthM: fit.orientation.widthM,
    pieceHeightM: fit.orientation.heightM,
    weightKg: fit.totalWeightKg ?? 0,
    colorIndex: meta.colorIndex,
    source: meta.source,
  };
}
